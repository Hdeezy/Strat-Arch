/**
 * THE FRONT DOOR.
 *
 * This is a staff entry point, not a public menu. Funders, outreach teams,
 * partner organisations and vendors sign in here. Cardholders do not — they
 * reach their balance by scanning the card in their hand, which lands them
 * directly on /wallet/CODE.
 *
 * WHY THERE IS NO "CHECK MY CARD" BUTTON HERE
 *
 * A balance-lookup form on a public front door is an invitation to try
 * codes. It is the exact enumeration that /admin/security watches for, and
 * putting it on the homepage would be advertising the attack. The wallet
 * page still works for anyone holding a credential — that is the deliberate
 * bearer-instrument trade — but a bearer surface should be reached by
 * bearing the thing, not by being offered a search box.
 *
 * Signed-in staff never see this page: they are routed straight to whichever
 * portal they belong to.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { resolvePortalAccess } from '@/lib/portal-routing'
import { ArrowRight, Scale, Users, Store, ShieldCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Land people where they work, not on a menu.
  if (user) {
    const access = await resolvePortalAccess(user.id)
    if (access.portal !== 'none') redirect(access.href)
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* A single wide radial behind the fold — enough to stop the dark
          reading as flat, subtle enough not to become decoration. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-[0.18]"
        style={{
          background:
            'radial-gradient(60rem 30rem at 50% -8rem, rgb(16 185 129), transparent 65%)',
        }}
        aria-hidden="true"
      />

      <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <header className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
              Hamilton, Ontario
            </p>
            <h1 className="mt-3 text-5xl font-semibold tracking-tight">HOPE Card</h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-300">
              A closed-loop rail for essentials — funded by donors, handed over by
              outreach workers, spent at local shops.
            </p>
          </header>

          <div className="mt-10">
            <Link
              href="/auth/login"
              className="group flex items-center justify-center gap-2.5 w-full rounded-xl bg-white px-6 py-4
                         text-base font-semibold text-slate-950 transition-colors hover:bg-slate-100
                         focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
            >
              Sign in
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            </Link>
            <p className="mt-3 text-center text-sm text-slate-400">
              You&apos;ll land on your own workspace. One sign-in covers every role you hold.
            </p>
          </div>

          <div className="mt-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Who this is for
            </p>
            <ul className="mt-4 space-y-2.5">
              <Audience
                icon={Scale}
                title="Charities and funders"
                body="Watch the ledger, clear donations, settle vendors, prove every dollar."
              />
              <Audience
                icon={Users}
                title="Outreach teams"
                body="Load cards before a shift and hand them over inside a relationship."
              />
              <Audience
                icon={Store}
                title="Local vendors"
                body="Take a card at the till and see exactly what you're owed."
              />
            </ul>
          </div>
        </div>
      </div>

      <footer className="relative border-t border-white/10 px-6 py-6">
        <div className="mx-auto max-w-lg flex flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Not a payment card. Not identification. Not a medical ID.
          </p>
          <p className="text-xs text-slate-600">
            Have a card?{' '}
            <span className="text-slate-500">
              Scan the code on it — no account needed.
            </span>
          </p>
        </div>
      </footer>
    </main>
  )
}

function Audience({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Scale
  title: string
  body: string
}) {
  return (
    <li className="flex gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <Icon className="h-5 w-5 flex-none text-emerald-400 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{body}</p>
      </div>
    </li>
  )
}
