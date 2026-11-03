// ============================================================
// call-service — Accounts + Chat + Call signaling server
// REST  (:3004): register / login / user search (token auth)
// Socket (:3003): presence, DMs (SQLite), typing, read receipts,
//                 WebRTC call signaling incl. screen share
// Port 3003 is reached through the gateway via XTransformPort.
// ============================================================
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Server, type Socket } from 'socket.io'
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { randomUUID, createHmac, timingSafeEqual } from 'crypto'

const PORT_SOCKET = 3003
const PORT_REST = 3004
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_SECRET = 'dm-chat-v1::8f4a91c7d2be'

const DB_DIR = '/home/z/my-project/db'
const DB_PATH = `${DB_DIR}/chat.db`

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// ---------- Database ----------
mkdirSync(DB_DIR, { recursive: true })
const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    from_user  TEXT NOT NULL,
    to_user    TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'text',
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_msg_pair_a ON messages (from_user, to_user, created_at);
  CREATE INDEX IF NOT EXISTS idx_msg_pair_b ON messages (to_user, from_user, created_at);
  CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages (to_user, read_at);
`)

interface UserRow {
  username: string
  display_name: string
  password_hash: string
  created_at: number
  last_seen: number
}
interface MessageRow {
  id: string; from_user: string; to_user: string
  type: string; text: string; created_at: number; read_at: number | null
}

const userByNameStmt = db.prepare('SELECT * FROM users WHERE username = ?')
const insertUserStmt = db.prepare(
  'INSERT INTO users (username, display_name, password_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'
)
const upsertLastSeenStmt = db.prepare('UPDATE users SET last_seen = ? WHERE username = ?')
const searchUsersStmt = db.prepare(
  `SELECT username, display_name, last_seen FROM users
   WHERE username != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
   ORDER BY CASE WHEN username = ? THEN 0 WHEN username LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, username
   LIMIT 20`
)
const insertMsgStmt = db.prepare(
  'INSERT INTO messages (id, from_user, to_user, type, text, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
)
const markReadStmt = db.prepare(
  'UPDATE messages SET read_at = ? WHERE to_user = ? AND from_user = ? AND read_at IS NULL'
)
const unreadStmt = db.prepare(
  "SELECT from_user AS u, COUNT(*) AS c FROM messages WHERE to_user = ? AND read_at IS NULL AND type = 'text' GROUP BY from_user"
)
const historyStmt = db.prepare(
  `SELECT * FROM (
     SELECT * FROM messages
     WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
     ORDER BY created_at DESC LIMIT 300
   ) ORDER BY created_at ASC`
)
const chatPartnersStmt = db.prepare(
  `SELECT DISTINCT CASE WHEN from_user = ? THEN to_user ELSE from_user END AS other
   FROM messages WHERE (from_user = ? OR to_user = ?)`
)

// ---------- Tokens ----------
const sign = (data: string) => createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url')

function createToken(username: string): string {
  const body = `${username}.${Date.now() + TOKEN_TTL_MS}`
  return `${body}.${sign(body)}`
}

function verifyToken(token: string | null | undefined): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [username, expStr, sig] = parts
  const expected = sign(`${username}.${expStr}`)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null
  if (!USERNAME_RE.test(username)) return null
  return username
}

// ---------- State ----------
type CallType = 'audio' | 'video'
interface ActiveCall {
  id: string
  a: string
  b: string
  type: CallType
  acceptedAt: number | null
}

const online = new Map<string, string>() // username -> socketId
const sockets = new Map<string, string>() // socketId -> username
const calls = new Map<string, ActiveCall>()
const inCall = new Map<string, string>() // username -> callId

const now = () => Date.now()
const norm = (s: unknown) => (typeof s === 'string' ? s.trim() : '')

const isOnline = (u: string) => {
  const sid = online.get(u)
  return !!sid && io.sockets.sockets.has(sid)
}
const deliver = (u: string, event: string, payload: unknown) => {
  const sid = online.get(u)
  if (sid) io.to(sid).emit(event, payload)
}

function publicUser(username: string): { username: string; displayName: string } | null {
  const row = userByNameStmt.get(username) as UserRow | null
  return row ? { username: row.username, displayName: row.display_name } : null
}

function messagePayload(m: MessageRow) {
  return {
    id: m.id,
    from: m.from_user,
    to: m.to_user,
    type: m.type,
    text: m.text,
    createdAt: m.created_at,
    readAt: m.read_at,
  }
}

function addMessage(from: string, to: string, type: 'text' | 'call', text: string) {
  const row: MessageRow = {
    id: randomUUID(),
    from_user: from,
    to_user: to,
    type,
    text,
    created_at: now(),
    read_at: null,
  }
  insertMsgStmt.run(row.id, row.from_user, row.to_user, row.type, row.text, row.created_at)
  return messagePayload(row)
}

function chatsSnapshot(username: string) {
  const partners = chatPartnersStmt.all(username, username, username) as Array<{ other: string }>
  const out: Array<{ username: string; displayName: string; online: boolean; lastSeen: number }> = []
  for (const p of partners) {
    const row = userByNameStmt.get(p.other) as UserRow | null
    if (!row) continue
    out.push({
      username: row.username,
      displayName: row.display_name,
      online: isOnline(row.username),
      lastSeen: row.last_seen,
    })
  }
  return out
}

function cleanupCall(callId: string) {
  const call = calls.get(callId)
  if (!call) return
  calls.delete(callId)
  for (const [u, cid] of Array.from(inCall.entries())) {
    if (cid === callId && (u === call.a || u === call.b)) inCall.delete(u)
  }
}

function finishCall(call: ActiveCall, reason: 'ended' | 'rejected' | 'cancelled' | 'disconnected') {
  const duration = call.acceptedAt ? Math.max(0, Math.round((now() - call.acceptedAt) / 1000)) : 0
  const missed = !call.acceptedAt
  const logs: Array<{ to: string; with: string; message: ReturnType<typeof messagePayload> }> = []
  if (reason === 'ended' && call.acceptedAt) {
    const msg = addMessage(call.a, call.b, 'call', JSON.stringify({ kind: 'ended', callType: call.type, duration }))
    logs.push({ to: call.a, with: call.b, message: msg }, { to: call.b, with: call.a, message: msg })
  } else if (missed) {
    const msg = addMessage(call.a, call.b, 'call', JSON.stringify({
      kind: reason === 'disconnected' ? 'missed' : reason,
      callType: call.type, duration: 0,
    }))
    logs.push({ to: call.a, with: call.b, message: msg }, { to: call.b, with: call.a, message: msg })
  }
  cleanupCall(call.id)
  for (const l of logs) deliver(l.to, 'call-log', { with: l.with, message: l.message })
  return { duration, missed }
}

// ============================================================
// REST API (:3004) — auth + user search
// ============================================================
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 10_000) { reject(new Error('too_large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function authUser(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  return verifyToken(h.slice(7))
}

function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`)
}

