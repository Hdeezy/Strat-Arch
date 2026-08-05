import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { CardStateBadge } from '@/components/card-state-badge'
import AdvocateCardActions from './advocate-card-actions'

export const dynamic = 'force-dynamic'

export default async function AdvocateCardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/advocate/cards')

  const admin = createAdminClient()
  const { data: advocate } = await admin
    .from('advocates')
    .select('id, charity_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!advocate) redirect('/advocate')

  const { data: cards } = await admin
    .from('cards')
    .select(`
      id, card_code, state, balance_cents, allowed_categories, created_at,
      card_events(event_type, occurred_at, actor_type)
    `)
    .eq('charity_id', advocate.charity_id)
    .in('state', ['active', 'unloaded', 'exhausted'])
    .order('created_at', { ascending: false })
    .limit(100)

  const activeCards = cards?.filter(c => c.state === 'active') || []
  const unloadedCards = cards?.filter(c => c.state === 'unloaded') || []
  const exhaustedCards = cards?.filter(c => c.state === 'exhausted') || []

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-hope-dark">Card Management</h1>

      {[
        { label: 'Active Cards', list: activeCards, color: 'hope-green' },
        { label: 'Unloaded Cards', list: unloadedCards, color: 'gray-400' },
        { label: 'Exhausted Cards', list: exhaustedCards, color: 'amber-500' },
      ].map(({ label, list }) => (
        list.length > 0 && (
          <div key={label} className="space-y-2">
            <div className="text-sm font-semibold text-hope-dark">{label} ({list.length})</div>
            {list.map(card => {
              const events = card.card_events as { event_type: string; occurred_at: string; actor_type: string }[]
              const lastIssued = events?.find(e => e.event_type === 'issued')
              const wasIssued = !!lastIssued

              return (
                <div key={card.id} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-mono font-semibold text-hope-dark">{card.card_code}</div>
                      <div className="text-xs text-muted-foreground">{formatDateHamilton(card.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-hope-dark">{formatCAD(card.balance_cents)}</span>
                      <CardStateBadge state={card.state} />
                    </div>
                  </div>
                  {wasIssued && (
                    <div className="text-xs text-hope-teal bg-hope-pale rounded-lg px-2 py-1">
                      Issued {formatDateHamilton(lastIssued!.occurred_at)}
                    </div>
                  )}
                  <AdvocateCardActions cardId={card.id} cardCode={card.card_code} cardState={card.state} wasIssued={wasIssued} />
                </div>
              )
            })}
          </div>
        )
      ))}

      {cards?.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-2">
          <div className="text-3xl">📭</div>
          <div className="text-sm text-muted-foreground">No cards found</div>
        </div>
      )}
    </div>
  )
}
