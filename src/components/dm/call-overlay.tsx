'use client'

import { useEffect, useRef } from 'react'
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { Avatar } from '@/components/dm/avatar'
import type { CallInfo, CallState } from '@/lib/dm/types'
import { formatClock } from '@/lib/dm/utils'
import { cn } from '@/lib/utils'

function VideoTile({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null
  muted?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (stream && el.srcObject !== stream) el.srcObject = stream
    if (!stream) el.srcObject = null
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />
}

function CtrlButton({
  onClick,
  active,
  danger,
  label,
  children,
  disabled,
}: {
  onClick: () => void
  active?: boolean
  danger?: boolean
  label: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={cn(
          'flex h-13 w-13 items-center justify-center rounded-full p-3.5 text-white shadow-lg backdrop-blur transition-all active:scale-95 disabled:opacity-40',
          danger
            ? 'bg-[#e53935] hover:bg-[#d32f2f]'
            : active
              ? 'bg-[#00b894] hover:bg-[#00a884]'
              : 'bg-white/15 hover:bg-white/25'
        )}
      >
        {children}
      </button>
      <span className="text-[11px] font-medium text-white/70">{label}</span>
    </div>
  )
}

const statusText = (s: CallState): string =>
  s === 'incoming'
    ? 'مكالمة واردة…'
    : s === 'outgoing'
      ? 'جاري الاتصال…'
      : s === 'connecting'
        ? 'جاري التوصيل…'
        : ''

export function CallOverlay({
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
  onAccept,
  onReject,
  onEnd,
  onToggleMic,
  onToggleCam,
  onToggleShare,
}: {
  callState: CallState
  callInfo: CallInfo
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  screenPreview: MediaStream | null
  micMuted: boolean
  camOff: boolean
  sharing: boolean
  remoteSharing: boolean
  remoteVideoActive: boolean
  elapsed: number
  onAccept: () => void
  onReject: () => void
  onEnd: () => void
  onToggleMic: () => void
  onToggleCam: () => void
  onToggleShare: () => void
}) {
  const audioCall = callInfo.type === 'audio'
  const showVideoArea =
    callState === 'active' &&
    (callInfo.type === 'video' || remoteSharing || remoteVideoActive)
  const showPip =
    showVideoArea && (!audioCall || sharing || (localStream?.getVideoTracks().length ?? 0) > 0)

  const status =
    callState === 'active' ? formatClock(elapsed) : statusText(callState)

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col',
        showVideoArea ? 'bg-black' : 'bg-gradient-to-b from-[#232f3d] via-[#1b2634] to-[#101820]'
      )}
      role="dialog"
      aria-label={`مكالمة مع ${callInfo.peer}`}
    >
      {/* top info */}
      <div className="flex flex-col items-center gap-1.5 pt-[max(1.25rem,env(safe-area-inset-top))] text-white">
        <p className="text-lg font-bold">{callInfo.peerName ?? callInfo.peer}</p>
        <p className="text-sm text-white/70" dir="ltr">@{callInfo.peer}</p>
        <p className="text-sm text-white/70">{status}</p>
        {sharing && (
          <span className="mt-1 flex items-center gap-1.5 rounded-full bg-[#00b894]/90 px-3 py-1 text-xs font-bold">
            <MonitorUp className="h-3.5 w-3.5" />
            أنت تشارك شاشتك الآن
          </span>
        )}
        {remoteSharing && (
          <span className="mt-1 flex items-center gap-1.5 rounded-full bg-[#f39c12]/90 px-3 py-1 text-xs font-bold">
            <MonitorUp className="h-3.5 w-3.5" />
            {callInfo.peerName ?? callInfo.peer} يشارك شاشته معك
          </span>
        )}
      </div>

      {/* main area */}
      <div className="relative flex-1 overflow-hidden">
        {showVideoArea ? (
          <>
            <VideoTile
              stream={remoteStream}
              className="h-full w-full object-contain"
            />
            {!remoteVideoActive && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-white/70">
                  <div className="h-20 w-20 animate-pulse rounded-full bg-white/10" />
                  <p className="text-sm">
                    {remoteSharing ? 'جاري عرض شاشة الطرف الآخر…' : 'الكاميرا متوقفة عن العمل'}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-6">
            <div className="relative">
              {(callState === 'incoming' || callState === 'outgoing') && (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full bg-white/10" />
                  <span
                    className="absolute inset-0 animate-ping rounded-full bg-white/5"
                    style={{ animationDelay: '0.6s' }}
                  />
                </>
              )}
              <Avatar name={callInfo.peer} displayName={callInfo.peerName} size={128} />
            </div>
          </div>
        )}

        {/* local PiP */}
        {showPip && (
          <div className="absolute bottom-4 end-4 w-28 overflow-hidden rounded-xl border border-white/20 shadow-xl sm:w-44">
            <VideoTile
              stream={screenPreview ?? localStream}
              muted
              className={cn('aspect-[3/4] w-full object-cover', !sharing && '-scale-x-100')}
            />
          </div>
        )}
      </div>

      {/* controls */}
      <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        {callState === 'incoming' ? (
          <div className="flex items-center justify-center gap-16">
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={onReject}
                aria-label="رفض المكالمة"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e53935] text-white shadow-xl transition-transform active:scale-95"
              >
                <PhoneOff className="h-7 w-7" />
              </button>
              <span className="text-xs text-white/70">رفض</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={onAccept}
                aria-label="قبول المكالمة"
                className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[#4caf50] text-white shadow-xl transition-transform active:scale-95"
              >
                <span className="absolute inset-0 animate-ping rounded-full bg-[#4caf50]/50" />
                <Phone className="h-7 w-7" />
              </button>
              <span className="text-xs text-white/70">قبول</span>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md items-center justify-center gap-5 sm:gap-8">
            <CtrlButton
              onClick={onToggleMic}
              active={micMuted ? false : false}
              danger={micMuted}
              label={micMuted ? 'إلغاء الكتم' : 'كتم'}
            >
              {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </CtrlButton>

            {!audioCall && (
              <CtrlButton
                onClick={onToggleCam}
                danger={camOff}
                label={camOff ? 'تشغيل الكاميرا' : 'إيقاف الكاميرا'}
                disabled={sharing}
              >
                {camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </CtrlButton>
            )}

            <CtrlButton
              onClick={onToggleShare}
              active={sharing}
              label={sharing ? 'إيقاف المشاركة' : 'مشاركة الشاشة'}
              disabled={callState !== 'active'}
            >
              <MonitorUp className="h-5 w-5" />
            </CtrlButton>

            <CtrlButton onClick={onEnd} danger label="إنهاء">
              <PhoneOff className="h-5 w-5" />
            </CtrlButton>
          </div>
        )}
      </div>
    </div>
  )
}
