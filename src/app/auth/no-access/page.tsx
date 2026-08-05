/**
 * Signed in, but not linked to anything.
 *
 * This is the state a new account lands in: Supabase Auth knows them, but
 * nobody has made them an operator, an advocate, or vendor staff. Bouncing
 * them between portals that each refuse them is the worst version of this,
 * so it gets its own page that names the situation.
 */

import Link from 'next/link'
import { UserPlus } from 'lucide-react'

export default function NoAccessPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <UserPlus className="mx-auto h-9 w-9 text-emerald-400" strokeWidth={1.5} aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">You&apos;re signed in</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Your account works, but it isn&apos;t linked to a workspace yet. Someone who
          runs the programme needs to add you as an operator, an outreach worker, or
          staff at a vendor.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          If you were expecting access, tell them the email you signed in with — that
          is what they need to link.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block text-sm font-semibold text-emerald-400 hover:text-emerald-300"
        >
          Back to the start
        </Link>
      </div>
    </main>
  )
}
