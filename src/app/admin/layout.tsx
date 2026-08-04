/**
 * OPERATOR SHELL.
 *
 * A sidebar, not a row of links. The portal has grown a money section
 * (ledger, settlement) and a safety section (invariants, enumeration
 * signals), and those are different kinds of work from browsing cards —
 * grouping them is what makes the difference legible.
 *
 * The nav is ordered by how often it is opened, not by how the tables are
 * named: the day starts on the overview and ends on settlement.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import {
  LayoutDashboard, CreditCard, HeartHandshake, Receipt, Users, Store,
  Printer, Scale, Banknote, ShieldAlert, Lock, ExternalLink,
} from 'lucide-react'
import { AdminNavLink } from './nav-link'

export const metadata: Metadata = { title: 'Operator Console' }

const NAV = [
  {
    heading: null,
    items: [{ href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true }],
  },
  {
    heading: 'Money',
    items: [
      { href: '/admin/ledger', label: 'Ledger', icon: Scale },
      { href: '/admin/settlement', label: 'Settlement', icon: Banknote },
      { href: '/admin/donations', label: 'Donations', icon: HeartHandshake },
      { href: '/admin/redemptions', label: 'Redemptions', icon: Receipt },
    ],
  },
  {
    heading: 'Programme',
    items: [
      { href: '/admin/cards', label: 'Cards', icon: CreditCard },
      { href: '/admin/advocates', label: 'Advocates', icon: Users },
      { href: '/admin/merchants', label: 'Vendors', icon: Store },
      { href: '/admin/print-cards', label: 'Print cards', icon: Printer },
    ],
  },
  {
    heading: 'Safety',
    items: [{ href: '/admin/security', label: 'Signals', icon: ShieldAlert }],
  },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/admin')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['charity_admin', 'super_admin'].includes(profile.role)) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-sm w-full text-center space-y-3">
          <Lock className="mx-auto h-8 w-8 text-slate-400" strokeWidth={1.5} />
          <div className="font-semibold text-slate-900">Operator access required</div>
          <p className="text-sm text-slate-500">
            This console is for charity admins. Your account is signed in but not
            authorised for it.
          </p>
          <Link href="/" className="inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800">
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  const displayName = profile.full_name || user.email || 'Operator'
  const initials = displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase()).join('')

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="hidden lg:flex w-60 flex-none flex-col bg-slate-900 min-h-screen sticky top-0">
          <div className="px-5 py-5 border-b border-slate-800">
            <Link href="/admin" className="block">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
                HOPE Card
              </div>
              <div className="text-sm font-semibold text-white mt-0.5">Operator Console</div>
            </Link>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
            {NAV.map((group, i) => (
              <div key={group.heading ?? i}>
                {group.heading && (
                  <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {group.heading}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <AdminNavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      exact={'exact' in item ? Boolean(item.exact) : false}
                    >
                      <item.icon className="h-4 w-4 flex-none" strokeWidth={2} aria-hidden="true" />
                    </AdminNavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="px-3 py-3 border-t border-slate-800 space-y-1">
            <Link
              href="/wallet"
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              What a cardholder sees
            </Link>
            <div className="flex items-center gap-2.5 px-2 py-2">
              <div className="h-7 w-7 flex-none rounded-full bg-emerald-600 text-white grid place-items-center text-[11px] font-semibold">
                {initials || 'OP'}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate">{displayName}</div>
                <div className="text-[10px] text-slate-500">{profile.role.replace('_', ' ')}</div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Mobile header ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <header className="lg:hidden bg-slate-900 text-white px-4 py-3 sticky top-0 z-20">
            <div className="flex items-center justify-between">
              <Link href="/admin" className="text-sm font-semibold">
                HOPE <span className="text-slate-400 font-normal">Operator</span>
              </Link>
              <div className="h-7 w-7 rounded-full bg-emerald-600 grid place-items-center text-[11px] font-semibold">
                {initials || 'OP'}
              </div>
            </div>
            <nav className="flex gap-1 mt-3 overflow-x-auto -mx-4 px-4 pb-0.5">
              {NAV.flatMap(g => g.items).map(item => (
                <AdminNavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  exact={'exact' in item ? Boolean(item.exact) : false}
                  variant="pill"
                >
                  <item.icon className="h-3.5 w-3.5 flex-none" strokeWidth={2} aria-hidden="true" />
                </AdminNavLink>
              ))}
            </nav>
          </header>

          <main className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-7xl">{children}</main>
        </div>
      </div>
    </div>
  )
}
