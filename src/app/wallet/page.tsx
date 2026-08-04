'use client'

import { useState } from 'react'
import { validateCardCode, normalizeCardCode } from '@/lib/utils'

export default function WalletPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const normalized = normalizeCardCode(code)
    // Shared validator, not a private copy — a local regex here is exactly
    // what silently rejected every 8-character code after the codes changed.
    if (!validateCardCode(normalized)) {
      setError('That doesn\u2019t look like a card code. It looks like HMLT-3F7K2QX9.')
      return
    }
    setLoading(true)
    window.location.href = `/wallet/${normalized}`
  }

  return (
    <main className="min-h-screen bg-hope-dark flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-8">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-hope-green rounded-2xl mx-auto flex items-center justify-center">
            <span className="text-3xl">💳</span>
          </div>
          <h1 className="text-2xl font-bold text-white">My HOPE Card</h1>
          <p className="text-hope-light text-sm">Check your balance and find nearby merchants</p>
        </div>

        <div className="bg-white rounded-2xl p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Card Code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="HMLT-0001"
                maxLength={9}
                className="w-full border border-input rounded-lg px-3 py-3 text-lg font-mono uppercase tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-hope-green"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-hope-green text-white rounded-xl py-3 font-semibold hover:bg-hope-teal transition-colors disabled:opacity-50"
            >
              {loading ? 'Looking up…' : 'Check My Card'}
            </button>
          </form>
          <p className="text-xs text-center text-muted-foreground">
            No account needed · Your privacy is protected
          </p>
        </div>
      </div>
    </main>
  )
}
