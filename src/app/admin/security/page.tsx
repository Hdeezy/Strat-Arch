/**
 * SAFETY SIGNALS.
 *
 * One rule governs this whole page, and it is easy to get backwards:
 *
 *   A member checking their own balance ten times is someone budgeting
 *   carefully. That must never be blocked, throttled, or flagged.
 *
 *   One source looking up MANY DIFFERENT cards is someone other than the
 *   member, walking the card space.
 *
 * So this page watches breadth, not volume — distinct cards touched, not
 * total lookups. And it only ever logs and alerts. Scrappy Cut §3a control 2:
 * "Log it and alert; do not silently block."
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getEnumerationSignals } from '@/lib/admin-queries'
import { formatDateHamilton } from '@/lib/utils'
import {
  PageHeader, Section, Panel, Status, Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { ShieldCheck, Eye, KeyRound, EyeOff, Lock } from 'lucide-react'

export const dynamic = 'force-dynamic'

const WATCH = 5
const INVESTIGATE = 12

export default async function SecurityPage() {
  const admin = createAdminClient()
  const signals = await getEnumerationSignals(admin, 24, WATCH)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Safety signals"
        description="Who is reading card balances, and whether the pattern looks like a cardholder or like someone working through the card space."
      />

      <Panel className="p-4 flex gap-3">
        <Eye className="h-4 w-4 flex-none text-slate-400 mt-0.5" strokeWidth={2} aria-hidden="true" />
        <div className="text-sm text-slate-600 space-y-1.5">
          <p>
            <span className="font-medium text-slate-900">This page never blocks anyone.</span>{' '}
            Someone checking their own balance repeatedly is budgeting, and a card
            that stops answering at the wrong moment is a person going without.
          </p>
          <p>
            What is watched is <span className="font-medium text-slate-900">breadth</span> —
            how many <em>different</em> cards one source touched — because that is the
            shape of enumeration rather than use.
          </p>
        </div>
      </Panel>

      <Section
        title="Sources in the last 24 hours"
        description={`Showing any source that touched ${WATCH} or more distinct cards.`}
      >
        {signals.length === 0 ? (
          <Panel>
            <Empty
              icon={ShieldCheck}
              title="Nothing unusual"
              description={`No source has looked up ${WATCH} or more different cards in the last 24 hours. Ordinary cardholder traffic does not appear here.`}
            />
          </Panel>
        ) : (
          <Table>
            <THead>
              <TH>Source</TH>
              <TH align="right">Distinct cards</TH>
              <TH align="right">Total lookups</TH>
              <TH>Last seen</TH>
              <TH>Assessment</TH>
            </THead>
            <TBody>
              {signals.map(s => {
                const investigate = s.distinct_cards >= INVESTIGATE
                return (
                  <TR key={s.source_hash}>
                    <TD mono>{s.source_hash.slice(0, 12)}…</TD>
                    <TD align="right" className="font-semibold tabular-nums">
                      {s.distinct_cards}
                    </TD>
                    <TD align="right" className="tabular-nums text-slate-500">
                      {s.total_lookups}
                    </TD>
                    <TD className="text-slate-500">{formatDateHamilton(s.last_seen)}</TD>
                    <TD>
                      {investigate ? (
                        <Status tone="danger">Investigate</Status>
                      ) : (
                        <Status tone="warn">Watch</Status>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Controls already in force"
        description="Standing properties of the system, not things anyone has to remember to do."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ControlCard
            icon={KeyRound}
            title="Card codes cannot be guessed"
            body="Codes carry 8 characters of Crockford base32, roughly 40 bits. The original pilot codes ran HMLT-0001 to HMLT-0050 — guess one and you had guessed all fifty. Migration 008 retired that scheme and a database constraint now refuses any new sequential code."
          />
          <ControlCard
            icon={EyeOff}
            title="The member page shows no history"
            body="A balance is safe: it discloses nothing a holder could not learn by spending. History is different. 'Used at 541 Eatery, Tuesday 6pm' is a location trail on a vulnerable person, readable by anyone holding the card — a shelter worker, an officer, an abusive partner. This is a design rule, not a deferred feature."
          />
          <ControlCard
            icon={Lock}
            title="Financial history cannot be rewritten"
            body="UPDATE and DELETE on the ledger are revoked from every application role at the database level, and database triggers refuse them again. A mistake is corrected by posting a compensating entry, which is itself permanent. Convention was judged insufficient."
          />
          <ControlCard
            icon={Eye}
            title="No raw addresses are stored"
            body="Lookups record a salted hash of IP and user agent, never the values themselves. Enough to notice one source walking the card space; not enough to reconstruct who anyone is. Rows are pruned after 30 days."
          />
        </div>
      </Section>
    </div>
  )
}

function ControlCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Eye
  title: string
  body: string
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 flex-none text-emerald-600" strokeWidth={2} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
    </Panel>
  )
}
