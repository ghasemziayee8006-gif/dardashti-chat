'use client'

/**
 * وضع مشاركة شاشة تجريبي للبيئات التي لا تدعم getDisplayMedia
 * (مثل WebView داخل تطبيق أندرويد).
 * يرسم عرضًا تقديميًا متحركًا على canvas و يبثّه كمسار فيديو حقيقي —
 * فالطرف الآخر يستلمه فعليًا عبر WebRTC كأنه شاشة مشتركة.
 */
export function createSimulatedScreenTrack(): { track: MediaStreamTrack; stop: () => void } {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no_canvas')

  let raf = 0
  const t0 = Date.now()
  const titles = ['تقرير المبيعات — الربع الأول', 'خطة المشروع الجديدة', 'إحصائيات التطبيق']

  const draw = () => {
    const W = canvas.width
    const H = canvas.height
    const t = (Date.now() - t0) / 1000
    const slide = Math.floor(t / 6) % 3

    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, '#16283c')
    g.addColorStop(1, '#0d1b2a')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    ctx.textAlign = 'center'
    ctx.fillStyle = '#e9eff5'
    ctx.font = 'bold 56px Cairo, Tajawal, sans-serif'
    ctx.fillText(titles[slide], W / 2, H * 0.2)
    ctx.fillStyle = '#7f91a4'
    ctx.font = '28px Cairo, Tajawal, sans-serif'
    ctx.fillText(`شريحة ${slide + 1} من 3 — مشاركة شاشة (وضع تجريبي)`, W / 2, H * 0.28)

    if (slide === 0) {
      const bars = [0.55, 0.8, 0.42, 0.95, 0.68, 0.77]
      const bw = W / 10
      const x0 = W * 0.18
      bars.forEach((h, i) => {
        const hh = H * 0.42 * (0.6 + 0.4 * Math.abs(Math.sin(t * 1.2 + i)))
        ctx.fillStyle = i % 2 ? '#38b6d8' : '#2a6bc9'
        const x = x0 + i * bw * 1.35
        const y = H * 0.85 - hh
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, bw, hh, 8)
          ctx.fill()
        } else {
          ctx.fillRect(x, y, bw, hh)
        }
      })
    } else if (slide === 1) {
      ctx.strokeStyle = '#38b6d8'
      ctx.lineWidth = 5
      ctx.beginPath()
      for (let x = 0; x <= W * 0.7; x += 6) {
        const y = H * 0.58 + Math.sin(x / 60 + t * 2) * H * 0.09
        if (x === 0) ctx.moveTo(W * 0.15 + x, y)
        else ctx.lineTo(W * 0.15 + x, y)
      }
      ctx.stroke()
      ctx.fillStyle = '#31c48d'
      ctx.font = 'bold 52px Cairo, Tajawal, sans-serif'
      ctx.fillText('التقدم: 78٪ ▲', W / 2, H * 0.84)
    } else {
      const nums = ['+48٪', '12 ألف', '4.9 ★']
      const labels = ['نمو المستخدمين', 'رسالة يوميًا', 'تقييم المتجر']
      nums.forEach((n, i) => {
        const x = W * (0.25 + i * 0.25)
        const y = H * 0.55
        ctx.fillStyle = '#e9eff5'
        ctx.font = 'bold 72px Cairo, Tajawal, sans-serif'
        ctx.fillText(n, x, y)
        ctx.fillStyle = '#7f91a4'
        ctx.font = '30px Cairo, Tajawal, sans-serif'
        ctx.fillText(labels[i], x, y + H * 0.08)
      })
    }

    raf = requestAnimationFrame(draw)
  }
  draw()

  const stream = canvas.captureStream(24)
  const track = stream.getVideoTracks()[0]
  return {
    track,
    stop: () => {
      cancelAnimationFrame(raf)
    },
  }
}