async function handleRest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  // ---- register ----
  if (req.method === 'POST' && path === '/auth/register') {
    const body = await readBody(req)
    const username = norm(body.username).toLowerCase()
    const displayName = norm(body.displayName)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!USERNAME_RE.test(username)) return json(res, 400, { error: 'invalid_username' })
    if (!displayName || displayName.length > 30) return json(res, 400, { error: 'invalid_display_name' })
    if (password.length < 6 || password.length > 72) return json(res, 400, { error: 'invalid_password' })
    if (userByNameStmt.get(username)) return json(res, 409, { error: 'username_taken' })
    const hash = await Bun.password.hash(password)
    insertUserStmt.run(username, displayName, hash, now(), now())
    return json(res, 201, { token: createToken(username), user: { username, displayName } })
  }

  // ---- login ----
  if (req.method === 'POST' && path === '/auth/login') {
    const body = await readBody(req)
    const username = norm(body.username).toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''
    const row = userByNameStmt.get(username) as UserRow | null
    if (!row || !(await Bun.password.verify(password, row.password_hash))) {
      return json(res, 401, { error: 'bad_credentials' })
    }
    upsertLastSeenStmt.run(now(), row.username)
    return json(res, 200, { token: createToken(row.username), user: { username: row.username, displayName: row.display_name } })
  }

  // ---- user search ----
  if (req.method === 'GET' && path === '/users/search') {
    const me = authUser(req)
    if (!me) return json(res, 401, { error: 'unauthorized' })
    const q = norm(url.searchParams.get('q')).toLowerCase().slice(0, 30)
    if (!q) return json(res, 200, { users: [] })
    const like = `%${escapeLike(q)}%`
    const prefix = `${escapeLike(q)}%`
    const rows = searchUsersStmt.all(me, like, like, q, prefix) as Array<Pick<UserRow, 'username' | 'display_name' | 'last_seen'>>
    return json(res, 200, {
      users: rows.map((r) => ({
        username: r.username,
        displayName: r.display_name,
        online: isOnline(r.username),
        lastSeen: r.last_seen,
      })),
    })
  }

  return json(res, 404, { error: 'not_found' })
}

