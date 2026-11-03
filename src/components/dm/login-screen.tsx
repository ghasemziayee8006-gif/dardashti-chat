'use client'

import { useState } from 'react'
import { AtSign, BadgeCheck, KeyRound, Loader2, MessagesSquare, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiLogin, apiRegister, type ApiError } from '@/lib/dm/api'
import type { AuthUser } from '@/lib/dm/types'

const ERROR_TEXT: Record<string, string> = {
  invalid_username: 'المعرّف يجب أن يكون من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا أو _ وبدون مسافات',
  invalid_display_name: 'اكتب اسم العرض (حرف على الأقل)',
  invalid_password: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
  username_taken: 'هذا المعرّف محجوز لحساب آخر، اختر غيره',
  bad_credentials: 'المعرّف أو كلمة المرور غير صحيحة',
  request_failed: 'تعذر الاتصال بالخادم، حاول مجددًا',
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export function LoginScreen({
  onSubmit,
}: {
  onSubmit: (token: string, user: AuthUser) => void
}) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchTab = (t: 'login' | 'register') => {
    setTab(t)
    setError(null)
  }

  const submit = async () => {
    if (busy) return
    setError(null)
    const u = username.trim().toLowerCase()
    if (!USERNAME_RE.test(u)) {
      setError(ERROR_TEXT.invalid_username)
      return
    }
    if (tab === 'register') {
      const dn = displayName.trim().replace(/\s+/g, ' ')
      if (!dn || dn.length > 30) {
        setError(ERROR_TEXT.invalid_display_name)
        return
      }
      if (password.length < 6 || password.length > 72) {
        setError(ERROR_TEXT.invalid_password)
        return
      }
      setBusy(true)
      try {
        const r = await apiRegister({ username: u, displayName: dn, password })
        onSubmit(r.token, r.user)
        return
      } catch (e) {
        setError(ERROR_TEXT[(e as ApiError).code] ?? ERROR_TEXT.request_failed)
      } finally {
        setBusy(false)
      }
    } else {
      if (!password) {
        setError('اكتب كلمة المرور')
        return
      }
      setBusy(true)
      try {
        const r = await apiLogin({ username: u, password })
        onSubmit(r.token, r.user)
        return
      } catch (e) {
        setError(ERROR_TEXT[(e as ApiError).code] ?? ERROR_TEXT.request_failed)
      } finally {
        setBusy(false)
      }
    }
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-gradient-to-b from-[#eaf3fb] to-[#dfe9f2] p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#2aabee] to-[#1c86c9] shadow-lg shadow-sky-200">
            <MessagesSquare className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-[#17212b]">دردشة</h1>
          <p className="mt-2 text-sm leading-6 text-[#708499]">
            أنشئ حسابك بمعرّف فريد، ثم ابحث عن أصدقائك بمعرّفهم وتحدث معهم —
            مع مكالمات صوتية ومرئية ومشاركة للشاشة.
          </p>
        </div>

        {/* tabs */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-[#f4f7fa] p-1" role="tablist" aria-label="تسجيل الدخول أو إنشاء حساب">
          <button
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => switchTab('login')}
            className={`h-9 rounded-lg text-sm font-bold transition-all ${
              tab === 'login' ? 'bg-white text-[#3390ec] shadow-sm' : 'text-[#708499] hover:text-[#17212b]'
            }`}
          >
            تسجيل الدخول
          </button>
          <button
            role="tab"
            aria-selected={tab === 'register'}
            onClick={() => switchTab('register')}
            className={`h-9 rounded-lg text-sm font-bold transition-all ${
              tab === 'register' ? 'bg-white text-[#3390ec] shadow-sm' : 'text-[#708499] hover:text-[#17212b]'
            }`}
          >
            حساب جديد
          </button>
        </div>

        <div className="space-y-3">
          {/* username */}
          <div className="relative">
            <AtSign className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#708499]" aria-hidden="true" />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="المعرّف (username)"
              maxLength={20}
              autoCapitalize="none"
              autoComplete="username"
              dir="ltr"
              className="h-12 rounded-xl border-[#dfe6ec] bg-[#f4f7fa] ps-9 text-start text-base focus-visible:ring-[#2aabee]"
              aria-label="المعرّف"
            />
          </div>

          {/* display name (register only) */}
          {tab === 'register' && (
            <div className="relative">
              <UserRound className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#708499]" aria-hidden="true" />
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                placeholder="اسمك المعروض"
                maxLength={30}
                className="h-12 rounded-xl border-[#dfe6ec] bg-[#f4f7fa] ps-9 text-base focus-visible:ring-[#2aabee]"
                aria-label="الاسم المعروض"
              />
            </div>
          )}

          {/* password */}
          <div className="relative">
            <KeyRound className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#708499]" aria-hidden="true" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder={tab === 'register' ? 'كلمة المرور (6 أحرف على الأقل)' : 'كلمة المرور'}
              maxLength={72}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              className="h-12 rounded-xl border-[#dfe6ec] bg-[#f4f7fa] ps-9 text-base focus-visible:ring-[#2aabee]"
              aria-label="كلمة المرور"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-600">
              {error}
            </p>
          )}

          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="h-12 w-full rounded-xl bg-[#3390ec] text-base font-bold hover:bg-[#2a82dd]"
          >
            {busy ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                جاري المعالجة…
              </>
            ) : tab === 'register' ? (
              <>
                <BadgeCheck className="me-2 h-5 w-5" />
                إنشاء الحساب
              </>
            ) : (
              'دخول'
            )}
          </Button>
        </div>

        {tab === 'register' && (
          <p className="mt-4 text-center text-xs leading-5 text-[#708499]">
            المعرّف هو ما سيبحث به أصدقاؤك عن حسابك: أحرف إنجليزية وأرقام و _ فقط.
          </p>
        )}

        <p className="mt-6 rounded-xl bg-[#f4f7fa] p-3 text-center text-xs leading-5 text-[#708499]">
          لتجربة المحادثة والمكالمات: افتح التطبيق في تبويب آخر وأنشئ حسابًا ثانيًا —
          كل تبويب يحتفظ بجلسته المستقلة.
        </p>
      </div>
    </div>
  )
}
