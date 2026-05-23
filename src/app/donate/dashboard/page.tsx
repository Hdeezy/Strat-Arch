import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { CardStateBadge } from '@/components/card-state-badge'
import { CategoryBadge } from '@/components/category-badge'
import type { CardCategory } from '@/lib/types'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DonorDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login?redirectTo=/donate/dashboard')
  }

  const admin = createAdminClient()

  const { data: donations } = await admin
    .from('donations')
    .select('*, card:cards(id, card_code, state, balance_cents, allowed_categories)')
    .eq('donor_user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-hope-dark">My Funded Cards</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track the journey of every card you&apos;ve loaded
        </p>
      </div>

      {!donations || donations.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3">
          <div className="text-4xl">🌱</div>
          <div className="font-semibold text-hope-dark">No cards funded yet</div>
          <div className="text-sm text-muted-foreground">Scan a blank HOPE Card to make your first donation</div>
          <Link
            href="/donate"
            className="inline-block bg-hope-green text-white rounded-xl px-6 py-2.5 font-semibold text-sm hover:bg-hope-teal transition-colors"
          >
            Fund a Card
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {donations.map(donation => {
            const card = donation.card as {
              id: string
              card_code: string
              state: string
              balance_cents: number
              allowed_categories: CardCategory[]
            } | null

            return (
              <div key={donation.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-hope-dark p-4 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-hope-light">Funded {formatDateHamilton(donation.created_at)}</div>
                      <div className="text-lg font-mono font-bold">{card?.card_code || '—'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-hope-light">You donated</div>
                      <div className="text-xl font-bold">{formatCAD(donation.amount_cents)}</div>
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Current balance</div>
                    <div className="font-semibold text-hope-dark">{formatCAD(card?.balance_cents || 0)}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {card?.allowed_categories.map((cat: CardCategory) => (
                      <CategoryBadge key={cat} category={cat} />
                    ))}
                  </div>
                  {donation.donor_note && (
                    <div className="bg-hope-pale rounded-lg p-2 text-xs text-hope-dark italic">
                      &ldquo;{donation.donor_note}&rdquo;
                    </div>
                  )}
                  {card && (
                    <Link
                      href={`/donate/cards/${card.id}`}
                      className="block text-center text-sm text-hope-green font-medium hover:text-hope-teal"
                    >
                      View chain of custody →
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
