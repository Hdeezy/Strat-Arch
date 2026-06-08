import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, formatDateHamilton } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function AdminDonationsPage() {
  const admin = createAdminClient()

  const { data: donationsRaw } = await admin
    .from('donations')
    .select('*, card:cards(card_code)')
    .order('created_at', { ascending: false })
    .limit(200)

  const donations = donationsRaw as Array<{
    id: string
    card_id: string
    amount_cents: number
    donor_user_id: string | null
    donor_email: string | null
    donor_name: string | null
    stripe_payment_intent_id: string | null
    donor_note: string | null
    receipt_requested: boolean
    created_at: string
    card: { card_code: string } | null
  }> | null

  const total = donations?.reduce((s, d) => s + d.amount_cents, 0) || 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-hope-dark">Donations ({donations?.length ?? 0})</h1>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total Funded</div>
          <div className="font-bold text-hope-dark">{formatCAD(total)}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Card</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Amount</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Receipt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {donations?.map(d => {
              const card = d.card as { card_code: string } | null
              return (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateHamilton(d.created_at)}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-hope-dark">{card?.card_code || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCAD(d.amount_cents)}</td>
                  <td className="px-4 py-3 text-center">
                    {d.receipt_requested ? (
                      <span className="text-xs bg-hope-pale text-hope-dark px-2 py-0.5 rounded-full">Yes</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
