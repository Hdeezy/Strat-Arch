'use client'

/**
 * SIGN IN.
 *
 * Magic link only — no passwords to leak, reset, or share between shift
 * workers at a till. Matches the front door rather than the old white card,
 * because this is now the first real screen most staff see.
 */

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, MailCheck, AlertCircle } from 'lucide-react'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()

  // Passed straight through to the callback, which honours it over
  // role-routing so "sign in to see this page" lands where it promised.
  const redirectTo = searchParams.get('redirectTo') || '/'
  const authError = searchParams.get('error')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    })

    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-9 w-9 text-emerald-400" strokeWidth={1.5} aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-white">Check your email</h2>
        <p className="mt-2 text-base leading-relaxed text-slate-300">
          We sent a link to <span className="font-medium text-white">{email}</span>.
          Open it on this device and you&apos;re in.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Nothing after a minute? Check spam, or{' '}
          <button
            type="button"
            onClick={() => { setSent(false); setError(null) }}
            className="font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
          >
            try a different address
          </button>
          .
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {authError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-200"
        >
          <AlertCircle className="h-4 w-4 flex-none mt-0.5" strokeWidth={2} aria-hidden="true" />
          That link didn&apos;t work — it may have already been used or expired. Send a new one.
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@organisation.ca"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-3 text-base text-white
                     placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !email}
        className="group flex items-center justify-center gap-2 w-full rounded-lg bg-white px-6 py-3
                   text-base font-semibold text-slate-950 transition-colors hover:bg-slate-100
                   disabled:opacity-40 disabled:cursor-not-allowed
                   focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
      >
        {loading ? 'Sending…' : 'Email me a link'}
        {!loading && (
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} aria-hidden="true" />
        )}
      </button>

      <p className="text-center text-sm text-slate-500">
        No password. The link signs you in and expires after use.
      </p>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
              Hamilton, Ontario
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">HOPE Card</h1>
          </Link>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
