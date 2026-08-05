'use client'

/**
 * Nav link that knows whether it is the current page.
 *
 * Client component purely for usePathname — the shell around it stays a
 * server component so the auth check never ships to the browser.
 *
 * Active state is carried by background AND weight, not colour alone.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function AdminNavLink({
  href,
  label,
  exact = false,
  variant = 'sidebar',
  children,
}: {
  href: string
  label: string
  exact?: boolean
  variant?: 'sidebar' | 'pill'
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  // Without `exact`, /admin would light up on every child route.
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

  if (variant === 'pill') {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors',
          active
            ? 'bg-white text-slate-900 font-semibold'
            : 'text-slate-400 hover:text-white hover:bg-slate-800'
        )}
      >
        {children}
        {label}
      </Link>
    )
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-slate-800 text-white font-medium'
          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
      )}
    >
      {children}
      {label}
    </Link>
  )
}
