'use client'

import { avatarColor, initial } from '@/lib/dm/utils'
import { cn } from '@/lib/utils'

export function Avatar({
  name,
  displayName,
  size = 48,
  online = false,
  className,
}: {
  name: string
  /** shown name used for the initial & color (falls back to username) */
  displayName?: string
  size?: number
  online?: boolean
  className?: string
}) {
  const label = displayName?.trim() || name
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full font-bold text-white select-none"
        style={{ backgroundColor: avatarColor(label), fontSize: size * 0.42 }}
        aria-hidden="true"
      >
        {initial(label)}
      </div>
      <span className="sr-only">{online ? 'متصل الآن' : 'غير متصل'}</span>
      {online && (
        <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#4dcd5e]" />
      )}
    </div>
  )
}
