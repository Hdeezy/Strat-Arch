'use client'

/**
 * Bottom-bar tab. Client-only for usePathname; the shell stays a server
 * component so the auth check never reaches the browser.
 *
 * min-h-16 is deliberate — comfortably past the 44pt touch target floor,
 * because this gets tapped with cold hands and sometimes gloves.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function AdvocateTab({
  href,
  label,
  exact = false,
  children,
}: {
  href: string
  label: string
  exact?: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-1 min-h-16 py-2 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hope-green',
        active ? 'text-hope-green' : 'text-slate-400 hover:text-slate-600'
      )}
    >
      {children}
      {/* Weight as well as colour, so the active tab is not colour-only. */}
      <span className={cn('text-[11px] leading-none', active ? 'font-bold' : 'font-medium')}>
        {label}
      </span>
    </Link>
  )
}
