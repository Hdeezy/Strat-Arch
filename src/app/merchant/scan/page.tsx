'use client'

import { useState, useCallback } from 'react'
import { formatCAD } from '@/lib/utils'
import { CATEGORY_LABELS, CATEGORY_ICONS, type CardCategory } from '@/lib/types'

type ScanState = 'idle' | 'scanning' | 'validating' | 'charging' | 'success' | 'declined'

interface CardInfo {
  card_id: string
  card_code: string
  balance_cents: number
  allowed_categories: CardCategory[]
  daily_remaining: number
  token: string
}

interface ChargeResult {
  success: boolean
  new_balance_cents?: number
  donor_note?: string
  failure_reason?: string
}

export default function MerchantScanPage() {
  const [state, setState] = useState<ScanState>('idle')
  const [cardInfo, setCardInfo] = useState<CardInfo | null>(null)
  const [chargeResult, setChargeResult] = useState<ChargeResult | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scannerIdRef = { current: 'merchant-qr-reader' }

  const DECLINE_MESSAGES: Record<string, string> = {
    card_not_found: 'Card not found in our system',
    card_not_active: 'Card is not currently active',
    card_expired: 'Card has expired',
    card_invalidated: 'Card has been invalidated',
    card_exhausted: 'Card balance is fully used',
    category_not_allowed: 'This card is not valid at this merchant category',
    daily_cap_reached: 'Daily spending limit reached — try again tomorrow',
    insufficient_balance: 'Insufficient balance on card',
    qr_expired: 'QR code has expired — ask cardholder to refresh',
    qr_invalid: 'QR code is invalid or has been tampered with',
    nonce_replayed: 'QR code has already been used — ask cardholder to refresh',
  }

  async function startScanning() {
    setState('scanning')
    setError(null)
    setCardInfo(null)
    setChargeResult(null)

    const { Html5Qrcode } = await import('html5-qrcode')
    const scanner = new Html5Qrcode(scannerIdRef.current)

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        async (decodedText) => {
          await scanner.stop()
          setState('validating')
          await validateCard(decodedText)
        },
        undefined
      )
    } catch {
      setState('idle')
      setError('Camera access denied. Please allow camera access in your browser settings.')
    }
  }

  async function validateCard(token: string) {
    try {
      const res = await fetch('/api/cards/validate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (!res.ok || !data.valid) {
        setState('declined')
        setChargeResult({ success: false, failure_reason: data.failure_reason || 'qr_invalid' })
        return
      }

      setCardInfo({
        card_id: data.card.id,
        card_code: data.card.card_code,
        balance_cents: data.card.balance_cents,
        allowed_categories: data.card.allowed_categories,
        daily_remaining: data.daily_remaining,
        token,
      })
      setState('charging')
    } catch {
      setState('idle')
      setError('Network error — please try again')
    }
  }

  async function handleCharge() {
    if (!cardInfo) return
    const amountCents = Math.round(parseFloat(amountInput) * 100)

    if (!amountCents || amountCents < 1) {
      setError('Please enter a valid amount')
      return
    }

    if (amountCents > cardInfo.balance_cents) {
      setError(`Amount exceeds card balance (${formatCAD(cardInfo.balance_cents)})`)
      return
    }

    setState('charging')
    setError(null)

    try {
      const res = await fetch(`/api/cards/${cardInfo.card_id}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: cardInfo.token,
          amount_cents: amountCents,
        }),
      })

      const data = await res.json()

      if (data.success) {
        setChargeResult({ success: true, new_balance_cents: data.new_balance_cents, donor_note: data.donor_note })
        setState('success')
      } else {
        setChargeResult({ success: false, failure_reason: data.error })
        setState('declined')
      }
    } catch {
      setError('Network error — please try again')
      setState('charging')
    }
  }

  function reset() {
    setState('idle')
    setCardInfo(null)
    setChargeResult(null)
    setAmountInput('')
    setError(null)
  }

  if (state === 'success' && chargeResult?.success) {
    return (
      <div className="space-y-6 text-center">
        <div className="w-24 h-24 bg-hope-green rounded-full mx-auto flex items-center justify-center">
          <span className="text-5xl text-white">✓</span>
        </div>
        <h1 className="text-2xl font-bold text-hope-dark">Payment Accepted</h1>
        <div className="bg-hope-dark rounded-2xl p-5 text-white text-left space-y-2">
          <div className="text-xs text-hope-light">Card</div>
          <div className="text-xl font-mono font-bold">{cardInfo?.card_code}</div>
          <div className="mt-2 text-xs text-hope-light">Remaining Balance</div>
          <div className="text-2xl font-bold">{formatCAD(chargeResult.new_balance_cents || 0)}</div>
        </div>
        {chargeResult.donor_note && (
          <div className="bg-hope-pale rounded-2xl p-4 text-left">
            <div className="text-xs font-semibold text-hope-dark mb-1">Message from donor</div>
            <div className="text-sm text-hope-dark italic">&ldquo;{chargeResult.donor_note}&rdquo;</div>
          </div>
        )}
        <button
          onClick={reset}
          className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors"
        >
          Scan Next Card
        </button>
      </div>
    )
  }

  if (state === 'declined' && chargeResult) {
    return (
      <div className="space-y-6 text-center">
        <div className="w-24 h-24 bg-red-100 rounded-full mx-auto flex items-center justify-center">
          <span className="text-5xl">✕</span>
        </div>
        <h1 className="text-2xl font-bold text-hope-dark">Card Declined</h1>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-left">
          <div className="font-semibold text-red-800 text-sm">Reason</div>
          <div className="text-sm text-red-700 mt-1">
            {DECLINE_MESSAGES[chargeResult.failure_reason || ''] || chargeResult.failure_reason || 'Unknown error'}
          </div>
        </div>
        <button
          onClick={reset}
          className="w-full bg-hope-dark text-white rounded-xl py-4 font-bold text-base hover:bg-gray-800 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (state === 'charging' && cardInfo) {
    return (
      <div className="space-y-6">
        <div className="bg-hope-dark rounded-2xl p-5 text-white space-y-3">
          <div>
            <div className="text-xs text-hope-light">Card Verified</div>
            <div className="text-xl font-mono font-bold">{cardInfo.card_code}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-hope-light">Balance</div>
              <div className="text-2xl font-bold">{formatCAD(cardInfo.balance_cents)}</div>
            </div>
            <div>
              <div className="text-xs text-hope-light">Daily Remaining</div>
              <div className="text-2xl font-bold">{formatCAD(cardInfo.daily_remaining)}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cardInfo.allowed_categories.map((cat: CardCategory) => (
              <span key={cat} className="bg-white/20 text-white text-xs px-2 py-1 rounded-full">
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <div className="text-sm font-semibold text-hope-dark">Enter Charge Amount</div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-hope-dark">$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={(cardInfo.balance_cents / 100).toFixed(2)}
              value={amountInput}
              onChange={e => setAmountInput(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full border-2 border-input rounded-xl pl-10 pr-4 py-4 text-2xl font-bold focus:outline-none focus:border-hope-green text-hope-dark"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">CAD</span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>
          )}

          <button
            onClick={handleCharge}
            disabled={!amountInput || parseFloat(amountInput) <= 0}
            className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors disabled:opacity-50"
          >
            Charge {amountInput ? formatCAD(Math.round(parseFloat(amountInput) * 100)) : '—'}
          </button>
          <button
            onClick={reset}
            className="w-full text-sm text-muted-foreground hover:text-destructive"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {state === 'validating' && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="text-4xl mb-3 animate-pulse">🔍</div>
          <div className="font-semibold text-hope-dark">Validating card…</div>
        </div>
      )}

      {state !== 'validating' && (
        <>
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-hope-dark">Scan HOPE Card</h1>
            <p className="text-sm text-muted-foreground">Point camera at the QR code on the card</p>
          </div>

          <div id="merchant-qr-reader" className="bg-black rounded-2xl overflow-hidden min-h-[300px]" />

          {state === 'idle' && (
            <button
              onClick={startScanning}
              className="w-full bg-hope-green text-white rounded-2xl py-5 font-bold text-lg hover:bg-hope-teal transition-colors flex items-center justify-center gap-3"
            >
              <span className="text-3xl">📷</span>
              Start Scanning
            </button>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>
          )}
        </>
      )}
    </div>
  )
}
