'use client'

import { useState } from 'react'
import { AMOUNT_PRESETS, type CardCategory, CATEGORY_LABELS, CATEGORY_ICONS } from '@/lib/types'
import { formatCAD } from '@/lib/utils'

const DEFAULT_CATEGORIES: CardCategory[] = ['food', 'transit', 'clothing', 'hygiene']

interface Props {
  cardId: string
  cardCode: string
  currentBalance: number
}

export default function DonateForm({ cardId, cardCode, currentBalance }: Props) {
  const [amountCents, setAmountCents] = useState<number>(1000)
  const [customAmount, setCustomAmount] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [categories, setCategories] = useState<CardCategory[]>(DEFAULT_CATEGORIES)
  const [donorNote, setDonorNote] = useState('')
  const [receiptRequested, setReceiptRequested] = useState(false)
  const [donorEmail, setDonorEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allCategories: CardCategory[] = ['food', 'transit', 'clothing', 'hygiene']

  function toggleCategory(cat: CardCategory) {
    setCategories(prev =>
      prev.includes(cat)
        ? prev.length > 1 ? prev.filter(c => c !== cat) : prev
        : [...prev, cat]
    )
  }

  function handlePresetClick(cents: number) {
    setAmountCents(cents)
    setIsCustom(false)
    setCustomAmount('')
  }

  function handleCustomAmount(value: string) {
    setCustomAmount(value)
    setIsCustom(true)
    const parsed = parseFloat(value)
    if (!isNaN(parsed) && parsed >= 1) {
      setAmountCents(Math.round(parsed * 100))
    }
  }

  const finalAmount = isCustom ? amountCents : amountCents

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (finalAmount < 100) {
      setError('Minimum donation is $1.00')
      return
    }

    if (receiptRequested && !donorEmail) {
      setError('Please enter your email to receive a tax receipt')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: cardId,
          amount_cents: finalAmount,
          allowed_categories: categories,
          donor_note: donorNote || undefined,
          receipt_requested: receiptRequested,
          donor_email: receiptRequested ? donorEmail : undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Amount */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <div className="text-sm font-semibold text-hope-dark">Choose Amount</div>
        {currentBalance > 0 && (
          <div className="text-xs text-muted-foreground">
            Current balance: {formatCAD(currentBalance)} — your donation will add to this
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {AMOUNT_PRESETS.map(cents => (
            <button
              key={cents}
              type="button"
              onClick={() => handlePresetClick(cents)}
              className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
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
            onClick={() => { setIsCustom(true); setAmountCents(0) }}
            className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors col-span-${AMOUNT_PRESETS.length % 2 === 0 ? '1' : '3'} ${
              isCustom
                ? 'bg-hope-green text-white border-hope-green'
                : 'bg-white text-hope-dark border-border hover:border-hope-green'
            }`}
          >
            Custom
          </button>
        </div>

        {isCustom && (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={customAmount}
              onChange={e => handleCustomAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border border-input rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">CAD</span>
          </div>
        )}
      </div>

      {/* Categories */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <div>
          <div className="text-sm font-semibold text-hope-dark">Fund These Categories</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            The card can only be used at merchants in these categories
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {allCategories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-colors ${
                categories.includes(cat)
                  ? 'bg-hope-pale text-hope-dark border-hope-green'
                  : 'bg-white text-muted-foreground border-border'
              }`}
            >
              <span>{CATEGORY_ICONS[cat]}</span>
              <span>{CATEGORY_LABELS[cat]}</span>
              {categories.includes(cat) && <span className="ml-auto text-hope-green">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Donor note */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-2">
        <div className="text-sm font-semibold text-hope-dark">Add a Message (optional)</div>
        <textarea
          value={donorNote}
          onChange={e => setDonorNote(e.target.value.slice(0, 140))}
          placeholder="A short note of encouragement…"
          rows={2}
          className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green resize-none"
        />
        <div className="text-xs text-muted-foreground text-right">{donorNote.length}/140</div>
      </div>

      {/* Receipt */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-hope-dark">Tax Receipt</div>
            <div className="text-xs text-muted-foreground">Canada Revenue Agency receipt</div>
          </div>
          <button
            type="button"
            onClick={() => setReceiptRequested(!receiptRequested)}
            className={`w-12 h-6 rounded-full transition-colors ${
              receiptRequested ? 'bg-hope-green' : 'bg-gray-200'
            } relative`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform absolute top-0.5 ${
              receiptRequested ? 'translate-x-6' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
        {receiptRequested && (
          <input
            type="email"
            required={receiptRequested}
            value={donorEmail}
            onChange={e => setDonorEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hope-green"
          />
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || (isCustom && finalAmount < 100)}
        className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Redirecting to payment…' : `Donate ${finalAmount >= 100 ? formatCAD(finalAmount) : '—'} to ${cardCode}`}
      </button>

      <p className="text-xs text-center text-muted-foreground">
        Powered by Stripe · Secured by Living Rock Ministries<br />
        Funds go directly to the card — no overhead, no cash conversion
      </p>
    </form>
  )
}
