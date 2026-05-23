import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, formatDateHamilton } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function AdminRedemptionsPage() {
  const admin = createAdminClient()

  const { data: redemptions } = await admin
    .from('redemptions')
    .select('*, card:cards(card_code), merchant:merchants(name, category)')
    .order('occurred_at', { ascending: false })
    .limit(200)

  const succeeded = redemptions?.filter(r => r.status === 'succeeded') || []
  const total = succeeded.reduce((s, r) => s + r.amount_cents, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-hope-dark">Redemptions ({redemptions?.length ?? 0})</h1>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total Redeemed</div>
          <div className="font-bold text-hope-dark">{formatCAD(total)}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Card</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Merchant</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Amount</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {redemptions?.map(r => {
              const card = r.card as { card_code: string } | null
              const merchant = r.merchant as { name: string; category: string } | null
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateHamilton(r.occurred_at)}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-hope-dark">{card?.card_code || '—'}</td>
                  <td className="px-4 py-3 text-sm">{merchant?.name || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCAD(r.amount_cents)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      r.status === 'succeeded' ? 'bg-hope-pale text-hope-dark' :
                      r.status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
