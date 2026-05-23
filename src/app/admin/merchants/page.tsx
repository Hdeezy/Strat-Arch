import { createAdminClient } from '@/lib/supabase/admin'
import { CATEGORY_LABELS, CATEGORY_ICONS, type CardCategory } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AdminMerchantsPage() {
  const admin = createAdminClient()

  const { data: merchants } = await admin
    .from('merchants')
    .select('*, charity:charities(name)')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-hope-dark">Merchants ({merchants?.length ?? 0})</h1>

      <div className="space-y-3">
        {merchants?.map(m => {
          const charity = m.charity as { name: string } | null
          return (
            <div key={m.id} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-hope-dark">{m.name}</div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  m.is_active ? 'bg-hope-pale text-hope-dark' : 'bg-gray-100 text-gray-600'
                }`}>
                  {m.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{m.address}</div>
              <div className="flex items-center gap-2">
                <span className="text-sm">{CATEGORY_ICONS[m.category as CardCategory]}</span>
                <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[m.category as CardCategory]}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{charity?.name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Trust score: {m.trust_score.toFixed(2)} · Payout: every {m.payout_schedule_days} days
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
