'use client'

const AVATAR_COLORS = [
  '#e17076', '#7bc862', '#e5ca77', '#65aadd', '#a695e7',
  '#ee7aae', '#6ec9cb', '#faa774', '#3ec1d3', '#f08cae',
]

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function initial(name: string): string {
  return (name.trim()[0] ?? '؟').toUpperCase()
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('ar-MA', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

export function formatDay(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'اليوم'
  if (same(d, yesterday)) return 'أمس'
  return new Intl.DateTimeFormat('ar-MA', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

export function formatLastSeen(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const time = formatTime(ts)
  if (d.toDateString() === today.toDateString()) return `آخر ظهور اليوم في ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `آخر ظهور أمس في ${time}`
  const date = new Intl.DateTimeFormat('ar-MA', { day: 'numeric', month: 'long' }).format(d)
  return `آخر ظهور ${date} في ${time}`
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s} ثانية`
  if (s === 0) return `${m} دقيقة`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function parseCallMeta(text: string): CallMetaLike | null {
  try {
    const o = JSON.parse(text)
    if (o && typeof o === 'object' && 'kind' in o) return o as CallMetaLike
    return null
  } catch {
    return null
  }
}

export interface CallMetaLike {
  kind: 'ended' | 'missed' | 'rejected' | 'cancelled'
  callType: 'audio' | 'video'
  duration: number
}

export function callLogText(meta: CallMetaLike): string {
  const t = meta.callType === 'video' ? 'مكالمة مرئية' : 'مكالمة صوتية'
  switch (meta.kind) {
    case 'ended':
      return `${t} · ${formatDuration(meta.duration)}`
    case 'missed':
      return `${t} فائتة`
    case 'rejected':
      return `${t} غير مجابة`
    case 'cancelled':
      return `${t} ملغاة`
    default:
      return t
  }
}
