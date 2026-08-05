/**
 * WHERE TO USE A HOPE CARD.
 *
 * Deliberately NOT bound to a credential. This is the same list for
 * everybody — the digital version of a poster on a wall — so it discloses
 * nothing about any cardholder.
 *
 * The member balance view links here rather than rendering vendor names
 * itself, because a vendor list on a credential-bound page is one scan away
 * from anyone who picks up the card. Scrappy Cut §3a.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { CategoryBadge } from '@/components/category-badge'
import { CATEGORY_LABELS, type CardCategory } from '@/lib/types'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function WherePage() {
  const admin = createAdminClient()

  const { data: merchants } = await admin
    .from('merchants')
    .select('id, name, address, category')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  const rows = (merchants ?? []) as unknown as {
    id: string
    name: string
    address: string
    category: CardCategory
  }[]

  const byCategory = new Map<CardCategory, { id: string; name: string; address: string }[]>()
  for (const m of rows) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, [])
    byCategory.get(m.category)!.push({ id: m.id, name: m.name, address: m.address })
  }

  return (
    <main className="min-h-screen bg-hope-dark pb-10">
      <div className="px-4 pt-6 space-y-5 max-w-md mx-auto">
        <header className="space-y-1">
          <h1 className="text-3xl font-bold text-white">Where to use your card</h1>
          <p className="text-base text-hope-light">
            Every place below accepts the HOPE Card in Hamilton.
          </p>
        </header>

        {byCategory.size === 0 ? (
          <p className="bg-white rounded-2xl p-5 text-base text-gray-800">
            No places are listed yet. Call your outreach worker and they will
            tell you where to go.
          </p>
        ) : (
          Array.from(byCategory.entries()).map(([category, list]) => (
            <section key={category} aria-labelledby={`cat-${category}`} className="space-y-2">
              <h2 id={`cat-${category}`} className="flex items-center gap-2">
                <CategoryBadge category={category} />
                <span className="text-base font-semibold text-white">
                  {CATEGORY_LABELS[category]}
                </span>
              </h2>
              <ul className="space-y-2">
                {list.map(m => (
                  <li key={m.id} className="bg-white rounded-xl p-4">
                    <p className="text-lg font-bold text-gray-900">{m.name}</p>
                    <p className="text-base text-gray-700">{m.address}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <Link
          href="/wallet"
          className="block text-center text-white text-lg font-semibold underline
                     focus:outline-none focus:ring-4 focus:ring-white/50 rounded py-2"
        >
          ← Check a card balance
        </Link>
      </div>
    </main>
  )
}
