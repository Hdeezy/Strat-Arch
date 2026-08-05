import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, normalizeCardCode } from '@/lib/utils'
import DonateForm from './donate-form'
import { CardStateBadge } from '@/components/card-state-badge'
import { CategoryBadge } from '@/components/category-badge'
import type { CardCategory } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function getCard(code: string) {
  const admin = createAdminClient()
  const { data: card } = await admin
    .from('cards')
    .select('id, card_code, state, balance_cents, allowed_categories, daily_cap_cents, spent_today_cents')
    .eq('card_code', normalizeCardCode(code))
    .single()
  return card
}

export default async function DonateCardPage({ params }: { params: { code: string } }) {
  const card = await getCard(params.code)
  if (!card) notFound()

  const canLoad = card.state === 'unloaded' || card.state === 'active'

  return (
    <div className="space-y-6">
      {/* Card preview */}
      <div className="bg-hope-dark rounded-2xl p-5 text-white space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-hope-light uppercase tracking-wider">HOPE Card — Hamilton</div>
            <div className="text-2xl font-mono font-bold mt-1">{card.card_code}</div>
          </div>
          <CardStateBadge state={card.state} />
        </div>

        <div className="flex items-end gap-4">
          <div>
            <div className="text-xs text-hope-light">Current Balance</div>
            <div className="text-3xl font-bold">{formatCAD(card.balance_cents)}</div>
          </div>
          {card.balance_cents > 0 && (
            <div className="text-xs text-hope-light mb-1">
              Daily cap: {formatCAD(card.daily_cap_cents)}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {card.allowed_categories.map((cat: CardCategory) => (
            <CategoryBadge key={cat} category={cat} />
          ))}
        </div>
      </div>

      {!canLoad ? (
        <div className="bg-white rounded-2xl shadow-sm p-5 text-center space-y-2">
          <div className="text-2xl">⚠️</div>
          <div className="font-semibold text-hope-dark">
            {card.state === 'invalidated' ? 'This card has been invalidated' : 'This card cannot be loaded'}
          </div>
          <div className="text-sm text-muted-foreground">
            {card.state === 'exhausted'
              ? 'The card balance has been fully used. A new card can be funded.'
              : 'Please contact the charity that issued this card.'}
          </div>
        </div>
      ) : (
        <DonateForm cardId={card.id} cardCode={card.card_code} currentBalance={card.balance_cents} />
      )}
    </div>
  )
}
