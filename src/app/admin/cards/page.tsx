import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { CardStateBadge } from '@/components/card-state-badge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminCardsPage({
  searchParams,
}: {
  searchParams: { state?: string; page?: string }
}) {
  const admin = createAdminClient()
  const page = parseInt(searchParams.page || '1', 10)
  const pageSize = 50
  const offset = (page - 1) * pageSize

  let query = admin
    .from('cards')
    .select('id, card_code, state, balance_cents, allowed_categories, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (searchParams.state) {
    query = query.eq('state', searchParams.state)
  }

  const { data: cards, count } = await query

  const states = ['unloaded', 'active', 'exhausted', 'invalidated', 'expired']

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-hope-dark">Cards ({count ?? 0})</h1>
        <Link href="/admin/print-cards" className="text-sm text-hope-green font-medium">Print Sheet →</Link>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <Link
          href="/admin/cards"
          className={`px-3 py-1.5 rounded-full text-xs font-medium ${!searchParams.state ? 'bg-hope-green text-white' : 'bg-white text-hope-dark border border-border'}`}
        >
          All
        </Link>
        {states.map(s => (
          <Link
            key={s}
            href={`/admin/cards?state=${s}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${
              searchParams.state === s ? 'bg-hope-green text-white' : 'bg-white text-hope-dark border border-border'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">State</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Balance</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cards?.map(card => (
              <tr key={card.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-semibold text-hope-dark">{card.card_code}</td>
                <td className="px-4 py-3"><CardStateBadge state={card.state} /></td>
                <td className="px-4 py-3 text-right font-semibold">{formatCAD(card.balance_cents)}</td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatDateHamilton(card.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {count && count > pageSize && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link href={`/admin/cards?page=${page - 1}${searchParams.state ? `&state=${searchParams.state}` : ''}`}
              className="px-4 py-2 bg-white rounded-lg border text-sm">← Prev</Link>
          )}
          {offset + pageSize < count && (
            <Link href={`/admin/cards?page=${page + 1}${searchParams.state ? `&state=${searchParams.state}` : ''}`}
              className="px-4 py-2 bg-white rounded-lg border text-sm">Next →</Link>
          )}
        </div>
      )}
    </div>
  )
}
