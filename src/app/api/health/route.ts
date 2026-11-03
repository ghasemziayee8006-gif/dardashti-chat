import { NextResponse } from 'next/server'
import net from 'net'
import { spawn } from 'child_process'

export const dynamic = 'force-dynamic'

// Health-check fallback: pings the call-service; restarts it if it died.
export async function GET() {
  const up = await new Promise<boolean>((resolve) => {
    const s = net.createConnection({ port: 3003, host: '127.0.0.1' })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => { s.destroy(); resolve(false) })
    setTimeout(() => { s.destroy(); resolve(false) }, 1200)
  })

  if (up) return NextResponse.json({ ok: true, service: 'running' })

  try {
    const child = spawn('bun', ['index.ts'], {
      cwd: '/home/z/my-project/mini-services/call-service',
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  } catch {
    // ignore spawn errors
  }

  await new Promise((r) => setTimeout(r, 1200))
  return NextResponse.json({ ok: true, service: 'restarted' })
}
