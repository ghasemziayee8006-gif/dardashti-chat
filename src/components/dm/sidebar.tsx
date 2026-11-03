'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LogOut, MessageCirclePlus, Phone, Search, SearchX, Video, LoaderCircle, UserRoundSearch } from 'lucide-react'
import { Avatar } from '@/components/dm/avatar'
import { Input } from '@/components/ui/input'
import type { AuthUser, ChatMessage, ChatUser } from '@/lib/dm/types'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/dm/utils'

export function Sidebar({
  me,
  chats,
  unread,
  typing,
  messages,
  activePeer,
  connected,
  onSearch,
  onOpen,
  onCall,
  onLogout,
}: {
  me: AuthUser
  chats: ChatUser[]
  unread: Record<string, number>
  typing: Record<string, boolean>
  messages: Record<string, ChatMessage[]>
  activePeer: string | null
  connected: boolean
  onSearch: (q: string) => Promise<ChatUser[]>
  onOpen: (u: ChatUser) => void
  onCall: (u: string, type: 'audio' | 'video') => void
  onLogout: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatUser[] | null>(null)
  const [searching, setSearching] = useState(false)
  const requestSeq = useRef(0)

  // debounced server-side search by username / display name
  useEffect(() => {
    const q = query.trim()
    const seq = ++requestSeq.current
    if (!q) {
      const t = setTimeout(() => {
        setResults(null)
        setSearching(false)
      }, 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setSearching(true)
      onSearch(q)
        .then((r) => {
          if (requestSeq.current === seq) {
            setResults(r)
            setSearching(false)
          }
        })
        .catch(() => {
          if (requestSeq.current === seq) {
            setResults([])
            setSearching(false)
          }
        })
    }, 300)
    return () => clearTimeout(t)
  }, [query, onSearch])

  const items = useMemo(
    () =>
      [...chats].sort((a, b) => {
        const lastTs = (u: ChatUser) => {
          const arr = messages[u.username]
          return arr?.length ? arr[arr.length - 1].createdAt : u.lastSeen || 0
        }
        const ta = lastTs(a)
        const tb = lastTs(b)
        if (ta !== tb) return tb - ta
        return a.username.localeCompare(b.username)
      }),
    [chats, messages]
  )

  const isSearching = query.trim() !== ''

  return (
    <div className="flex h-full flex-col bg-white">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-[#e7ebf0] px-4 py-3">
        <Avatar name={me.username} displayName={me.displayName} size={42} online={connected} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#17212b]">{me.displayName}</p>
          <p className="truncate text-xs text-[#708499]" dir="ltr">
            @{me.username}
          </p>
        </div>
        <button
          onClick={onLogout}
          className="rounded-full p-2 text-[#708499] transition-colors hover:bg-[#f4f7fa] hover:text-[#e53935]"
          title="تسجيل الخروج"
          aria-label="تسجيل الخروج"
        >
          <LogOut className="h-5 w-5 -scale-x-100" />
        </button>
      </header>

      {/* search */}
      <div className="px-3 py-2">
        <div className="relative">
          {searching ? (
            <LoaderCircle className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#708499]" aria-hidden="true" />
          ) : (
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#708499]" aria-hidden="true" />
          )}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن حساب بمعرّفه…"
            maxLength={30}
            className="h-10 rounded-full border-transparent bg-[#f4f7fa] ps-9 text-sm focus-visible:bg-white focus-visible:ring-[#2aabee]"
            aria-label="بحث عن مستخدم بمعرّفه"
          />
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 tg-scrollbar">
        {isSearching ? (
          /* ---------- search results ---------- */
          <div>
            <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-[#708499]">
              نتائج البحث
            </p>
            {(results ?? []).length === 0 && !searching ? (
              <div className="mt-10 flex flex-col items-center px-6 text-center text-[#708499]">
                <SearchX className="mb-3 h-10 w-10 opacity-40" />
                <p className="text-sm leading-6">
                  لا يوجد حساب بهذا المعرّف.
                  <br />
                  تأكد من كتابة المعرّف بشكل صحيح (مثال: <span dir="ltr">ahmed_99</span>)
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {(results ?? []).map((u) => (
                  <li key={u.username}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen(u)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(u)}
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-[#f4f7fa]"
                    >
                      <Avatar name={u.username} displayName={u.displayName} size={48} online={u.online} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-bold text-[#17212b]">{u.displayName}</p>
                        <p className="truncate text-[13px] text-[#708499]" dir="ltr">
                          @{u.username}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-3 py-1.5 text-xs font-bold',
                          u.online ? 'bg-[#e8f7ee] text-[#31b545]' : 'bg-[#eef3f7] text-[#708499]'
                        )}
                      >
                        {u.online ? 'متصل' : 'دردشة'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : items.length > 0 ? (
          /* ---------- conversations ---------- */
          <ul className="space-y-0.5">
            {items.map((u) => {
              const msgs = messages[u.username] ?? []
              const last = msgs[msgs.length - 1]
              const unreadCount = unread[u.username] ?? 0
              const isActive = activePeer === u.username
              const isTyping = !!typing[u.username]
              return (
                <li key={u.username}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(u)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(u)}
                    className={cn(
                      'group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors',
                      isActive ? 'bg-[#3390ec] text-white' : 'hover:bg-[#f4f7fa]'
                    )}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <Avatar name={u.username} displayName={u.displayName} size={48} online={u.online} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn('truncate text-[15px] font-bold', isActive ? 'text-white' : 'text-[#17212b]')}>
                          {u.displayName}
                        </p>
                        {last && (
                          <span
                            className={cn(
                              'shrink-0 text-[11px]',
                              isActive ? 'text-white/80' : 'text-[#708499]'
                            )}
                          >
                            {formatTime(last.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            'truncate text-[13px]',
                            isTyping
                              ? 'font-medium text-[#3390ec]'
                              : isActive
                                ? 'text-white/85'
                                : 'text-[#708499]'
                          )}
                        >
                          {isTyping
                            ? 'يكتب الآن…'
                            : last
                              ? last.type === 'call'
                                ? '📞 مكالمة'
                                : `${last.from === me.username ? 'أنت: ' : ''}${last.text}`
                              : u.online
                                ? 'متصل الآن'
                                : 'غير متصل'}
                        </p>
                        {unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3390ec] px-1.5 text-[11px] font-bold text-white group-hover:bg-white group-hover:text-[#3390ec]">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* quick call buttons */}
                    <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); onCall(u.username, 'audio') }}
                        className={cn(
                          'rounded-full p-1.5 transition-colors',
                          isActive ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#eef3f7] text-[#708499] hover:bg-[#e2e9ef] hover:text-[#3390ec]'
                        )}
                        title={`مكالمة صوتية مع ${u.displayName}`}
                        aria-label={`مكالمة صوتية مع ${u.displayName}`}
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onCall(u.username, 'video') }}
                        className={cn(
                          'rounded-full p-1.5 transition-colors',
                          isActive ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#eef3f7] text-[#708499] hover:bg-[#e2e9ef] hover:text-[#3390ec]'
                        )}
                        title={`مكالمة مرئية مع ${u.displayName}`}
                        aria-label={`مكالمة مرئية مع ${u.displayName}`}
                      >
                        <Video className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          /* ---------- empty state ---------- */
          <div className="mt-16 flex flex-col items-center px-6 text-center text-[#708499]">
            <UserRoundSearch className="mb-3 h-12 w-12 opacity-40" />
            <p className="text-sm font-bold text-[#17212b]">لا توجد محادثات بعد</p>
            <p className="mt-2 text-sm leading-6">
              ابحث أعلى عن معرّف صديقك (مثال: <span dir="ltr">ahmed_99</span>)،
              وسيظهر حسابك له مباشرة لتبدأ الدردشة والمكالمات.
            </p>
            <MessageCirclePlus className="mt-4 h-5 w-5 opacity-50" />
          </div>
        )}
      </div>
    </div>
  )
}
