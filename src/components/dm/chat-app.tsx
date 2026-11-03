'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { Avatar } from '@/components/dm/avatar'
import { CallOverlay } from '@/components/dm/call-overlay'
import { ChatWindow } from '@/components/dm/chat-window'
import { LoginScreen } from '@/components/dm/login-screen'
import { Sidebar } from '@/components/dm/sidebar'
import { getSocket } from '@/lib/dm/socket'
import { apiSearch } from '@/lib/dm/api'
import { pop } from '@/lib/dm/sounds'
import type { AuthUser, ChatMessage, ChatUser } from '@/lib/dm/types'
import { useCall, type CallNotification } from '@/hooks/use-call'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const TOKEN_KEY = 'dm-token'
/** داخل تطبيق أندرويد (WebView) نحفظ الجلسة في localStorage لتبقى بعد إغلاق التطبيق،
 *  وفي المتصفح نستخدم sessionStorage ليتاح اختبار حسابين في تبويبين مختلفين.
 *  ملاحظة: الوصول للتخزين يجب أن يكون داخل دوال فقط (لا على مستوى الوحدة) لأن
 *  المكوّن يُعرض على الخادم أيضًا حيث لا توجد واجهات التخزين. */
const IS_ANDROID_APP = typeof navigator !== 'undefined' && /DardashtiApp/.test(navigator.userAgent)

function tokenGet(): string | null {
  if (typeof window === 'undefined') return null
  try { return (IS_ANDROID_APP ? window.localStorage : window.sessionStorage).getItem(TOKEN_KEY) } catch { return null }
}
function tokenSet(t: string): void {
  try { (IS_ANDROID_APP ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, t) } catch { /* noop */ }
}
function tokenDel(): void {
  try { (IS_ANDROID_APP ? window.localStorage : window.sessionStorage).removeItem(TOKEN_KEY) } catch { /* noop */ }
}

