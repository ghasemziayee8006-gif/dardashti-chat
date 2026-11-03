'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { startRingback, startRingtone } from '@/lib/dm/sounds'
import { createSimulatedScreenTrack } from '@/lib/dm/sim-screen'
import type { CallInfo, CallState, CallType } from '@/lib/dm/types'

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
}

const OUTGOING_TIMEOUT_MS = 45_000

export interface CallNotification {
  title: string
  kind?: 'info' | 'error'
}

export function useCall(me: string | null, socket: Socket | null, notify: (n: CallNotification) => void) {
  const [callState, setCallState] = useState<CallState>('idle')
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null)
  const [screenPreview, setScreenPreview] = useState<MediaStream | null>(null)
  const [micMuted, setMicMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [remoteSharing, setRemoteSharing] = useState(false)
  const [remoteVideoActive, setRemoteVideoActive] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // stable MediaStream objects (client only — MediaStream doesn't exist on the server)
  const [localStream] = useState<MediaStream | null>(() => (typeof MediaStream !== 'undefined' ? new MediaStream() : null))
  const [remoteStream] = useState<MediaStream | null>(() => (typeof MediaStream !== 'undefined' ? new MediaStream() : null))

  const stateRef = useRef<CallState>('idle')
  const callRef = useRef<CallInfo | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const audioTrackRef = useRef<MediaStreamTrack | null>(null)
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  const audioSenderRef = useRef<RTCRtpSender | null>(null)
  const videoSenderRef = useRef<RTCRtpSender | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const remoteReadyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopSoundRef = useRef<(() => void) | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyRef = useRef(notify)
  const camOffRef = useRef(false)
  const simStopRef = useRef<(() => void) | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  useEffect(() => {
    socketRef.current = socket
  }, [socket])

  useEffect(() => {
    localStreamRef.current = localStream
    remoteStreamRef.current = remoteStream
  }, [localStream, remoteStream])

  const setState = useCallback((s: CallState) => {
    stateRef.current = s
    setCallState(s)
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }, [])

  /** tear everything down and go back to idle */
  const cleanup = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    stopSoundRef.current?.()
    stopSoundRef.current = null
    try { pcRef.current?.close() } catch { /* noop */ }
    pcRef.current = null
    audioSenderRef.current = null
    videoSenderRef.current = null
    audioTrackRef.current?.stop()
    audioTrackRef.current = null
    cameraTrackRef.current?.stop()
    cameraTrackRef.current = null
    screenTrackRef.current?.stop()
    screenTrackRef.current = null
    simStopRef.current?.()
    simStopRef.current = null
    remoteStreamRef.current?.getTracks().forEach((t) => remoteStreamRef.current?.removeTrack(t))
    localStreamRef.current?.getTracks().forEach((t) => localStreamRef.current?.removeTrack(t))
    remoteReadyRef.current = false
    pendingIceRef.current = []
    setElapsed(0)
    setMicMuted(false)
    setCamOff(false)
    setSharing(false)
    setRemoteSharing(false)
    setRemoteVideoActive(false)
    setScreenPreview(null)
    callRef.current = null
    setCallInfo(null)
    setState('idle')
  }, [setState])

  const ensurePc = useCallback((): RTCPeerConnection => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection(RTC_CONFIG)
    pcRef.current = pc

    pc.ontrack = (e) => {
      const t = e.track
      remoteStreamRef.current?.addTrack(t)
      if (t.kind === 'video') {
        const update = () => setRemoteVideoActive(!t.muted)
        t.addEventListener('mute', update)
        t.addEventListener('unmute', update)
        update()
      }
    }
    pc.onicecandidate = (e) => {
      const info = callRef.current
      if (e.candidate && info) {
        socketRef.current?.emit('rtc:ice', { to: info.peer, candidate: e.candidate.toJSON() })
      }
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected' && stateRef.current !== 'idle' && stateRef.current !== 'active') {
        setState('active')
        startTimer()
      } else if ((st === 'failed' || st === 'closed') && stateRef.current !== 'idle') {
        notifyRef.current({ title: 'انقطع الاتصال', kind: 'error' })
        cleanup()
      }
    }
    return pc
  }, [cleanup, setState, startTimer])

  const attachLocalAudio = useCallback(async () => {
    if (audioTrackRef.current) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    const track = stream.getAudioTracks()[0]
    audioTrackRef.current = track
    localStreamRef.current?.addTrack(track)
    if (pcRef.current) {
      if (audioSenderRef.current) await audioSenderRef.current.replaceTrack(track)
      else audioSenderRef.current = pcRef.current.addTrack(track, localStreamRef.current!)
    }
  }, [])

  const attachCamera = useCallback(async () => {
    if (cameraTrackRef.current) return
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    })
    const track = stream.getVideoTracks()[0]
    cameraTrackRef.current = track
    localStreamRef.current?.addTrack(track)
    setCamOff(false)
    if (pcRef.current && !screenTrackRef.current) {
      if (videoSenderRef.current) await videoSenderRef.current.replaceTrack(track)
      else videoSenderRef.current = pcRef.current.addTrack(track, localStreamRef.current!)
    }
  }, [])

  /** decides what the video sender should carry: screen > camera > nothing */
  const applyVideo = useCallback(async () => {
    const track = screenTrackRef.current ?? (cameraTrackRef.current && !camOffRef.current ? cameraTrackRef.current : null)
    await videoSenderRef.current?.replaceTrack(track)
  }, [])

  // ---------- actions ----------
  const startCall = useCallback((peer: string, type: CallType, peerName?: string) => {
    const socket = socketRef.current
    if (!socket || stateRef.current !== 'idle' || !me || peer === me) return
    const callId = crypto.randomUUID()
    const info: CallInfo = { callId, peer, peerName, type, direction: 'out' }
    callRef.current = info
    setCallInfo(info)
    setState('outgoing')
    stopSoundRef.current = startRingback()
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      if (stateRef.current === 'outgoing') {
        socket.emit('call:cancel', { callId })
        notifyRef.current({ title: 'لا رد — أُلغيت المكالمة' })
        cleanup()
      }
    }, OUTGOING_TIMEOUT_MS)
    socket.emit('call:invite', { to: peer, type, callId })
  }, [cleanup, me, setState])

  const acceptCall = useCallback(async () => {
    const info = callRef.current
    const socket = socketRef.current
    if (!info || !socket || stateRef.current !== 'incoming') return
    setState('connecting')
    stopSoundRef.current?.()
    stopSoundRef.current = null
    socket.emit('call:accept', { callId: info.callId })
    try {
      await attachLocalAudio()
      if (info.type === 'video') await attachCamera()
    } catch {
      notifyRef.current({ title: 'تعذر الوصول إلى المايكروفون أو الكاميرا', kind: 'error' })
      socket.emit('call:end', { callId: info.callId })
      cleanup()
    }
  }, [attachCamera, attachLocalAudio, cleanup, setState])

  const rejectCall = useCallback(() => {
    const info = callRef.current
    if (!info || stateRef.current !== 'incoming') return
    socketRef.current?.emit('call:reject', { callId: info.callId })
    cleanup()
  }, [cleanup])

  const endCall = useCallback(() => {
    const info = callRef.current
    const socket = socketRef.current
    if (!info || !socket) { cleanup(); return }
    if (stateRef.current === 'incoming') {
      socket.emit('call:reject', { callId: info.callId })
    } else if (stateRef.current === 'outgoing') {
      socket.emit('call:cancel', { callId: info.callId })
    } else {
      socket.emit('call:end', { callId: info.callId })
    }
    cleanup()
  }, [cleanup])

  const toggleMic = useCallback(() => {
    const track = audioTrackRef.current
    if (!track) return
    track.enabled = !track.enabled
    setMicMuted(!track.enabled)
  }, [])

  const toggleCam = useCallback(() => {
    if (!cameraTrackRef.current || screenTrackRef.current) return
    const nv = !camOffRef.current
    camOffRef.current = nv
    setCamOff(nv)
    void applyVideo()
  }, [applyVideo])

  const stopShare = useCallback(async () => {
    const info = callRef.current
    if (!info || !screenTrackRef.current) return
    screenTrackRef.current.stop()
    screenTrackRef.current = null
    simStopRef.current?.()
    simStopRef.current = null
    setScreenPreview(null)
    setSharing(false)
    await applyVideo()
    socketRef.current?.emit('rtc:screen', { to: info.peer, sharing: false })
  }, [applyVideo])

  const startShare = useCallback(async () => {
    const info = callRef.current
    if (!info || stateRef.current !== 'active' || screenTrackRef.current) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      screenTrackRef.current = track
      track.addEventListener('ended', () => { void stopShare() })
      const preview = new MediaStream([track])
      setScreenPreview(preview)
      await videoSenderRef.current?.replaceTrack(track)
      setSharing(true)
      socketRef.current?.emit('rtc:screen', { to: info.peer, sharing: true })
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'AbortError') return
      // البيئات التي لا تدعم التقاط الشاشة (WebView في أندرويد):
      // نستخدم عرضًا تجريبيًا متحركًا — يُبثّ للطرف الآخر كمسار فيديو حقيقي
      try {
        const sim = createSimulatedScreenTrack()
        const track = sim.track
        simStopRef.current = sim.stop
        screenTrackRef.current = track
        track.addEventListener('ended', () => { void stopShare() })
        setScreenPreview(new MediaStream([track]))
        await videoSenderRef.current?.replaceTrack(track)
        setSharing(true)
        socketRef.current?.emit('rtc:screen', { to: info.peer, sharing: true })
      } catch {
        notifyRef.current({ title: 'تعذر بدء مشاركة الشاشة', kind: 'error' })
      }
    }
  }, [stopShare])

  const toggleShare = useCallback(() => {
    if (sharing) void stopShare()
    else void startShare()
  }, [sharing, startShare, stopShare])

  // ---------- socket events ----------

  useEffect(() => {
    if (!socket || !me) return

    type Handler = (data: Record<string, unknown>) => void
    const handlers: Array<[string, Handler]> = []

    const on = (ev: string, h: Handler) => {
      handlers.push([ev, h as Handler])
      socket.on(ev, h as never)
    }

    on('call:incoming', (d) => {
      const callId = String(d.callId ?? '')
      const from = String(d.from ?? '')
      const peerName = typeof (d.fromUser as { displayName?: string } | undefined)?.displayName === 'string'
        ? (d.fromUser as { displayName: string }).displayName
        : undefined
      const type = d.type === 'video' ? 'video' : 'audio'
      if (stateRef.current !== 'idle') {
        socket.emit('call:reject', { callId })
        return
      }
      const info: CallInfo = { callId, peer: from, peerName, type, direction: 'in' }
      callRef.current = info
      setCallInfo(info)
      setState('incoming')
      stopSoundRef.current = startRingtone()
    })

    on('call:accepted', (d) => {
      const info = callRef.current
      if (!info || info.direction !== 'out') return
      // الخادم يولّد معرّف المكالمة الخاص به — نتبنّاه حتى تتطابق أحداث النهاية والسجل
      if (typeof d.callId === 'string' && d.callId) info.callId = d.callId
      stopSoundRef.current?.()
      stopSoundRef.current = null
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
      setState('connecting')
      void (async () => {
        try {
          const pc = ensurePc()
          if (!audioSenderRef.current) {
            audioSenderRef.current = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender
            videoSenderRef.current = pc.addTransceiver('video', { direction: 'sendrecv' }).sender
          }
          await attachLocalAudio()
          if (info.type === 'video') await attachCamera()
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socketRef.current?.emit('rtc:offer', { to: info.peer, sdp: offer.sdp })
        } catch {
          notifyRef.current({ title: 'تعذر الوصول إلى المايكروفون أو الكاميرا', kind: 'error' })
          socketRef.current?.emit('call:end', { callId: info.callId })
          cleanup()
        }
      })()
    })

    on('call:rejected', (d) => {
      if (callRef.current?.peer === String(d.from ?? '')) {
        notifyRef.current({ title: 'تم رفض المكالمة' })
        cleanup()
      }
    })

    on('call:cancelled', (d) => {
      if (callRef.current?.peer === String(d.from ?? '')) {
        notifyRef.current({ title: 'أُلغيت المكالمة' })
        cleanup()
      }
    })

    on('call:ended', (d) => {
      if (callRef.current?.peer === String(d.from ?? '')) {
        const dur = Number(d.duration ?? 0)
        notifyRef.current({ title: dur > 0 ? `انتهت المكالمة · ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : 'انتهت المكالمة' })
        cleanup()
      }
    })

    on('call:error', (d) => {
      const reason = String(d.reason ?? '')
      notifyRef.current({
        title:
          reason === 'offline'
            ? 'الطرف الآخر غير متصل حاليًا'
            : reason === 'busy'
              ? 'الطرف الآخر في مكالمة أخرى'
              : 'تعذر إجراء المكالمة',
        kind: 'error',
      })
      cleanup()
    })

    on('rtc:offer', (d) => {
      void (async () => {
        const info = callRef.current
        const sdp = typeof d.sdp === 'string' ? d.sdp : null
        if (!info || info.direction !== 'in' || !sdp || String(d.from ?? '') !== info.peer) return
        try {
          const pc = ensurePc()
          await pc.setRemoteDescription({ type: 'offer', sdp })
          remoteReadyRef.current = true
          for (const t of pc.getTransceivers()) {
            if (t.receiver.track.kind === 'audio') {
              if (!audioSenderRef.current) audioSenderRef.current = t.sender
              t.direction = 'sendrecv'
            } else if (t.receiver.track.kind === 'video') {
              if (!videoSenderRef.current) videoSenderRef.current = t.sender
              t.direction = 'sendrecv'
            }
          }
          if (audioTrackRef.current) await audioSenderRef.current?.replaceTrack(audioTrackRef.current)
          if (cameraTrackRef.current && !screenTrackRef.current) {
            await videoSenderRef.current?.replaceTrack(cameraTrackRef.current)
          }
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          for (const c of pendingIceRef.current) {
            await pc.addIceCandidate(c).catch(() => {})
          }
          pendingIceRef.current = []
          socketRef.current?.emit('rtc:answer', { to: info.peer, sdp: answer.sdp })
        } catch {
          notifyRef.current({ title: 'فشل establishing المكالمة', kind: 'error' })
          socketRef.current?.emit('call:end', { callId: info.callId })
          cleanup()
        }
      })()
    })

    on('rtc:answer', (d) => {
      void (async () => {
        const info = callRef.current
        const sdp = typeof d.sdp === 'string' ? d.sdp : null
        if (!info || info.direction !== 'out' || !sdp || String(d.from ?? '') !== info.peer) return
        if (!pcRef.current || remoteReadyRef.current) return
        try {
          await pcRef.current.setRemoteDescription({ type: 'answer', sdp })
          remoteReadyRef.current = true
          for (const c of pendingIceRef.current) {
            await pcRef.current.addIceCandidate(c).catch(() => {})
          }
          pendingIceRef.current = []
        } catch {
          notifyRef.current({ title: 'فشل establishing المكالمة', kind: 'error' })
          socketRef.current?.emit('call:end', { callId: info.callId })
          cleanup()
        }
      })()
    })

    on('rtc:ice', (d) => {
      void (async () => {
        const info = callRef.current
        const cand = d.candidate as RTCIceCandidateInit | undefined
        if (!info || !cand || String(d.from ?? '') !== info.peer) return
        if (!pcRef.current || !remoteReadyRef.current) {
          pendingIceRef.current.push(cand)
          return
        }
        await pcRef.current.addIceCandidate(cand).catch(() => {})
      })()
    })

    on('rtc:screen', (d) => {
      if (callRef.current?.peer === String(d.from ?? '')) {
        setRemoteSharing(!!d.sharing)
      }
    })

    return () => {
      for (const [ev, h] of handlers) socket.off(ev, h as never)
    }
  }, [socket, me, cleanup, ensurePc, attachLocalAudio, attachCamera, setState])

  // stop everything when the component unmounts
  useEffect(() => {
    return () => {
      try { pcRef.current?.close() } catch { /* noop */ }
      audioTrackRef.current?.stop()
      cameraTrackRef.current?.stop()
      screenTrackRef.current?.stop()
      stopSoundRef.current?.()
      if (timerRef.current) clearInterval(timerRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const busy = callState !== 'idle'

  return {
    // state
    callState,
    callInfo,
    localStream,
    remoteStream,
    screenPreview,
    micMuted,
    camOff,
    sharing,
    remoteSharing,
    remoteVideoActive,
    elapsed,
    busy,
    // actions
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCam,
    toggleShare,
  }
}
