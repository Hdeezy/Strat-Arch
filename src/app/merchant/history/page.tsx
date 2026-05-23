import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { CATEGORY_LABELS, CATEGORY_ICONS, type CardCategory } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function MerchantHistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/merchant/history')

  const admin = createAdminClient()
  const { data: staffRecord } = await admin
    .from('merchant_staff')
    .select('merchant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!staffRecord) redirect('/merchant')

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: redemptions } = await admin
    .from('redemptions')
    .select('*, card:cards(card_code, allowed_categories)')
    .eq('merchant_id', staffRecord.merchant_id)
    .eq('status', 'succeeded')
    .gte('occurred_at', today.toISOString())
    .order('occurred_at', { ascending: false })

  const totalToday = redemptions?.reduce((sum, r) => sum + r.amount_cents, 0) || 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-hope-dark">Today&apos;s Transactions</h1>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="font-bold text-hope-dark">{formatCAD(totalToday)}</div>
        </div>
      </div>

      {!redemptions || redemptions.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-2">
          <div className="text-3xl">📋</div>
          <div className="text-sm text-muted-foreground">No transactions today</div>
        </div>
      ) : (
        <div className="space-y-2">
          {redemptions.map(r => {
            const card = r.card as { card_code: string; allowed_categories: CardCategory[] } | null
            return (
              <div key={r.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold text-sm text-hope-dark">{card?.card_code || '—'}</div>
                  <div className="text-xs text-muted-foreground">{formatDateHamilton(r.occurred_at)}</div>
                </div>
                <div className="font-bold text-hope-dark">{formatCAD(r.amount_cents)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
