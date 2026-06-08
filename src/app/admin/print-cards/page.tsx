import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export default async function PrintCardsPage() {
  const admin = createAdminClient()

  const { data: cards } = await admin
    .from('cards')
    .select('id, card_code, state')
    .eq('state', 'unloaded')
    .order('card_code', { ascending: true })
    .limit(50)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-hope-dark">Print Cards</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {cards?.length ?? 0} unloaded cards ready to print
          </p>
        </div>
        <a
          href="/api/admin/print-cards-pdf"
          target="_blank"
          className="bg-hope-green text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-hope-teal transition-colors flex items-center gap-2"
        >
          <span>🖨️</span> Download PDF
        </a>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Print instructions:</strong> Use business card paper (3.5&quot; × 2&quot;, 10 per sheet).
        Print at 100% scale, no page scaling. Cut along the dotted lines.
      </div>

      {/* Preview grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards?.slice(0, 12).map(card => (
          <div
            key={card.id}
            className="bg-hope-dark rounded-xl p-3 text-white aspect-[1.75/1] flex flex-col justify-between"
          >
            <div>
              <div className="text-[8px] text-hope-light uppercase tracking-wider">HOPE Card · Hamilton</div>
              <div className="text-xs font-bold mt-1">🌿</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono font-bold">{card.card_code}</div>
              <div className="text-[7px] text-hope-light mt-0.5">Scan to fund</div>
            </div>
          </div>
        ))}
      </div>

      {cards && cards.length > 12 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing 12 of {cards.length} unloaded cards. Download PDF to see all.
        </p>
      )}
    </div>
  )
}
