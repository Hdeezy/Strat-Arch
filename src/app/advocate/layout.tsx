/**
 * ADVOCATE SHELL — built for a phone, outdoors, one-handed.
 *
 * This is not the operator console and should not look like it. An advocate
 * is standing on James St North in February with gloves on, talking to
 * someone. The constraints are different from a desk:
 *
 *   · Bottom tab bar, not a top nav — thumbs reach the bottom of a phone.
 *   · Large targets. A mis-tap while someone waits is a real cost.
 *   · High contrast. Screens get read in direct sun and in the dark.
 *   · Few choices per screen. Sign out a card, look up a card. That is it.
 *
 * Desk density belongs in /admin. Warmth belongs here, because this screen
 * is out in the open next to a person who can see it.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { Home, CreditCard, Layers, UserX } from 'lucide-react'
import { AdvocateTab } from './tab'

export const metadata: Metadata = { title: 'Advocate' }

export default async function AdvocateLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/advocate')

  const admin = createAdminClient()
  const { data: advocateRow } = await admin
    .from('advocates')
    .select('full_name, charity:charities(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  const advocate = advocateRow as unknown as
    | { full_name: string; charity: { name: string } | { name: string }[] | null }
    | null

  if (!advocate) {
    return (
      <main className="min-h-screen bg-hope-dark flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-7 max-w-sm w-full text-center space-y-3">
          <UserX className="mx-auto h-9 w-9 text-slate-400" strokeWidth={1.5} />
          <h1 className="text-lg font-bold text-slate-900">You&apos;re not set up as an advocate yet</h1>
          <p className="text-base text-slate-600">
            Your account works, but it hasn&apos;t been linked to an outreach team.
            Ask whoever runs your programme to add you.
          </p>
          <Link href="/" className="inline-block text-base font-semibold text-hope-green pt-1">
            Back to home
          </Link>
        </div>
      </main>
    )
  }

  const charity = Array.isArray(advocate.charity) ? advocate.charity[0] : advocate.charity
  const firstName = advocate.full_name?.split(' ')[0] ?? 'there'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-hope-dark text-white px-5 pt-5 pb-4">
        <div className="max-w-lg mx-auto">
          <p className="text-xs uppercase tracking-[0.12em] text-hope-light">Outreach</p>
          <p className="text-xl font-bold mt-0.5">{firstName}</p>
          {charity?.name && <p className="text-sm text-hope-light mt-0.5">{charity.name}</p>}
        </div>
      </header>

      {/* pb-24 clears the fixed tab bar so nothing hides behind it. */}
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-5 pb-24">{children}</main>

      <nav
        className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
        aria-label="Advocate sections"
      >
        <div className="max-w-lg mx-auto grid grid-cols-3">
          <AdvocateTab href="/advocate" label="Home" exact>
            <Home className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </AdvocateTab>
          <AdvocateTab href="/advocate/bulk-load" label="Load cards">
            <Layers className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </AdvocateTab>
          <AdvocateTab href="/advocate/cards" label="Cards">
            <CreditCard className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </AdvocateTab>
        </div>
      </nav>
    </div>
  )
}
