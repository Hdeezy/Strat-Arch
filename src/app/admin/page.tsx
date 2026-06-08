import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { computeFlags } from '@/lib/admin-flags'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/admin')

  const admin = createAdminClient()

  const [cardsResult, donationsResult, redemptionsResult, flags] = await Promise.all([
    admin.from('cards').select('id, state, balance_cents'),
    admin.from('donations').select('id, amount_cents, created_at'),
    admin.from('redemptions').select('id, amount_cents, status, occurred_at'),
    computeFlags().catch(() => []),
  ])

  const cards = cardsResult.data ?? []
  const donations = donationsResult.data ?? []
  const redemptions = redemptionsResult.data ?? []

  const stats = {
    totalCards: cards.length,
    activeCards: cards.filter(c => c.state === 'active').length,
    exhaustedCards: cards.filter(c => c.state === 'exhausted').length,
    pendingCards: cards.filter(c => c.state === 'unloaded').length,
    totalLoaded: donations.reduce((s, d) => s + d.amount_cents, 0),
    totalRedeemed: redemptions.filter(r => r.status === 'succeeded').reduce((s, r) => s + r.amount_cents, 0),
    // Funds sitting on active cards
    activeBalance: cards.filter(c => c.state === 'active').reduce((s, c) => s + c.balance_cents, 0),
  }

  // ─── Today & rolling 7-day window ─────────────────────────────────────────
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const todayRedemptions = redemptions.filter(
    r => new Date(r.occurred_at) >= startOfToday && r.status === 'succeeded'
  )

  // 7-day daily redemption totals
  const dailyTotals: { label: string; cents: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(startOfToday)
    day.setDate(day.getDate() - i)
    const next = new Date(day)
    next.setDate(next.getDate() + 1)

    const label = i === 0 ? 'Today' : day.toLocaleDateString('en-CA', { weekday: 'short', month: 'numeric', day: 'numeric' })
    const cents = redemptions
      .filter(r => r.status === 'succeeded' && new Date(r.occurred_at) >= day && new Date(r.occurred_at) < next)
      .reduce((s, r) => s + r.amount_cents, 0)

    dailyTotals.push({ label, cents })
  }

  const maxDailyBar = Math.max(...dailyTotals.map(d => d.cents), 1)

  const utilizationPct =
    stats.totalLoaded > 0
      ? Math.round((stats.totalRedeemed / stats.totalLoaded) * 100)
      : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-hope-dark">Dashboard</h1>

      {/* Key stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Funded', value: formatCAD(stats.totalLoaded), sub: `${utilizationPct}% utilized`, icon: '💚' },
          { label: 'Total Redeemed', value: formatCAD(stats.totalRedeemed), sub: `${formatCAD(stats.activeBalance)} remaining`, icon: '🛒' },
          { label: 'Active Cards', value: stats.activeCards, sub: `${stats.exhaustedCards} exhausted`, icon: '💳' },
          { label: 'Unloaded Cards', value: stats.pendingCards, sub: `${stats.totalCards} total`, icon: '📦' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-xl mb-1">{s.icon}</div>
            <div className="text-2xl font-bold text-hope-dark">{s.value}</div>
            <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Today */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-1">
        <div className="font-semibold text-hope-dark">Today</div>
        <div className="text-3xl font-bold text-hope-dark">
          {formatCAD(todayRedemptions.reduce((s, r) => s + r.amount_cents, 0))}
        </div>
        <div className="text-sm text-muted-foreground">
          {todayRedemptions.length} redemption{todayRedemptions.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* 7-day bar chart */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="font-semibold text-hope-dark mb-4">Last 7 days</div>
        <div className="flex items-end gap-1.5 h-24">
          {dailyTotals.map(({ label, cents }) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-hope-green rounded-t"
                style={{ height: `${Math.max(2, (cents / maxDailyBar) * 88)}px` }}
                title={formatCAD(cents)}
              />
              <div className="text-[9px] text-muted-foreground text-center leading-tight truncate w-full text-center">
                {label.split(',')[0]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Suspicious flags */}
      {flags.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
          <div className="font-semibold text-amber-800 flex items-center gap-2">
            <span>⚠️</span> Suspicious Activity ({flags.length})
          </div>
          {flags.map((flag, i) => (
            <div key={i} className="text-sm bg-white rounded-xl p-3 space-y-1 border border-amber-100">
              <div className="font-medium text-amber-900">
                {flag.card_code} — {flag.type.replace(/_/g, ' ')}
              </div>
              <div className="text-amber-700">{flag.detail}</div>
              <div className="text-xs text-muted-foreground">{formatDateHamilton(flag.occurred_at)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/admin/cards" className="bg-white rounded-xl shadow-sm p-4 hover:bg-hope-pale transition-colors text-center">
          <div className="text-2xl mb-1">💳</div>
          <div className="text-sm font-semibold text-hope-dark">All Cards</div>
        </Link>
        <Link href="/admin/print-cards" className="bg-white rounded-xl shadow-sm p-4 hover:bg-hope-pale transition-colors text-center">
          <div className="text-2xl mb-1">🖨️</div>
          <div className="text-sm font-semibold text-hope-dark">Print Cards</div>
        </Link>
        <a href="/api/admin/export?type=redemptions"
          className="bg-white rounded-xl shadow-sm p-4 hover:bg-hope-pale transition-colors text-center">
          <div className="text-2xl mb-1">📊</div>
          <div className="text-sm font-semibold text-hope-dark">Export Redemptions</div>
        </a>
        <a href="/api/admin/export?type=donations"
          className="bg-white rounded-xl shadow-sm p-4 hover:bg-hope-pale transition-colors text-center">
          <div className="text-2xl mb-1">💰</div>
          <div className="text-sm font-semibold text-hope-dark">Export Donations</div>
        </a>
      </div>
    </div>
  )
}
