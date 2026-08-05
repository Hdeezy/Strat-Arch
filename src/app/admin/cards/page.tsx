/**
 * CARDS — the lookup table.
 *
 * Someone opens this page holding a physical card, or with a code read to
 * them over the phone. So the code is the loudest thing in the row, in
 * monospace, and search matches on it before anything else.
 *
 * Balance is what is on the card; room today is what the card can actually
 * spend before the daily cap stops it. They differ often enough that showing
 * only the first would send an operator to the wrong conclusion when a member
 * says the card was declined.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getCardCounts } from '@/lib/admin-queries'
import { formatDateHamilton, roomToday } from '@/lib/utils'
import {
  PageHeader, Panel, Stat, Money, Status,
  Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { CATEGORY_LABELS, type CardCategory, type CardState } from '@/lib/types'
import {
  CreditCard, Search, Printer, X, CircleCheck, CircleSlash, Ban,
  Hourglass, CalendarX, SearchX, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

/**
 * State is never carried by colour alone — the word is the label, the tone is
 * only reinforcement. Exhausted is amber rather than red: a spent card is a
 * card that worked.
 */
const STATE_META: Record<
  CardState,
  { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted'; icon: LucideIcon }
> = {
  unloaded: { label: 'Unloaded', tone: 'muted', icon: Hourglass },
  active: { label: 'Active', tone: 'ok', icon: CircleCheck },
  exhausted: { label: 'Exhausted', tone: 'warn', icon: CircleSlash },
  invalidated: { label: 'Invalidated', tone: 'danger', icon: Ban },
  expired: { label: 'Expired', tone: 'muted', icon: CalendarX },
}

const STATES = Object.keys(STATE_META) as CardState[]

interface CardRow {
  id: string
  card_code: string
  state: CardState
  balance_cents: number
  daily_cap_cents: number
  spent_today_cents: number
  last_spent_reset_at: string
  allowed_categories: CardCategory[]
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
  const activeState = STATES.includes(searchParams.state as CardState)
    ? (searchParams.state as CardState)
    : undefined

  let query = admin
    .from('cards')
    .select(
      'id, card_code, state, balance_cents, daily_cap_cents, spent_today_cents, last_spent_reset_at, allowed_categories, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (activeState) query = query.eq('state', activeState)
  if (search) query = query.ilike('card_code', `%${search}%`)

  const [result, counts] = await Promise.all([query, getCardCounts(admin)])

  const cards = (result.data ?? []) as unknown as CardRow[]
  const count = result.count ?? 0
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  function filterUrl(params: Record<string, string | undefined>) {
    const merged = { state: activeState, q: search || undefined, ...params }
    const parts = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    return `/admin/cards${parts.length ? '?' + parts.join('&') : ''}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cards"
        description="Every card issued in the programme. Search by code to find the one in front of you — codes are non-sequential, so partial matches are the fastest route."
        action={
          <Link
            href="/admin/print-cards"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Print sheet
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cards issued" value={counts.total} icon={CreditCard} />
        <Stat
          label="Active"
          value={counts.active}
          tone="positive"
          sub="Loaded and spendable"
        />
        <Stat
          label="Awaiting funds"
          value={counts.unloaded}
          sub="Printed, no donation yet"
        />
        <Stat
          label="Out of circulation"
          value={counts.exhausted + counts.invalidated + counts.expired}
          tone={counts.invalidated > 0 ? 'warning' : 'neutral'}
          sub={`${counts.exhausted} spent · ${counts.invalidated} invalidated · ${counts.expired} expired`}
        />
      </div>

      {/* ── Search & state filter ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <form method="get" action="/admin/cards" className="flex gap-2">
          {activeState && <input type="hidden" name="state" value={activeState} />}
          <div className="relative flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden="true"
            />
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Search card code…"
              aria-label="Search card code"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 font-mono text-sm text-slate-900 shadow-sm placeholder:font-sans placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Search
          </button>
          {search && (
            <Link
              href={filterUrl({ q: undefined, page: undefined })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Clear
            </Link>
          )}
        </form>

        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            href={filterUrl({ state: undefined, page: undefined })}
            label="All"
            // Counts are programme-wide, so they would contradict a filtered
            // result set. Drop them while a search is narrowing the table.
            count={search ? undefined : counts.total}
            selected={!activeState}
          />
          {STATES.map(s => (
            <FilterChip
              key={s}
              href={filterUrl({ state: s, page: undefined })}
              label={STATE_META[s].label}
              count={search ? undefined : counts[s]}
              selected={activeState === s}
            />
          ))}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {cards.length === 0 ? (
        <Panel>
          <Empty
            icon={search ? SearchX : CreditCard}
            title={search ? `No card matches “${search}”` : 'No cards in this state'}
            description={
              search
                ? 'Codes are four letters, a dash, then the suffix. Check the suffix — 0 and O are distinct characters on a printed card.'
                : 'Cards are minted from the print sheet and appear here immediately, before any donation reaches them.'
            }
            action={
              search || activeState ? (
                <Link
                  href="/admin/cards"
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Clear filters
                </Link>
              ) : (
                <Link
                  href="/admin/print-cards"
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Print a sheet of cards
                </Link>
              )
            }
          />
        </Panel>
      ) : (
        <Table>
          <THead>
            <TH>Code</TH>
            <TH>State</TH>
            <TH align="right">Balance</TH>
            <TH align="right">Room today</TH>
            <TH className="hidden lg:table-cell">Spendable on</TH>
            <TH align="right" className="hidden md:table-cell">Created</TH>
          </THead>
          <TBody>
            {cards.map(card => {
              const meta = STATE_META[card.state]
              const room = roomToday(card)
              const capped = card.state === 'active' && room < card.balance_cents
              return (
                <TR key={card.id}>
                  <TD mono className="text-sm font-semibold tracking-tight text-slate-900">
                    {card.card_code}
                  </TD>
                  <TD>
                    <Status tone={meta.tone} icon={meta.icon}>
                      {meta.label}
                    </Status>
                  </TD>
                  <TD align="right" className="font-medium text-slate-900">
                    <Money cents={card.balance_cents} />
                  </TD>
                  <TD align="right">
                    {card.state === 'active' ? (
                      <span className={capped ? 'text-amber-700' : 'text-slate-600'}>
                        <Money cents={room} />
                        {capped && <span className="ml-1 text-xs">capped</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell text-xs text-slate-500">
                    {categorySummary(card.allowed_categories)}
                  </TD>
                  <TD align="right" className="hidden md:table-cell whitespace-nowrap text-xs text-slate-500">
                    {formatDateHamilton(card.created_at)}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {count > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500 tabular-nums">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, count)} of {count}
          </p>
          <div className="flex items-center gap-2">
            <PageLink
              href={filterUrl({ page: String(page - 1) })}
              disabled={page <= 1}
              icon={ChevronLeft}
              label="Previous"
            />
            <span className="text-xs text-slate-500 tabular-nums">
              Page {page} of {totalPages}
            </span>
            <PageLink
              href={filterUrl({ page: String(page + 1) })}
              disabled={offset + PAGE_SIZE >= count}
              icon={ChevronRight}
              label="Next"
              trailing
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** 'multi' means every category, so listing the others alongside it is noise. */
function categorySummary(categories: CardCategory[] | null): string {
  if (!categories?.length) return '—'
  if (categories.includes('multi')) return CATEGORY_LABELS.multi
  return categories.map(c => CATEGORY_LABELS[c] ?? c).join(', ')
}

function FilterChip({
  href,
  label,
  count,
  selected,
}: {
  href: string
  label: string
  count?: number
  selected: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? 'page' : undefined}
      className={
        selected
          ? 'inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white'
          : 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50'
      }
    >
      {label}
      {count != null && <span className="tabular-nums text-slate-400">{count}</span>}
    </Link>
  )
}

function PageLink({
  href,
  disabled,
  icon: Icon,
  label,
  trailing = false,
}: {
  href: string
  disabled: boolean
  icon: LucideIcon
  label: string
  trailing?: boolean
}) {
  const classes =
    'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50'
  if (disabled) {
    return (
      <span className={`${classes} pointer-events-none opacity-40`} aria-disabled="true">
        {!trailing && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
        {label}
        {trailing && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
      </span>
    )
  }
  return (
    <Link href={href} className={classes}>
      {!trailing && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
      {label}
      {trailing && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
    </Link>
  )
}
