'use client'

// Synthesized call tones & notification blips (no audio assets needed)
let ctx: AudioContext | null = null

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    try {
      ctx = new AC()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(c: AudioContext, freq: number, start: number, dur: number, vol = 0.08) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(vol, start + 0.03)
  g.gain.setValueAtTime(vol, start + dur - 0.06)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
}

/** short blip when a new message arrives */
export function pop() {
  const c = ensureCtx()
  if (!c) return
  const t = c.currentTime
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(880, t)
  o.frequency.exponentialRampToValueAtTime(1320, t + 0.09)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.1, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  o.connect(g)
  g.connect(c.destination)
  o.start(t)
  o.stop(t + 0.2)
}

/** repeating double-beep for incoming calls (also vibrates) */
export function startRingtone(): () => void {
  const c = ensureCtx()
  if (!c) return () => {}
  let stopped = false
  const beep = () => {
    if (stopped) return
    const t = c.currentTime
    tone(c, 660, t, 0.35, 0.09)
    tone(c, 660, t + 0.55, 0.35, 0.09)
  }
  beep()
  const iv = setInterval(beep, 2600)
  const vib = setInterval(() => navigator.vibrate?.([350, 250, 350]), 1400)
  navigator.vibrate?.([350, 250, 350])
  return () => {
    stopped = true
    clearInterval(iv)
    clearInterval(vib)
    navigator.vibrate?.(0)
  }
}

/** soft ringback tone while waiting for the other side to accept */
export function startRingback(): () => void {
  const c = ensureCtx()
  if (!c) return () => {}
  let stopped = false
  const beep = () => {
    if (stopped) return
    tone(c, 425, c.currentTime, 1.0, 0.05)
  }
  beep()
  const iv = setInterval(beep, 3000)
  return () => {
    stopped = true
    clearInterval(iv)
  }
}
