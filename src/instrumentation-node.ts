// Node-only instrumentation: ensures the call-service process is running.
export async function register() {
  const g = globalThis as unknown as { __callServiceStarted?: boolean }
  if (g.__callServiceStarted) return
  g.__callServiceStarted = true

  try {
    const { spawn } = await import('child_process')
    const net = await import('net')

    const isUp = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ port: 3003, host: '127.0.0.1' })
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => { s.destroy(); resolve(false) })
      setTimeout(() => { s.destroy(); resolve(false) }, 1200)
    })

    if (!isUp) {
      const child = spawn('bun', ['index.ts'], {
        cwd: '/home/z/my-project/mini-services/call-service',
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      console.log('[instrumentation] call-service spawned (pid', child.pid, ')')
    } else {
      console.log('[instrumentation] call-service already running')
    }
  } catch (e) {
    console.error('[instrumentation] failed to ensure call-service:', e)
  }
}
