'use client'

import { useState, useRef } from 'react'
import { formatCAD } from '@/lib/utils'
import { AMOUNT_PRESETS, type CardCategory } from '@/lib/types'

interface CardEntry {
  code: string
  id?: string
  valid?: boolean
  error?: string
}

interface BatchResult {
  code: string
  success: boolean
  new_balance_cents?: number
  error?: string
}

export default function BulkLoadPage() {
  const [cards, setCards] = useState<CardEntry[]>([])
  const [inputCode, setInputCode] = useState('')
  const [amountCents, setAmountCents] = useState(1000)
  const [isCustom, setIsCustom] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [reason, setReason] = useState('Advocate distribution')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<BatchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  function getEffectiveAmount() {
    return isCustom
      ? Math.round(parseFloat(customAmount || '0') * 100)
      : amountCents
  }

  async function lookupCard(code: string): Promise<{ valid: boolean; id?: string; error?: string }> {
    try {
      const res = await fetch(`/api/lookup/${code}`)
      const data = await res.json()
      if (!res.ok || !data.card) return { valid: false, error: data.error || 'Not found' }
      if (data.card.state === 'invalidated' || data.card.state === 'expired') {
        return { valid: false, error: `Card is ${data.card.state}` }
      }
      return { valid: true, id: data.card.id }
    } catch {
      return { valid: false, error: 'Lookup failed' }
    }
  }

  async function addCard(code: string = inputCode) {
    const normalized = code.trim().toUpperCase()
    if (!normalized || !/^[A-Z]{4}-[A-Z0-9]{4}$/.test(normalized)) {
      setError('Invalid card code format (e.g. HMLT-0001)')
      return
    }
    if (cards.some(c => c.code === normalized)) {
      setError('Card already in batch')
      return
    }

    const entry: CardEntry = { code: normalized, valid: undefined }
    setCards(prev => [...prev, entry])
    setInputCode('')
    setError(null)

    const result = await lookupCard(normalized)
    setCards(prev =>
      prev.map(c => c.code === normalized ? { ...c, ...result } : c)
    )
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const codes = text
      .split(/[\n,;\t]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z]{4}-[A-Z0-9]{4}$/.test(s))
      .filter(s => !cards.some(c => c.code === s))

    if (codes.length === 0) {
      setError('No valid card codes found in CSV')
      return
    }

    // Add all at once as pending, then validate in parallel
    setCards(prev => [...prev, ...codes.map(code => ({ code, valid: undefined as boolean | undefined }))])
    await Promise.all(codes.map(async code => {
      const result = await lookupCard(code)
      setCards(prev => prev.map(c => c.code === code ? { ...c, ...result } : c))
    }))
  }

  function removeCard(code: string) {
    setCards(prev => prev.filter(c => c.code !== code))
  }

  const validCards = cards.filter(c => c.valid === true)
  const effectiveAmount = getEffectiveAmount()
  const totalCents = validCards.length * effectiveAmount

  // Credit each valid card via the advocate credit endpoint (no Stripe — loaded
  // from org reserve). For donor-funded Stripe payments, use /donate/[code].
  async function handleBatchCredit() {
    if (validCards.length === 0) { setError('Add at least one valid card'); return }
    if (effectiveAmount < 100) { setError('Minimum $1.00 per card'); return }

    setLoading(true)
    setError(null)
    setResults([])

    const batchResults: BatchResult[] = []

    for (const card of validCards) {
      try {
        const res = await fetch(`/api/cards/${card.id}/credit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount_cents: effectiveAmount, reason }),
        })
        const data = await res.json()

        if (res.ok && data.success) {
          batchResults.push({
            code: card.code,
            success: true,
            new_balance_cents: data.new_balance_cents,
          })
        } else {
          batchResults.push({
            code: card.code,
            success: false,
            error: data.error || 'Failed',
          })
        }
      } catch {
        batchResults.push({ code: card.code, success: false, error: 'Network error' })
      }
    }

    setResults(batchResults)
    // Remove successfully loaded cards from the list
    const failedCodes = new Set(batchResults.filter(r => !r.success).map(r => r.code))
    setCards(prev => prev.filter(c => failedCodes.has(c.code)))
    setLoading(false)
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-hope-dark">Load Cards for Distribution</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Credit cards from your org reserve. For donor Stripe payments, use the{' '}
          <a href="/donate" className="text-hope-green underline">Donate page</a>.
        </p>
      </div>

      {/* Results banner */}
      {results.length > 0 && (
        <div className={`rounded-2xl p-4 ${successCount > 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className={`font-semibold text-sm mb-2 ${successCount > 0 ? 'text-green-800' : 'text-red-800'}`}>
            Batch complete: {successCount} loaded{failCount > 0 ? `, ${failCount} failed` : ''}
          </div>
          {results.map(r => (
            <div key={r.code} className="flex items-center gap-2 text-xs py-0.5">
              <span>{r.success ? '✅' : '❌'}</span>
              <span className="font-mono">{r.code}</span>
              {r.success && r.new_balance_cents != null && (
                <span className="text-green-700">→ {formatCAD(r.new_balance_cents)}</span>
              )}
              {!r.success && <span className="text-red-600">{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Add card */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <div className="text-sm font-semibold text-hope-dark">Add Cards</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputCode}
            onChange={e => setInputCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addCard()}
            placeholder="HMLT-0001"
            maxLength={9}
            className="flex-1 border border-input rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-hope-green"
          />
          <button
            onClick={() => addCard()}
            className="bg-hope-green text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-hope-teal transition-colors"
          >
            Add
          </button>
        </div>

        {/* CSV upload */}
        <div className="flex items-center gap-2">
          <input
            ref={csvRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleCSV}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => csvRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-hope-green border border-hope-green rounded-lg px-3 py-1.5 hover:bg-hope-pale transition-colors"
          >
            📄 Upload CSV
          </button>
          <span className="text-xs text-muted-foreground">One code per line or comma-separated</span>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {/* Card list */}
      {cards.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-hope-dark">
              Batch ({cards.length} • {validCards.length} valid)
            </div>
            <button
              onClick={() => setCards([])}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Clear all
            </button>
          </div>
          {cards.map(c => (
            <div key={c.code} className="flex items-center gap-2 py-1">
              <span className="text-base w-6 text-center">
                {c.valid === undefined ? '⏳' : c.valid ? '✅' : '❌'}
              </span>
              <span className="font-mono text-sm flex-1">{c.code}</span>
              {c.error && <span className="text-xs text-destructive">{c.error}</span>}
              <button
                onClick={() => removeCard(c.code)}
                className="text-xs text-muted-foreground hover:text-destructive px-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Amount */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <div className="text-sm font-semibold text-hope-dark">Amount Per Card</div>
        <div className="grid grid-cols-3 gap-2">
          {AMOUNT_PRESETS.map(cents => (
            <button
              key={cents}
              type="button"
              onClick={() => { setAmountCents(cents); setIsCustom(false) }}
              className={`py-2 rounded-xl text-sm font-semibold border transition-colors ${
                !isCustom && amountCents === cents
                  ? 'bg-hope-green text-white border-hope-green'
                  : 'bg-white text-hope-dark border-border hover:border-hope-green'
              }`}
            >
              {formatCAD(cents)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsCustom(true)}
            className={`py-2 rounded-xl text-sm font-semibold border transition-colors ${
              isCustom ? 'bg-hope-green text-white border-hope-green' : 'bg-white text-hope-dark border-border'
            }`}
          >
            Custom
          </button>
        </div>
        {isCustom && (
          <input
            type="number"
            min="1"
            step="0.01"
            value={customAmount}
            onChange={e => setCustomAmount(e.target.value)}
            placeholder="Custom amount (CAD)"
            className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green"
          />
        )}
      </div>

      {/* Reason note */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
        <div className="text-sm font-semibold text-hope-dark">Load Reason</div>
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={200}
          className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green"
        />
      </div>

      {/* Totals */}
      {validCards.length > 0 && (
        <div className="bg-hope-dark text-white rounded-2xl p-4 space-y-1">
          <div className="text-xs text-hope-light">Batch Total</div>
          <div className="text-3xl font-bold">{formatCAD(totalCents)}</div>
          <div className="text-xs text-hope-light">
            {validCards.length} card{validCards.length !== 1 ? 's' : ''} × {formatCAD(effectiveAmount)} each
          </div>
        </div>
      )}

      <button
        onClick={handleBatchCredit}
        disabled={loading || validCards.length === 0 || effectiveAmount < 100}
        className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors disabled:opacity-50"
      >
        {loading
          ? 'Loading cards…'
          : `Load ${validCards.length} card${validCards.length !== 1 ? 's' : ''} · ${formatCAD(totalCents)}`}
      </button>
    </div>
  )
}