export function ChatApp() {
  const [booting, setBooting] = useState(true)
  const [connected, setConnected] = useState(false)
  const [me, setMe] = useState<AuthUser | null>(null)
  const [chats, setChats] = useState<ChatUser[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})
  const [activePeer, setActivePeer] = useState<string | null>(null)
  const [socketState, setSocketState] = useState<ReturnType<typeof getSocket> | null>(null)
  const [hasSession, setHasSession] = useState(false)

  const tokenRef = useRef<string | null>(null)
  const activePeerRef = useRef<string | null>(null)
  const loadedPeersRef = useRef<Set<string>>(new Set())
  const healthPingRef = useRef(0)

  useEffect(() => {
    activePeerRef.current = activePeer
  }, [activePeer])

  const notify = useCallback((n: CallNotification) => {
    toast({ title: n.title, variant: n.kind === 'error' ? 'destructive' : undefined })
  }, [])

  const call = useCall(me?.username ?? null, socketState, notify)

  const requestHistory = useCallback((peer: string) => {
    loadedPeersRef.current.add(peer)
    socketState?.emit('history', { with: peer })
  }, [socketState])

  const markPeerRead = useCallback((peer: string) => {
    setUnread((prev) => (prev[peer] ? { ...prev, [peer]: 0 } : prev))
    socketState?.emit('read', { with: peer })
  }, [socketState])

  // ---------- socket lifecycle ----------
  useEffect(() => {
    tokenRef.current = tokenGet()
    setHasSession(!!tokenRef.current)
    const s = getSocket()

    const tryHealth = () => {
      const nowTs = Date.now()
      if (nowTs - healthPingRef.current < 10000) return
      healthPingRef.current = nowTs
      fetch('/api/health').catch(() => {})
    }

    const onConnect = () => {
      setConnected(true)
      if (tokenRef.current) s.emit('login', { token: tokenRef.current })
    }
    const onDisconnect = () => setConnected(false)
    const onConnectError = () => {
      setConnected(false)
      tryHealth()
    }

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    s.on('connect_error', onConnectError)

    // defer first paint state to the next tick (subscribes to the socket external system)
    const t = setTimeout(() => {
      setSocketState(s)
      if (s.connected) onConnect()
      else if (!tokenRef.current) setBooting(false)
    }, 0)
    // safety: never keep the splash forever if the socket service is unreachable
    const bootGuard = setTimeout(() => setBooting(false), 6000)

    return () => {
      clearTimeout(t)
      clearTimeout(bootGuard)
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.off('connect_error', onConnectError)
    }
  }, [])

  // ---------- data events ----------
  useEffect(() => {
    if (!socketState) return
    const s = socketState

    const onLoginOk = (d: { me: AuthUser; chats: ChatUser[]; unread: Record<string, number> }) => {
      setMe(d.me)
      setChats(d.chats ?? [])
      setUnread(d.unread ?? {})
      setBooting(false)
      setHasSession(true)
      loadedPeersRef.current = new Set()
      for (const u of d.chats ?? []) {
        loadedPeersRef.current.add(u.username)
        s.emit('history', { with: u.username })
      }
    }

    const onLoginError = () => {
      tokenRef.current = null
      tokenDel()
      setMe(null)
      setHasSession(false)
      setBooting(false)
      toast({ title: 'انتهت صلاحية الجلسة، سجّل الدخول من جديد', variant: 'destructive' })
    }

    const onSessionReplaced = () => {
      tokenRef.current = null
      tokenDel()
      setMe(null)
      setHasSession(false)
      toast({ title: 'تم فتح الحساب من نافذة أخرى' })
    }

    const onPresence = (d: { username: string; online: boolean; lastSeen: number }) => {
      setChats((prev) => {
        const idx = prev.findIndex((u) => u.username === d.username)
        if (idx === -1) return prev // only track presence of known chats
        const next = [...prev]
        next[idx] = { ...next[idx], online: d.online, lastSeen: d.lastSeen }
        return next
      })
    }

    const upsertChat = (u: ChatUser) => {
      setChats((prev) => {
        const idx = prev.findIndex((x) => x.username === u.username)
        if (idx === -1) return [...prev, u]
        const next = [...prev]
        next[idx] = { ...next[idx], ...u }
        return next
      })
    }

    const onDm = (d: { message: ChatMessage; fromUser?: AuthUser }) => {
      const m = d.message
      const other = m.from
      upsertChat({
        username: other,
        displayName: d.fromUser?.displayName || other,
        online: true,
        lastSeen: Date.now(),
      })
      setMessages((prev) => {
        const arr = prev[other] ?? []
        if (arr.some((x) => x.id === m.id)) return prev
        return { ...prev, [other]: [...arr, m] }
      })
      const isActiveChat = activePeerRef.current === other && document.visibilityState === 'visible'
      if (isActiveChat) {
        s.emit('read', { with: other })
      } else {
        setUnread((prev) => ({ ...prev, [other]: (prev[other] ?? 0) + 1 }))
        pop()
      }
    }

    const onDmAck = (d: { clientId: string | null; message: ChatMessage }) => {
      const m = d.message
      const other = m.to
      setMessages((prev) => {
        const arr = [...(prev[other] ?? [])]
        const idx = d.clientId ? arr.findIndex((x) => x.clientId === d.clientId) : -1
        if (idx >= 0) arr[idx] = m
        else if (!arr.some((x) => x.id === m.id)) arr.push(m)
        return { ...prev, [other]: arr }
      })
    }

    const onCallLog = (d: { with: string; message: ChatMessage }) => {
      const other = d.with
      setMessages((prev) => {
        const arr = prev[other] ?? []
        if (arr.some((x) => x.id === d.message.id)) return prev
        return { ...prev, [other]: [...arr, d.message] }
      })
    }

    const onHistory = (d: { with: string; messages: ChatMessage[] }) => {
      setMessages((prev) => {
        const pending = (prev[d.with] ?? []).filter((m) => m.pending)
        return { ...prev, [d.with]: [...d.messages, ...pending] }
      })
    }

    const onRead = (d: { by: string }) => {
      setMessages((prev) => {
        const arr = prev[d.by]
        if (!arr?.length) return prev
        const changed = arr.some((m) => m.from === me?.username && !m.readAt && !m.pending)
        if (!changed) return prev
        const nowTs = Date.now()
        return { ...prev, [d.by]: arr.map((m) => (m.from === me?.username && !m.readAt && !m.pending ? { ...m, readAt: nowTs } : m)) }
      })
    }

    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const onTyping = (d: { from: string; isTyping: boolean }) => {
      setTyping((prev) => ({ ...prev, [d.from]: d.isTyping }))
      const t = typingTimers.get(d.from)
      if (t) clearTimeout(t)
      if (d.isTyping) {
        typingTimers.set(d.from, setTimeout(() => {
          setTyping((prev) => ({ ...prev, [d.from]: false }))
        }, 4000))
      }
    }

    s.on('login:ok', onLoginOk)
    s.on('login:error', onLoginError)
    s.on('session-replaced', onSessionReplaced)
    s.on('presence', onPresence)
    s.on('dm', onDm)
    s.on('dm:ack', onDmAck)
    s.on('call-log', onCallLog)
    s.on('history', onHistory)
    s.on('read', onRead)
    s.on('typing', onTyping)

    return () => {
      s.off('login:ok', onLoginOk)
      s.off('login:error', onLoginError)
      s.off('session-replaced', onSessionReplaced)
      s.off('presence', onPresence)
      s.off('dm', onDm)
      s.off('dm:ack', onDmAck)
      s.off('call-log', onCallLog)
      s.off('history', onHistory)
      s.off('read', onRead)
      s.off('typing', onTyping)
      for (const t of typingTimers.values()) clearTimeout(t)
    }
  }, [socketState, me, requestHistory])

  // mark visible chat as read when tab becomes visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && activePeerRef.current) {
        markPeerRead(activePeerRef.current)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [markPeerRead])

  // unread count in tab title
  useEffect(() => {
    const total = Object.values(unread).reduce((a, b) => a + b, 0)
    document.title = total > 0 ? `(${total}) دردشة` : 'دردشة — رسائل ومكالمات'
  }, [unread])

  // ---------- actions ----------
  /** called by LoginScreen after a successful REST register/login */
  const authSuccess = (token: string, user: AuthUser) => {
    tokenRef.current = token
    tokenSet(token)
    setHasSession(true)
    setMe(user) // optimistic; login:ok confirms
    const s = getSocket()
    if (s.connected) s.emit('login', { token })
    // otherwise the connect handler emits login once connected
  }

  const logout = () => {
    tokenDel()
    tokenRef.current = null
    setMe(null)
    setHasSession(false)
    setChats([])
    setMessages({})
    setUnread({})
    setTyping({})
    setActivePeer(null)
    loadedPeersRef.current = new Set()
    // fresh session on the same socket (listeners stay attached)
    const s = getSocket()
    if (s.connected) s.disconnect()
    s.connect()
  }

  const searchUsers = useCallback(async (q: string): Promise<ChatUser[]> => {
    if (!tokenRef.current || !q.trim()) return []
    try {
      const r = await apiSearch(q, tokenRef.current)
      return r.users
    } catch {
      return []
    }
  }, [])

  const openChat = (user: ChatUser) => {
    setChats((prev) => {
      const idx = prev.findIndex((x) => x.username === user.username)
      if (idx === -1) return [...prev, user]
      const next = [...prev]
      next[idx] = { ...next[idx], ...user }
      return next
    })
    setActivePeer(user.username)
    if (!loadedPeersRef.current.has(user.username)) requestHistory(user.username)
    markPeerRead(user.username)
  }

  const sendMessage = (text: string) => {
    if (!me || !activePeer) return
    const clientId = crypto.randomUUID()
    const msg: ChatMessage = {
      id: clientId,
      from: me.username,
      to: activePeer,
      type: 'text',
      text,
      createdAt: Date.now(),
      pending: true,
      clientId,
    }
    setMessages((prev) => ({ ...prev, [activePeer]: [...(prev[activePeer] ?? []), msg] }))
    socketState?.emit('dm', { to: activePeer, text, clientId })
  }

  const startCall = (peer: string, type: 'audio' | 'video') => {
    if (call.busy) {
      toast({ title: 'أنت في مكالمة بالفعل', variant: 'destructive' })
      return
    }
    const peerName = chats.find((u) => u.username === peer)?.displayName
    call.startCall(peer, type, peerName)
  }

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0)

  if (booting && hasSession) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#e6ebee]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-[#3390ec]">
            <MessagesSquare className="h-8 w-8 text-white" />
          </div>
          <p className="text-sm text-[#708499]">جاري استعادة الجلسة…</p>
        </div>
      </div>
    )
  }

  if (!me) {
    return <LoginScreen onSubmit={authSuccess} />
  }

  const peerUser = activePeer ? chats.find((u) => u.username === activePeer) : undefined

  return (
    <div className="flex h-dvh overflow-hidden bg-[#dfe7ed]">
      {/* sidebar */}
      <aside
        className={cn(
          'h-full w-full shrink-0 md:w-[380px] md:border-e md:border-[#dfe3e8]',
          activePeer ? 'hidden md:block' : 'block'
        )}
      >
        <Sidebar
          me={me}
          chats={chats}
          unread={unread}
          typing={typing}
          messages={messages}
          activePeer={activePeer}
          connected={connected}
          onSearch={searchUsers}
          onOpen={openChat}
          onCall={startCall}
          onLogout={logout}
        />
      </aside>

      {/* chat area */}
      <main className={cn('h-full min-w-0 flex-1', activePeer ? 'block' : 'hidden md:block')}>
        {activePeer ? (
          <ChatWindow
            me={me.username}
            peer={activePeer}
            peerUser={peerUser}
            messages={messages[activePeer] ?? []}
            typing={!!typing[activePeer]}
            onBack={() => setActivePeer(null)}
            onSend={sendMessage}
            onCall={(type) => startCall(activePeer, type)}
          />
        ) : (
          <div className="tg-chat-bg flex h-full flex-col items-center justify-center gap-4 text-center">
            <Avatar name={me.username} displayName={me.displayName} size={88} online={connected} />
            <div>
              <p className="text-lg font-bold text-[#17212b]">مرحبًا، {me.displayName} 👋</p>
              <p className="mt-1 text-sm text-[#708499]" dir="ltr">
                @{me.username}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#5f7181]">
                ابحث في الأعلى عن معرّف صديقك — سيظهر حسابه فورًا لتفتح معه دردشة أو مكالمة
                صوتية/مرئية مع مشاركة الشاشة.
              </p>
              {totalUnread > 0 && (
                <p className="mt-3 inline-block rounded-full bg-[#3390ec] px-4 py-1 text-xs font-bold text-white">
                  لديك {totalUnread} رسالة غير مقروءة
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* call overlay */}
      {call.callInfo && call.callState !== 'idle' && (
        <CallOverlay
          callState={call.callState}
          callInfo={call.callInfo}
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          screenPreview={call.screenPreview}
          micMuted={call.micMuted}
          camOff={call.camOff}
          sharing={call.sharing}
          remoteSharing={call.remoteSharing}
          remoteVideoActive={call.remoteVideoActive}
          elapsed={call.elapsed}
          onAccept={() => void call.acceptCall()}
          onReject={call.rejectCall}
          onEnd={call.endCall}
          onToggleMic={call.toggleMic}
          onToggleCam={call.toggleCam}
          onToggleShare={call.toggleShare}
        />
      )}
    </div>
  )
}
