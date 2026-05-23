import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { CardStateBadge } from '@/components/card-state-badge'
import type { CardEvent, Redemption, Merchant } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function CardCustodyPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/donate/dashboard')

  const admin = createAdminClient()

  const [cardResult, eventsResult, redemptionsResult] = await Promise.all([
    admin.from('cards').select('*').eq('id', params.id).single(),
    admin.from('card_events').select('*').eq('card_id', params.id).order('occurred_at', { ascending: true }),
    admin.from('redemptions')
      .select('*, merchant:merchants(id, name, address, category)')
      .eq('card_id', params.id)
      .eq('status', 'succeeded')
      .order('occurred_at', { ascending: true }),
  ])

  const card = cardResult.data
  if (!card) redirect('/donate/dashboard')

  // Verify donor has access
  const { data: donation } = await admin
    .from('donations')
    .select('id')
    .eq('card_id', params.id)
    .eq('donor_user_id', user.id)
    .single()

  if (!donation) redirect('/donate/dashboard')

  const events = eventsResult.data || []
  const redemptions = redemptionsResult.data || []

  const EVENT_LABELS: Record<string, string> = {
    created: 'Card created',
    loaded: 'Card funded',
    issued: 'Issued by outreach worker',
    redemption_succeeded: 'Used at merchant',
    redemption_failed: 'Redemption declined',
    invalidated: 'Card invalidated',
    expired: 'Card expired',
  }

  return (
    <div className="space-y-6">
      <div className="bg-hope-dark rounded-2xl p-5 text-white space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-hope-light">HOPE Card</div>
            <div className="text-2xl font-mono font-bold">{card.card_code}</div>
          </div>
          <CardStateBadge state={card.state} />
        </div>
        <div>
          <div className="text-xs text-hope-light">Remaining Balance</div>
          <div className="text-3xl font-bold">{formatCAD(card.balance_cents)}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
        <div className="text-sm font-semibold text-hope-dark">Chain of Custody</div>
        <div className="space-y-3">
          {events.map((event: CardEvent) => {
            const redemption = event.event_type === 'redemption_succeeded'
              ? redemptions.find(r => r.id === (event.metadata as { redemption_id?: string })?.redemption_id)
              : null

            const merchantData = redemption?.merchant as (Pick<Merchant, 'id' | 'name' | 'address' | 'category'>) | null

            return (
              <div key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${
                    event.event_type === 'redemption_succeeded' ? 'bg-hope-green' :
                    event.event_type === 'issued' ? 'bg-hope-teal' :
                    event.event_type === 'loaded' ? 'bg-hope-gold' :
                    event.event_type === 'invalidated' ? 'bg-destructive' :
                    'bg-muted-foreground'
                  }`} />
                  <div className="w-px flex-1 bg-border mt-1" />
                </div>
                <div className="pb-3 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {EVENT_LABELS[event.event_type] || event.event_type}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateHamilton(event.occurred_at)}
                  </div>
                  {redemption && merchantData && (
                    <div className="text-xs text-hope-dark mt-1 bg-hope-pale rounded-lg p-2">
                      {merchantData.name} · {formatCAD(redemption.amount_cents)}
                    </div>
                  )}
                  {event.event_type === 'issued' && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      By outreach worker near James St N
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
