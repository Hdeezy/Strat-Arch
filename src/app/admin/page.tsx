import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/admin')

  const admin = createAdminClient()

  const [cardsResult, donationsResult, redemptionsResult, flagsResult] = await Promise.all([
    admin.from('cards').select('id, state, balance_cents'),
    admin.from('donations').select('id, amount_cents, created_at'),
    admin.from('redemptions').select('id, amount_cents, status, occurred_at'),
    fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/flags`, {
      headers: { Cookie: '' },
    }).then(r => r.json()).catch(() => ({ flags: [] })),
  ])

  const cards = cardsResult.data || []
  const donations = donationsResult.data || []
  const redemptions = redemptionsResult.data || []

  const stats = {
    totalCards: cards.length,
    activeCards: cards.filter(c => c.state === 'active').length,
    totalLoaded: donations.reduce((s, d) => s + d.amount_cents, 0),
    totalRedeemed: redemptions.filter(r => r.status === 'succeeded').reduce((s, r) => s + r.amount_cents, 0),
    pendingCards: cards.filter(c => c.state === 'unloaded').length,
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayRedemptions = redemptions.filter(r => new Date(r.occurred_at) >= today && r.status === 'succeeded')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-hope-dark">Dashboard</h1>

      {/* Key stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Funded', value: formatCAD(stats.totalLoaded), icon: '💚' },
          { label: 'Total Redeemed', value: formatCAD(stats.totalRedeemed), icon: '🛒' },
          { label: 'Active Cards', value: stats.activeCards, icon: '💳' },
          { label: 'Unloaded Cards', value: stats.pendingCards, icon: '📦' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-xl mb-1">{s.icon}</div>
            <div className="text-2xl font-bold text-hope-dark">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Today's activity */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-2">
        <div className="font-semibold text-hope-dark">Today</div>
        <div className="text-3xl font-bold">{formatCAD(todayRedemptions.reduce((s, r) => s + r.amount_cents, 0))}</div>
        <div className="text-sm text-muted-foreground">{todayRedemptions.length} redemptions today</div>
      </div>

      {/* Suspicious flags */}
      {flagsResult.flags?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
          <div className="font-semibold text-amber-800 flex items-center gap-2">
            <span>⚠️</span> Suspicious Activity ({flagsResult.flags.length})
          </div>
          {flagsResult.flags.map((flag: { type: string; card_code: string; detail: string; occurred_at: string }, i: number) => (
            <div key={i} className="text-sm bg-white rounded-xl p-3 space-y-1 border border-amber-100">
              <div className="font-medium text-amber-900">{flag.card_code} — {flag.type.replace(/_/g, ' ')}</div>
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
        <a href="/api/admin/export?type=redemptions" className="bg-white rounded-xl shadow-sm p-4 hover:bg-hope-pale transition-colors text-center">
          <div className="text-2xl mb-1">📊</div>
          <div className="text-sm font-semibold text-hope-dark">Export Redemptions</div>
        </a>
        <a href="/api/admin/export?type=donations" className="bg-white rounded-xl shadow-sm p-4 hover:bg-hope-pale transition-colors text-center">
          <div className="text-2xl mb-1">💰</div>
          <div className="text-sm font-semibold text-hope-dark">Export Donations</div>
        </a>
      </div>
    </div>
  )
}
