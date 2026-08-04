/**
 * ADVOCATE HOME.
 *
 * Answers one question in the first second: how many working cards do I have
 * on me right now? Everything else is secondary to that, because it is the
 * thing an advocate actually needs to know before walking out the door.
 *
 * The "ready to hand out" figure counts UNLOADED cards, not active ones — an
 * unloaded card is a blank you can still give away, and a card already in
 * someone's hands is not yours to count.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD } from '@/lib/utils'
import Link from 'next/link'
import { Layers, CreditCard, ChevronRight, AlertCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdvocatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/advocate')

  const admin = createAdminClient()
  const { data: advocate } = await admin
    .from('advocates')
    .select('id, charity_id, full_name')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!advocate) redirect('/advocate')

  const { data: cardRows } = await admin
    .from('cards')
    .select('id, state, balance_cents')
    .eq('charity_id', advocate.charity_id)

  const cards = (cardRows ?? []) as unknown as { state: string; balance_cents: number }[]
  const count = (s: string) => cards.filter(c => c.state === s).length

  const readyToGive = count('unloaded')
  const inPeoplesHands = count('active')
  const valueOut = cards
    .filter(c => c.state === 'active')
    .reduce((s, c) => s + Number(c.balance_cents), 0)

  return (
    <div className="space-y-5">
      {/* The one number that matters before you leave. */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-base font-medium text-slate-600">Blank cards ready to hand out</p>
        <p className="text-6xl font-bold text-hope-dark leading-none mt-2 tabular-nums">
          {readyToGive}
        </p>
        {readyToGive === 0 && (
          <p className="mt-3 flex items-start gap-2 text-base text-amber-800 bg-amber-50 rounded-xl p-3">
            <AlertCircle className="h-5 w-5 flex-none mt-0.5" strokeWidth={2} aria-hidden="true" />
            <span>
              You have none left. Ask your programme lead to print and register more
              before your next shift.
            </span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-600">In people&apos;s hands</p>
          <p className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{inPeoplesHands}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-600">Value out there</p>
          <p className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">
            {formatCAD(valueOut)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Link
          href="/advocate/bulk-load"
          className="flex items-center gap-4 w-full bg-hope-green hover:bg-hope-teal text-white rounded-2xl p-5 transition-colors
                     focus:outline-none focus-visible:ring-4 focus-visible:ring-hope-green/40"
        >
          <Layers className="h-7 w-7 flex-none" strokeWidth={2} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-bold">Put money on cards</span>
            <span className="block text-sm text-hope-pale mt-0.5">
              Load a batch before your shift
            </span>
          </span>
          <ChevronRight className="h-6 w-6 flex-none" strokeWidth={2.5} aria-hidden="true" />
        </Link>

        <Link
          href="/advocate/cards"
          className="flex items-center gap-4 w-full bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl p-5 transition-colors
                     focus:outline-none focus-visible:ring-4 focus-visible:ring-hope-green/40"
        >
          <CreditCard className="h-7 w-7 flex-none text-hope-green" strokeWidth={2} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-bold text-slate-900">Find a card</span>
            <span className="block text-sm text-slate-600 mt-0.5">
              Check a balance, or stop a lost card
            </span>
          </span>
          <ChevronRight className="h-6 w-6 flex-none text-slate-400" strokeWidth={2.5} aria-hidden="true" />
        </Link>
      </div>

      {/* The lost-card path is the one an advocate needs under pressure, on a
          phone call, so it does not get buried behind a menu. */}
      <div className="bg-slate-100 rounded-2xl p-4">
        <p className="text-base font-semibold text-slate-900">Someone lost their card?</p>
        <p className="text-base text-slate-600 mt-1">
          Find it under <span className="font-semibold">Cards</span>, stop it, and give
          them a new one. The money moves across — they don&apos;t lose a cent.
        </p>
      </div>
    </div>
  )
}
