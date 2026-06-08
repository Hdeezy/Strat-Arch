import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { CardStateBadge } from '@/components/card-state-badge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATES = ['unloaded', 'active', 'exhausted', 'invalidated', 'expired']
const PAGE_SIZE = 50

type CardRow = {
  id: string
  card_code: string
  state: string
  balance_cents: number
  allowed_categories: string[]
  created_at: string
}

export default async function AdminCardsPage({
  searchParams,
}: {
  searchParams: { state?: string; page?: string; q?: string }
}) {
  const admin = createAdminClient()
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE
  const search = searchParams.q?.trim().toUpperCase() ?? ''

  let query = admin
    .from('cards')
    .select('id, card_code, state, balance_cents, allowed_categories, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (searchParams.state) query = query.eq('state', searchParams.state)
  if (search) query = query.ilike('card_code', `%${search}%`)

  const result = await query
  const cards = result.data as CardRow[] | null
  const count = result.count

  function filterUrl(params: Record<string, string | undefined>) {
    const merged = { state: searchParams.state, q: search || undefined, ...params }
    const parts = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    return `/admin/cards${parts.length ? '?' + parts.join('&') : ''}`
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-hope-dark">Cards ({count ?? 0})</h1>
        <Link href="/admin/print-cards" className="text-sm text-hope-green font-medium">
          Print Sheet →
        </Link>
      </div>

      {/* Search */}
      <form method="get" action="/admin/cards" className="flex gap-2">
        {searchParams.state && (
          <input type="hidden" name="state" value={searchParams.state} />
        )}
        <input
          type="text"
          name="q"
          defaultValue={search}
          placeholder="Search card code…"
          className="flex-1 border border-input rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-hope-green"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-hope-green text-white rounded-lg text-sm font-semibold"
        >
          Search
        </button>
        {search && (
          <Link
            href={filterUrl({ q: undefined, page: undefined })}
            className="px-4 py-2 bg-white border border-border rounded-lg text-sm text-muted-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      {/* State filters */}
      <div className="flex gap-2 flex-wrap">
        <Link
          href={filterUrl({ state: undefined, page: undefined })}
          className={`px-3 py-1.5 rounded-full text-xs font-medium ${
            !searchParams.state ? 'bg-hope-green text-white' : 'bg-white text-hope-dark border border-border'
          }`}
        >
          All
        </Link>
        {STATES.map(s => (
          <Link
            key={s}
            href={filterUrl({ state: s, page: undefined })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${
              searchParams.state === s
                ? 'bg-hope-green text-white'
                : 'bg-white text-hope-dark border border-border'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">State</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Balance</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!cards?.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No cards found{search ? ` matching "${search}"` : ''}.
                </td>
              </tr>
            ) : (
              cards.map(card => (
                <tr key={card.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-semibold text-hope-dark">{card.card_code}</td>
                  <td className="px-4 py-3"><CardStateBadge state={card.state} /></td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCAD(card.balance_cents)}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden md:table-cell">
                    {formatDateHamilton(card.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {count != null && count > PAGE_SIZE && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link
              href={filterUrl({ page: String(page - 1) })}
              className="px-4 py-2 bg-white rounded-lg border text-sm hover:bg-gray-50"
            >
              ← Prev
            </Link>
          )}
          <span className="px-4 py-2 text-sm text-muted-foreground">
            Page {page} of {Math.ceil(count / PAGE_SIZE)}
          </span>
          {offset + PAGE_SIZE < count && (
            <Link
              href={filterUrl({ page: String(page + 1) })}
              className="px-4 py-2 bg-white rounded-lg border text-sm hover:bg-gray-50"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