const restServer = createServer((req, res) => {
  handleRest(req, res).catch(() => {
    if (!res.headersSent) json(res, 500, { error: 'server_error' })
  })
})

// ============================================================
// Socket.io (:3003) — realtime chat + calls
// ============================================================
const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket: Socket) => {
  let me: string | null = null

  // ---------- Auth (token) ----------
  socket.on('login', (raw: { token?: string }) => {
    const username = verifyToken(norm(raw?.token))
    if (!username) {
      socket.emit('login:error', { reason: 'unauthorized' })
      return
    }
    const row = userByNameStmt.get(username) as UserRow | null
    if (!row) {
      socket.emit('login:error', { reason: 'unauthorized' })
      return
    }
    me = row.username

    const prev = sockets.get(socket.id)
    if (prev && prev !== me) {
      online.delete(prev)
      const prevCallId = inCall.get(prev)
      if (prevCallId) {
        const prevCall = calls.get(prevCallId)
        if (prevCall) {
          const other = prevCall.a === prev ? prevCall.b : prevCall.a
          const { duration } = finishCall(prevCall, 'disconnected')
          deliver(other, 'call:ended', { callId: prevCallId, from: prev, duration, reason: 'disconnect' })
        } else {
          inCall.delete(prev)
        }
      }
      socket.broadcast.emit('presence', { username: prev, online: false, lastSeen: now() })
    }

    // replace an older session with the same account
    const oldSid = online.get(me)
    if (oldSid && oldSid !== socket.id) {
      io.to(oldSid).emit('session-replaced', {})
      io.sockets.sockets.get(oldSid)?.disconnect(true)
      sockets.delete(oldSid)
    }

    online.set(me, socket.id)
    sockets.set(socket.id, me)
    upsertLastSeenStmt.run(now(), me)

    const unread: Record<string, number> = {}
    for (const r of unreadStmt.all(me) as Array<{ u: string; c: number }>) unread[r.u] = r.c

    socket.emit('login:ok', {
      me: { username: me, displayName: row.display_name },
      chats: chatsSnapshot(me),
      unread,
    })
    socket.broadcast.emit('presence', { username: me, online: true, lastSeen: now() })
  })

  // ---------- Messaging ----------
  socket.on('dm', (raw: { to?: string; text?: string; clientId?: string }) => {
    if (!me) return
    const to = norm(raw?.to)
    const text = norm(raw?.text).slice(0, 4000)
    if (!to || !text || to === me) return
    if (!userByNameStmt.get(to)) return
    const msg = addMessage(me, to, 'text', text)
    socket.emit('dm:ack', { clientId: norm(raw?.clientId), message: msg })
    deliver(to, 'dm', { message: msg, fromUser: publicUser(me) })
  })

  socket.on('history', (raw: { with?: string }) => {
    if (!me) return
    const other = norm(raw?.with)
    if (!other) return
    const rows = historyStmt.all(me, other, other, me) as MessageRow[]
    socket.emit('history', { with: other, messages: rows.map(messagePayload) })
  })

  socket.on('read', (raw: { with?: string }) => {
    if (!me) return
    const other = norm(raw?.with)
    if (!other) return
    const res = markReadStmt.run(now(), me, other)
    if (res.changes > 0) deliver(other, 'read', { by: me })
  })

  socket.on('typing', (raw: { to?: string; isTyping?: boolean }) => {
    if (!me) return
    const to = norm(raw?.to)
    if (!to) return
    deliver(to, 'typing', { from: me, isTyping: !!raw?.isTyping })
  })

  // ---------- Calls ----------
  socket.on('call:invite', (raw: { to?: string; type?: CallType }) => {
    if (!me) return
    const to = norm(raw?.to)
    const type: CallType = raw?.type === 'video' ? 'video' : 'audio'
    if (!to || to === me) return
    if (!isOnline(to)) { socket.emit('call:error', { reason: 'offline', to }); return }
    if (inCall.has(me)) { socket.emit('call:error', { reason: 'busy-self', to }); return }
    if (inCall.has(to)) { socket.emit('call:error', { reason: 'busy', to }); return }

    // نعتمد معرّف المكالمة من المتصل إن كان صالحًا (حتى يطابق أحداث الإلغاء/الإنهاء لاحقًا)
    const requestedId = norm(raw?.callId)
    const call: ActiveCall = {
      id: /^[0-9a-fA-F-]{8,64}$/.test(requestedId) ? requestedId : randomUUID(),
      a: me,
      b: to,
      type,
      acceptedAt: null,
    }
    calls.set(call.id, call)
    inCall.set(me, call.id)
    inCall.set(to, call.id)
    deliver(to, 'call:incoming', { callId: call.id, from: me, fromUser: publicUser(me), type })
  })

  socket.on('call:accept', (raw: { callId?: string }) => {
    if (!me) return
    const call = calls.get(norm(raw?.callId))
    if (!call || call.b !== me || call.acceptedAt) return
    call.acceptedAt = now()
    deliver(call.a, 'call:accepted', { callId: call.id, from: me, type: call.type })
  })

  socket.on('call:reject', (raw: { callId?: string }) => {
    if (!me) return
    const call = calls.get(norm(raw?.callId))
    if (!call || call.b !== me) return
    finishCall(call, 'rejected')
    deliver(call.a, 'call:rejected', { callId: call.id, from: me })
  })

  socket.on('call:cancel', (raw: { callId?: string }) => {
    if (!me) return
    const call = calls.get(norm(raw?.callId))
    if (!call || call.a !== me) return
    finishCall(call, 'cancelled')
    deliver(call.b, 'call:cancelled', { callId: call.id, from: me })
  })

  socket.on('call:end', (raw: { callId?: string }) => {
    if (!me) return
    const call = calls.get(norm(raw?.callId))
    if (!call || (call.a !== me && call.b !== me)) return
    const { duration } = finishCall(call, 'ended')
    const other = call.a === me ? call.b : call.a
    deliver(other, 'call:ended', { callId: call.id, from: me, duration })
  })

  // ---------- WebRTC relay (offer / answer / ICE / screen-state) ----------
  const relay = (event: string) => (raw: { to?: string; [k: string]: unknown }) => {
    if (!me) return
    const to = norm(raw?.to)
    if (!to || !isOnline(to)) return
    const myCall = inCall.get(me)
    if (!myCall || inCall.get(to) !== myCall) return // only between the two peers of the same call
    const payload: Record<string, unknown> = { from: me }
    for (const k of ['sdp', 'candidate', 'sharing']) {
      if (raw && raw[k] !== undefined) payload[k] = raw[k]
    }
    deliver(to, event, payload)
  }
  socket.on('rtc:offer', relay('rtc:offer'))
  socket.on('rtc:answer', relay('rtc:answer'))
  socket.on('rtc:ice', relay('rtc:ice'))
  socket.on('rtc:screen', relay('rtc:screen'))

  // ---------- Disconnect ----------
  socket.on('disconnect', () => {
    if (!me) return
    sockets.delete(socket.id)
    if (online.get(me) === socket.id) {
      online.delete(me)
      upsertLastSeenStmt.run(now(), me)
      socket.broadcast.emit('presence', { username: me, online: false, lastSeen: now() })
    }
    const callId = inCall.get(me)
    if (callId) {
      const call = calls.get(callId)
      if (call) {
        const other = call.a === me ? call.b : call.a
        const { duration } = finishCall(call, 'disconnected')
        deliver(other, 'call:ended', { callId, from: me, duration, reason: 'disconnect' })
      } else {
        inCall.delete(me)
      }
    }
    me = null
  })

  socket.on('error', (err) => {
    console.error(`[call-service] socket error (${socket.id}):`, err?.message ?? err)
  })
})

httpServer.listen(PORT_SOCKET, () => {
  console.log(`[call-service] socket.io listening on :${PORT_SOCKET}`)
})
restServer.listen(PORT_REST, () => {
  console.log(`[call-service] rest api listening on :${PORT_REST}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
  restServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
  restServer.close(() => process.exit(0))
})
