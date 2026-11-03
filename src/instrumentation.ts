// Auto-starts the socket.io call-service (port 3003) whenever the
// Next.js server boots, so the chat backend is always available.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
