'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') || '/'

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

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-hope-pale rounded-full mx-auto flex items-center justify-center">
          <span className="text-3xl">✉️</span>
        </div>
        <h2 className="text-xl font-bold text-hope-dark">Check your email</h2>
        <p className="text-muted-foreground text-sm">
          We sent a magic link to <strong>{email}</strong>.<br />
          Click it to sign in — no password needed.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-hope-green text-white rounded-lg py-2.5 font-semibold text-sm hover:bg-hope-teal transition-colors disabled:opacity-50"
      >
        {loading ? 'Sending…' : 'Send Magic Link'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-hope-pale flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="w-12 h-12 bg-hope-green rounded-xl mx-auto flex items-center justify-center mb-3">
            <span className="text-2xl">🌿</span>
          </div>
          <h1 className="text-xl font-bold text-hope-dark">Sign in to HOPE Card</h1>
          <p className="text-muted-foreground text-xs">No password required — we&apos;ll email you a link</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
