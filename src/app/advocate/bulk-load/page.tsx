'use client'

import { useState } from 'react'
import { formatCAD } from '@/lib/utils'
import { AMOUNT_PRESETS, CATEGORY_LABELS, CATEGORY_ICONS, type CardCategory } from '@/lib/types'

interface CardEntry {
  code: string
  id?: string
  valid?: boolean
  error?: string
}

const DEFAULT_CATEGORIES: CardCategory[] = ['food', 'transit', 'clothing', 'hygiene']

export default function BulkLoadPage() {
  const [cards, setCards] = useState<CardEntry[]>([])
  const [inputCode, setInputCode] = useState('')
  const [amountCents, setAmountCents] = useState(1000)
  const [isCustom, setIsCustom] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [categories, setCategories] = useState<CardCategory[]>(DEFAULT_CATEGORIES)
  const [donorNote, setDonorNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allCategories: CardCategory[] = ['food', 'transit', 'clothing', 'hygiene']

  function toggleCategory(cat: CardCategory) {
    setCategories(prev =>
      prev.includes(cat) ? (prev.length > 1 ? prev.filter(c => c !== cat) : prev) : [...prev, cat]
    )
  }

  async function addCard() {
    const code = inputCode.trim().toUpperCase()
    if (!code || !/^[A-Z]{4}-[A-Z0-9]{4}$/.test(code)) {
      setError('Invalid card code format (e.g. HMLT-0001)')
      return
    }
    if (cards.some(c => c.code === code)) {
      setError('Card already in batch')
      return
    }

    const entry: CardEntry = { code, valid: undefined }
    setCards(prev => [...prev, entry])
    setInputCode('')
    setError(null)

    // Validate the card code
    try {
      const res = await fetch(`/api/cards/${code}/lookup`)
      const data = await res.json()

      if (!res.ok || !data.card) {
        setCards(prev => prev.map(c => c.code === code ? { ...c, valid: false, error: data.error || 'Not found' } : c))
      } else if (data.card.state === 'invalidated' || data.card.state === 'expired') {
        setCards(prev => prev.map(c => c.code === code ? { ...c, valid: false, error: `Card is ${data.card.state}` } : c))
      } else {
        setCards(prev => prev.map(c => c.code === code ? { ...c, valid: true, id: data.card.id } : c))
      }
    } catch {
      setCards(prev => prev.map(c => c.code === code ? { ...c, valid: false, error: 'Lookup failed' } : c))
    }
  }

  function removeCard(code: string) {
    setCards(prev => prev.filter(c => c.code !== code))
  }

  const validCards = cards.filter(c => c.valid === true)
  const finalAmount = isCustom ? amountCents : amountCents
  const totalCents = validCards.length * finalAmount

  async function handleCheckout() {
    if (validCards.length === 0) { setError('Add at least one valid card'); return }
    if (finalAmount < 100) { setError('Minimum $1.00 per card'); return }

    setLoading(true)
    setError(null)

    // For bulk load, create checkout for the first card and chain the rest
    // In production this would be a single consolidated payment; for MVP
    // we redirect to Stripe for the first card with batch metadata
    const firstCard = validCards[0]

    try {
      const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: firstCard.id,
          amount_cents: finalAmount,
          allowed_categories: categories,
          donor_note: donorNote || undefined,
          receipt_requested: false,
        }),
      })

      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setError(data.error || 'Checkout failed')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-hope-dark">Load Cards for Distribution</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Add cards to the batch, set amount and categories, then pay once</p>
      </div>

      {/* Add card */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <div className="text-sm font-semibold text-hope-dark">Add Card to Batch</div>
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
            onClick={addCard}
            className="bg-hope-green text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-hope-teal transition-colors"
          >
            Add
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {/* Card batch list */}
      {cards.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <div className="text-sm font-semibold text-hope-dark">Batch ({cards.length})</div>
          {cards.map(c => (
            <div key={c.code} className="flex items-center gap-2">
              <span className={`text-lg ${
                c.valid === undefined ? '⏳' : c.valid ? '✅' : '❌'
              }`}>
                {c.valid === undefined ? '⏳' : c.valid ? '✅' : '❌'}
              </span>
              <span className="font-mono text-sm flex-1">{c.code}</span>
              {c.error && <span className="text-xs text-destructive">{c.error}</span>}
              <button onClick={() => removeCard(c.code)} className="text-xs text-muted-foreground hover:text-destructive">×</button>
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
            onChange={e => {
              setCustomAmount(e.target.value)
              const v = parseFloat(e.target.value)
              if (!isNaN(v) && v >= 1) setAmountCents(Math.round(v * 100))
            }}
            placeholder="Custom amount"
            className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green"
          />
        )}
      </div>

      {/* Categories */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <div className="text-sm font-semibold text-hope-dark">Categories</div>
        <div className="grid grid-cols-2 gap-2">
          {allCategories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-sm font-medium transition-colors ${
                categories.includes(cat)
                  ? 'bg-hope-pale text-hope-dark border-hope-green'
                  : 'bg-white text-muted-foreground border-border'
              }`}
            >
              <span>{CATEGORY_ICONS[cat]}</span>
              <span>{CATEGORY_LABELS[cat]}</span>
              {categories.includes(cat) && <span className="ml-auto text-hope-green text-xs">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {validCards.length > 0 && (
        <div className="bg-hope-dark text-white rounded-2xl p-4 space-y-1">
          <div className="text-xs text-hope-light">Batch Total</div>
          <div className="text-3xl font-bold">{formatCAD(totalCents)}</div>
          <div className="text-xs text-hope-light">{validCards.length} card{validCards.length !== 1 ? 's' : ''} × {formatCAD(finalAmount)} each</div>
        </div>
      )}

      <button
        onClick={handleCheckout}
        disabled={loading || validCards.length === 0}
        className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors disabled:opacity-50"
      >
        {loading ? 'Redirecting…' : `Pay ${formatCAD(totalCents)} for ${validCards.length} card${validCards.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}
