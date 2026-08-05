'use client'

/**
 * Counter tab. Same reasoning as the advocate bar: this is a phone propped
 * by a till, tapped by someone mid-conversation with a customer. Large
 * targets, active state carried by weight as well as colour.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function MerchantTab({
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
      <span className={cn('text-[11px] leading-none', active ? 'font-bold' : 'font-medium')}>
        {label}
      </span>
    </Link>
  )
}
