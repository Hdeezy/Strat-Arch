/**
 * PRINT CARDS.
 *
 * Turns unloaded cards into physical stock. The codes are non-enumerable by
 * the time they reach here — 8 characters of Crockford base32 with the
 * ambiguous glyphs removed, because these get read aloud across a counter
 * and typed by someone who has never seen the card before.
 *
 * Only UNLOADED cards are printable. A card that already holds value has
 * been handed to somebody, and printing a second copy of its code would mean
 * two people holding the same money.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, Panel, Empty } from '@/components/ui/primitives'
import { Printer, Info, CreditCard } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PrintCardsPage() {
  const admin = createAdminClient()

  const { data } = await admin
    .from('cards')
    .select('id, card_code, state')
    .eq('state', 'unloaded')
    .order('card_code', { ascending: true })
    .limit(100)

  const cards = (data ?? []) as unknown as { id: string; card_code: string }[]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Print cards"
        description="Blank cards waiting to be printed and put into an advocate's hands."
        action={
          cards.length > 0 ? (
            <a
              href="/api/admin/print-cards-pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white
                         hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              <Printer className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Download {cards.length} as PDF
            </a>
          ) : undefined
        }
      />

      {cards.length === 0 ? (
        <Panel>
          <Empty
            icon={CreditCard}
            title="No blank cards to print"
            description="Every card in the system has already been funded or issued. New blanks have to be created in the database before they can be printed."
          />
        </Panel>
      ) : (
        <>
          <Panel tone="warning" className="p-4 flex gap-3">
            <Info className="h-4 w-4 flex-none text-amber-700 mt-0.5" strokeWidth={2} aria-hidden="true" />
            <div className="text-sm text-amber-900 space-y-1">
              <p className="font-medium">Before you print</p>
              <p>
                Business card stock, 3.5&quot; × 2&quot;, ten to a sheet. Print at 100% —
                any page scaling shrinks the QR code and scanners start failing at
                the counter.
              </p>
              <p>
                Each code is printed once. If a sheet is spoiled, destroy it rather
                than reprinting, so two people never hold the same code.
              </p>
            </div>
          </Panel>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Preview
              <span className="ml-2 font-normal text-slate-500">
                first {Math.min(12, cards.length)} of {cards.length}
              </span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {cards.slice(0, 12).map(card => (
                <div
                  key={card.id}
                  className="bg-slate-900 rounded-lg p-3 text-white aspect-[1.75/1] flex flex-col justify-between"
                >
                  <div className="text-[9px] uppercase tracking-[0.12em] text-emerald-400">
                    HOPE Card · Hamilton
                  </div>
                  <div>
                    <div className="text-sm font-mono font-bold tracking-wide">
                      {card.card_code}
                    </div>
                    <div className="text-[8px] text-slate-400 mt-0.5">
                      Not a payment card · Not ID
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {cards.length > 12 && (
              <p className="text-xs text-slate-500">
                The PDF contains all {cards.length}, laid out for cutting.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
