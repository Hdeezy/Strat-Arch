import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeCardCode, formatCAD, getDailyCapRemaining } from '@/lib/utils'
import { CategoryBadge } from '@/components/category-badge'
import { CardStateBadge } from '@/components/card-state-badge'
import type { CardCategory, Merchant } from '@/lib/types'
import WalletPassButtons from './wallet-pass-buttons'

export const dynamic = 'force-dynamic'

export default async function WalletCardPage({ params }: { params: { code: string } }) {
  const admin = createAdminClient()

  const { data: card } = await admin
    .from('cards')
    .select('id, card_code, state, balance_cents, allowed_categories, daily_cap_cents, spent_today_cents, last_spent_reset_at, city_id')
    .eq('card_code', normalizeCardCode(params.code))
    .single()

  if (!card || card.state === 'invalidated') notFound()

  const { data: merchants } = await admin
    .from('merchants')
    .select('id, name, address, lat, lng, category')
    .eq('city_id', card.city_id)
    .eq('is_active', true)
    .in('category', card.allowed_categories as CardCategory[])

  const dailyRemaining = getDailyCapRemaining(card)

  return (
    <main className="min-h-screen bg-hope-dark pb-8">
      {/* Card display */}
      <div className="px-4 pt-6 pb-4">
        <div className="bg-gradient-to-br from-hope-green to-hope-dark rounded-2xl p-5 text-white space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-hope-light uppercase tracking-wider">HOPE Card · Hamilton</div>
              <div className="text-2xl font-mono font-bold mt-1">{card.card_code}</div>
            </div>
            <CardStateBadge state={card.state} />
          </div>

          <div>
            <div className="text-xs text-hope-light">Balance</div>
            <div className="text-4xl font-bold">{formatCAD(card.balance_cents)}</div>
          </div>

          <div>
            <div className="text-xs text-hope-light mb-1.5">Valid At</div>
            <div className="flex flex-wrap gap-1.5">
              {card.allowed_categories.map((cat: CardCategory) => (
                <CategoryBadge key={cat} category={cat} />
              ))}
            </div>
          </div>

          <div className="border-t border-white/20 pt-3 text-xs text-hope-light">
            Daily limit: {formatCAD(card.daily_cap_cents)} · Remaining today: {formatCAD(dailyRemaining)}
          </div>
        </div>
      </div>

      {/* Wallet pass buttons */}
      <div className="px-4 pb-4">
        <WalletPassButtons cardId={card.id} />
      </div>

      {/* Nearby merchants */}
      <div className="px-4 space-y-3">
        <div className="text-sm font-semibold text-white">Where to Use Your Card</div>
        {merchants && merchants.length > 0 ? (
          merchants.map((m: Partial<Merchant> & { id: string; name: string; address: string; category: CardCategory }) => (
            <div key={m.id} className="bg-white/10 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-2">
                <CategoryBadge category={m.category} />
              </div>
              <div className="text-white font-semibold">{m.name}</div>
              <div className="text-hope-light text-xs">{m.address}</div>
            </div>
          ))
        ) : (
          <div className="bg-white/10 rounded-xl p-4 text-hope-light text-sm">
            No merchants currently accepting cards in your categories
          </div>
        )}
      </div>
    </main>
  )
}
