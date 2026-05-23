import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import Link from 'next/link'
import { CardStateBadge } from '@/components/card-state-badge'

export const dynamic = 'force-dynamic'

async function getCardById(id: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('cards')
    .select('id, card_code, state, balance_cents, allowed_categories')
    .eq('id', id)
    .single()
  return data
}

export default async function DonateSuccessPage({
  searchParams,
}: {
  searchParams: { card_id?: string; session_id?: string }
}) {
  const card = searchParams.card_id ? await getCardById(searchParams.card_id) : null

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <div className="w-20 h-20 bg-hope-green rounded-full mx-auto flex items-center justify-center">
          <span className="text-4xl">✓</span>
        </div>
        <h1 className="text-2xl font-bold text-hope-dark">Thank You!</h1>
        <p className="text-muted-foreground text-sm">
          Your donation has been processed. The card is now loaded and ready to use.
        </p>
      </div>

      {card && (
        <div className="bg-hope-dark rounded-2xl p-5 text-white text-left space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-hope-light">Card Loaded</div>
              <div className="text-xl font-mono font-bold">{card.card_code}</div>
            </div>
            <CardStateBadge state={card.state} />
          </div>
          <div>
            <div className="text-xs text-hope-light">New Balance</div>
            <div className="text-3xl font-bold">{formatCAD(card.balance_cents)}</div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-5 text-left space-y-3">
        <div className="text-sm font-semibold text-hope-dark">What happens next?</div>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><span className="font-bold text-hope-green">1.</span> An outreach worker will give this card to someone who needs it</li>
          <li className="flex gap-2"><span className="font-bold text-hope-green">2.</span> They can use it at 541 Eatery & Exchange and other partnered merchants</li>
          <li className="flex gap-2"><span className="font-bold text-hope-green">3.</span> You can track the full journey below — location, time, amount spent</li>
        </ol>
      </div>

      {card && (
        <div className="space-y-2">
          <Link
            href={`/donate/${card.card_code}`}
            className="block w-full bg-hope-green text-white rounded-xl py-3 font-semibold text-sm hover:bg-hope-teal transition-colors"
          >
            Add More Funds
          </Link>
          <Link
            href="/donate/dashboard"
            className="block w-full bg-white border border-border rounded-xl py-3 font-semibold text-sm text-hope-dark hover:bg-hope-pale transition-colors"
          >
            View My Funded Cards
          </Link>
        </div>
      )}
    </div>
  )
}
