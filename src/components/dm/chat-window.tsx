'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CheckCheck, Phone, Send, Video } from 'lucide-react'
import { Avatar } from '@/components/dm/avatar'
import { Input } from '@/components/ui/input'
import type { ChatMessage, ChatUser } from '@/lib/dm/types'
import { callLogText, formatDay, formatLastSeen, formatTime, parseCallMeta } from '@/lib/dm/utils'
import { cn } from '@/lib/utils'

function DayPill({ label }: { label: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-[#708499] shadow-sm">
        {label}
      </span>
    </div>
  )
}

function CallPill({ message }: { message: ChatMessage }) {
  const meta = parseCallMeta(message.text)
  const text = meta ? callLogText(meta) : 'مكالمة'
  return (
    <div className="my-2 flex justify-center">
      <span
        className={cn(
          'rounded-full px-3.5 py-1.5 text-xs font-medium shadow-sm',
          meta?.kind === 'ended'
            ? 'bg-white/85 text-[#17212b]'
            : 'bg-[#fff4e5] text-[#b3740f]'
        )}
      >
        {meta?.kind === 'ended' ? '📞' : '📵'} {text}
      </span>
    </div>
  )
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <div className={cn('flex w-full', mine ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-3 py-1.5 text-[15px] leading-6 shadow-sm sm:max-w-[65%]',
          mine
            ? 'ms-auto rounded-ee-md bg-[#effdde] text-[#17212b]'
            : 'me-auto rounded-es-md bg-white text-[#17212b]'
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <span className="float-start ms-2 mt-1 flex items-center gap-1 text-[11px] leading-none text-[#9aa7b3]">
          {message.pending && <span className="italic">جاري الإرسال…</span>}
          {!message.pending && formatTime(message.createdAt)}
          {mine && !message.pending && (
            message.readAt ? (
              <CheckCheck className="h-3.5 w-3.5 text-[#3390ec]" aria-label="تمت القراءة" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-label="تم الإرسال" />
            )
          )}
        </span>
      </div>
    </div>
  )
}

export function ChatWindow({
  me,
  peer,
  peerUser,
  messages,
  typing,
  onBack,
  onSend,
  onCall,
}: {
  me: string
  peer: string
  peerUser: ChatUser | undefined
  messages: ChatMessage[]
  typing: boolean
  onBack: () => void
  onSend: (text: string) => void
  onCall: (type: 'audio' | 'video') => void
}) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickToBottom.current) {
      el.scrollTo({ top: el.scrollHeight })
    }
  }, [messages, typing, peer])

  const grouped = useMemo(() => {
    const out: Array<{ day: string; items: ChatMessage[] }> = []
    for (const m of messages) {
      const day = formatDay(m.createdAt)
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(m)
      else out.push({ day, items: [m] })
    }
    return out
  }, [messages])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
    stickToBottom.current = true
  }

  const status = typing
    ? 'يكتب الآن…'
    : peerUser?.online
      ? 'متصل الآن'
      : peerUser?.lastSeen
        ? formatLastSeen(peerUser.lastSeen)
        : `@${peer}`

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex items-center gap-2 border-b border-[#e7ebf0] bg-white px-3 py-2 md:px-4">
        <button
          onClick={onBack}
          className="rounded-full p-2 text-[#708499] transition-colors hover:bg-[#f4f7fa] md:hidden"
          aria-label="رجوع"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
        <Avatar name={peer} displayName={peerUser?.displayName} size={40} online={peerUser?.online} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15px] font-bold text-[#17212b]">{peerUser?.displayName || peer}</span>
            <span className="truncate text-xs text-[#708499]" dir="ltr">@{peer}</span>
          </p>
          <p className={cn('truncate text-xs', typing ? 'font-medium text-[#3390ec]' : 'text-[#708499]')}>
            {status}
          </p>
        </div>
        <button
          onClick={() => onCall('audio')}
          className="rounded-full p-2.5 text-[#708499] transition-colors hover:bg-[#f4f7fa] hover:text-[#3390ec]"
          title="مكالمة صوتية"
          aria-label="بدء مكالمة صوتية"
        >
          <Phone className="h-5 w-5" />
        </button>
        <button
          onClick={() => onCall('video')}
          className="rounded-full p-2.5 text-[#708499] transition-colors hover:bg-[#f4f7fa] hover:text-[#3390ec]"
          title="مكالمة مرئية"
          aria-label="بدء مكالمة مرئية"
        >
          <Video className="h-5 w-5" />
        </button>
      </header>

      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="tg-chat-bg tg-scrollbar flex-1 overflow-y-auto px-3 py-2 md:px-6"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="rounded-full bg-white/85 px-4 py-2 text-sm text-[#708499] shadow-sm">
              أرسل أول رسالة إلى {peerUser?.displayName || peer}
            </p>
          </div>
        )}
        {grouped.map((g) => (
          <div key={g.day}>
            <DayPill label={g.day} />
            {g.items.map((m) =>
              m.type === 'call' ? (
                <CallPill key={m.id} message={m} />
              ) : (
                <Bubble key={m.id} message={m} mine={m.from === me} />
              )
            )}
          </div>
        ))}
        {typing && (
          <div className="flex justify-end">
            <div className="me-auto flex items-center gap-1 rounded-2xl rounded-es-md bg-white px-4 py-3 shadow-sm">
              <span className="tg-dot" />
              <span className="tg-dot" style={{ animationDelay: '0.2s' }} />
              <span className="tg-dot" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <div className="border-t border-[#e7ebf0] bg-white px-3 py-2.5 md:px-4">
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="اكتب رسالة…"
            maxLength={4000}
            className="h-11 flex-1 rounded-full border-transparent bg-[#f4f7fa] px-4 text-[15px] focus-visible:bg-white focus-visible:ring-[#2aabee]"
            aria-label="نص الرسالة"
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#3390ec] text-white shadow-sm transition-all hover:bg-[#2a82dd] disabled:opacity-40"
            aria-label="إرسال"
          >
            <Send className="h-5 w-5 -scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  )
}
