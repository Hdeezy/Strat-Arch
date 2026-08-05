'use client'

/**
 * VENDOR REDEMPTION — two phases, one screen.
 *
 * Scan or type the code, which AUTHORIZES the room available. Ring the sale,
 * which CAPTURES what was actually spent. The remainder returns to the card
 * in the same ledger transaction.
 *
 * Language rule, Scrappy Cut §4: this UI shows available room and never
 * declines for insufficient funds. "Room today: $18" is a statement about
 * the card. "Insufficient funds" is a statement about the person, said out
 * loud, at a counter, in a queue. Same number. Only one of them is something
 * you would want said about you.
 */

import { useState } from 'react'
import { formatCAD } from '@/lib/utils'
import { CATEGORY_LABELS, CATEGORY_ICONS, type CardCategory } from '@/lib/types'

type ScanState = 'idle' | 'scanning' | 'authorizing' | 'charging' | 'success' | 'declined'

interface Authorization {
  authorization_id: string
  card_code: string
  room_cents: number
  allowed_categories: CardCategory[]
}

interface Capture {
  captured_cents: number
  returned_cents: number
  new_balance_cents: number
}

/**
 * Every one of these is about the CARD, not the person holding it. There is
 * no message here that a member would be ashamed to have read aloud.
 */
const DECLINE_MESSAGES: Record<string, string> = {
  not_found: 'This card is not in our system',
  malformed: 'That code was not readable — try typing it',
  invalidated: 'This card has been replaced. The cardholder can call for the new one.',
  expired: 'This card has reached its end date',
  card_unloaded: 'This card has not been activated yet',
  card_exhausted: 'This card has been fully used',
  category_not_allowed: 'This card is not set up for what this shop sells',
  no_room_today: 'No room left on this card today — it resets at midnight',
  signature_invalid: 'That code could not be verified — try typing it instead',
  merchant_not_found: 'This terminal is not linked to a shop yet',
}

export default function MerchantScanPage() {
  const [state, setState] = useState<ScanState>('idle')
  const [auth, setAuth] = useState<Authorization | null>(null)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [declineReason, setDeclineReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manualCode, setManualCode] = useState('')

  async function startScanning() {
    setState('scanning')
    setError(null)

    const { Html5Qrcode } = await import('html5-qrcode')
    const scanner = new Html5Qrcode('merchant-qr-reader')

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        async decodedText => {
          await scanner.stop()
          await authorize(decodedText)
        },
        undefined
      )
    } catch {
      setState('idle')
      setError('Camera access denied. Allow camera access, or type the code below.')
    }
  }

  /** Phase one. Reserves the room on the card; owes the vendor nothing yet. */
  async function authorize(credential: string) {
    setState('authorizing')
    setError(null)
    setDeclineReason(null)

    try {
      const res = await fetch('/api/redemption/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      const data = await res.json()

      if (!res.ok) {
        setState('idle')
        setError(data.error ?? 'Something went wrong — try again')
        return
      }

      if (!data.authorized) {
        setDeclineReason(data.reason)
        setState('declined')
        return
      }

      setAuth({
        authorization_id: data.authorization_id,
        card_code: data.card_code,
        room_cents: data.room_cents,
        allowed_categories: data.allowed_categories ?? [],
      })
      setState('charging')
    } catch {
      setState('idle')
      setError('No connection — check signal and try again')
    }
  }

  /** Phase two. Captures what was rung; the rest goes back to the card. */
  async function charge() {
    if (!auth) return
    const amountCents = Math.round(parseFloat(amountInput) * 100)

    if (!amountCents || amountCents < 1) {
      setError('Enter an amount')
      return
    }
    if (amountCents > auth.room_cents) {
      setError(`Room today is ${formatCAD(auth.room_cents)}`)
      return
    }

    setError(null)
    try {
      const res = await fetch('/api/redemption/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorization_id: auth.authorization_id, amount_cents: amountCents }),
      })
      const data = await res.json()

      if (data.captured) {
        setCapture({
          captured_cents: data.captured_cents,
          returned_cents: data.returned_cents ?? 0,
          new_balance_cents: data.new_balance_cents,
        })
        setState('success')
      } else {
        setDeclineReason(data.reason)
        setState('declined')
      }
    } catch {
      setError('No connection — the sale has not gone through. Try again.')
    }
  }

  /** Release the hold so the member is not left short while they walk away. */
  async function cancel() {
    if (auth) {
      await fetch('/api/redemption/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorization_id: auth.authorization_id, reason: 'Cancelled at the counter' }),
      }).catch(() => {
        // The expiry cron reaps it within 15 minutes regardless.
      })
    }
    reset()
  }

  function reset() {
    setState('idle')
    setAuth(null)
    setCapture(null)
    setAmountInput('')
    setError(null)
    setDeclineReason(null)
    setManualCode('')
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (state === 'success' && capture) {
    return (
      <div className="space-y-6 text-center">
        <div className="w-24 h-24 bg-hope-green rounded-full mx-auto flex items-center justify-center">
          <span className="text-5xl text-white" aria-hidden="true">✓</span>
        </div>
        <h1 className="text-2xl font-bold text-hope-dark">Paid — {formatCAD(capture.captured_cents)}</h1>

        <div className="bg-hope-dark rounded-2xl p-5 text-white text-left space-y-3">
          <div>
            <div className="text-xs text-hope-light">Card</div>
            <div className="text-xl font-mono font-bold">{auth?.card_code}</div>
          </div>
          <div>
            <div className="text-xs text-hope-light">Left on the card</div>
            <div className="text-3xl font-bold">{formatCAD(capture.new_balance_cents)}</div>
          </div>
          {capture.returned_cents > 0 && (
            <div className="text-xs text-hope-light border-t border-white/20 pt-2">
              {formatCAD(capture.returned_cents)} of the hold went straight back to the card.
            </div>
          )}
        </div>

        <button
          onClick={reset}
          className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors"
        >
          Next card
        </button>
      </div>
    )
  }

  // ── Declined ─────────────────────────────────────────────────────────────
  if (state === 'declined') {
    return (
      <div className="space-y-6 text-center">
        <div className="w-24 h-24 bg-amber-100 rounded-full mx-auto flex items-center justify-center">
          <span className="text-5xl" aria-hidden="true">↺</span>
        </div>
        <h1 className="text-2xl font-bold text-hope-dark">Can&apos;t use this card here</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left">
          <p className="text-base text-amber-900">
            {DECLINE_MESSAGES[declineReason ?? ''] ?? 'Something went wrong with this card'}
          </p>
        </div>
        <button
          onClick={reset}
          className="w-full bg-hope-dark text-white rounded-xl py-4 font-bold text-base hover:bg-gray-800 transition-colors"
        >
          Try another card
        </button>
      </div>
    )
  }

  // ── Charging: authorization is open, vendor enters the actual amount ─────
  if (state === 'charging' && auth) {
    const entered = parseFloat(amountInput)
    const overRoom = !isNaN(entered) && Math.round(entered * 100) > auth.room_cents

    return (
      <div className="space-y-6">
        <div className="bg-hope-dark rounded-2xl p-5 text-white space-y-3">
          <div>
            <div className="text-xs text-hope-light">Card verified</div>
            <div className="text-xl font-mono font-bold">{auth.card_code}</div>
          </div>
          <div>
            <div className="text-xs text-hope-light">Room today</div>
            <div className="text-4xl font-bold">{formatCAD(auth.room_cents)}</div>
          </div>
          {auth.allowed_categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {auth.allowed_categories.map(cat => (
                <span key={cat} className="bg-white/20 text-white text-xs px-2 py-1 rounded-full">
                  {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <label htmlFor="charge-amount" className="block text-sm font-semibold text-hope-dark">
            How much is the sale?
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-hope-dark">$</span>
            <input
              id="charge-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max={(auth.room_cents / 100).toFixed(2)}
              value={amountInput}
              onChange={e => setAmountInput(e.target.value)}
              placeholder="0.00"
              autoFocus
              aria-describedby="room-hint"
              className="w-full border-2 border-input rounded-xl pl-10 pr-4 py-4 text-2xl font-bold focus:outline-none focus:border-hope-green text-hope-dark"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">CAD</span>
          </div>
          <p id="room-hint" className="text-sm text-muted-foreground">
            Up to {formatCAD(auth.room_cents)} today. Anything not spent goes straight back on the card.
          </p>

          {(error || overRoom) && (
            <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
              {overRoom ? `Room today is ${formatCAD(auth.room_cents)}` : error}
            </div>
          )}

          <button
            onClick={charge}
            disabled={!amountInput || entered <= 0 || overRoom}
            className="w-full bg-hope-green text-white rounded-xl py-4 font-bold text-base hover:bg-hope-teal transition-colors disabled:opacity-50"
          >
            Take {amountInput && !overRoom ? formatCAD(Math.round(entered * 100)) : '—'}
          </button>
          <button onClick={cancel} className="w-full text-sm text-muted-foreground hover:text-destructive py-2">
            Cancel and release the hold
          </button>
        </div>
      </div>
    )
  }

  // ── Idle / scanning / authorizing ────────────────────────────────────────
  return (
    <div className="space-y-6">
      {state === 'authorizing' && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center" role="status" aria-live="polite">
          <div className="text-4xl mb-3 animate-pulse" aria-hidden="true">🔍</div>
          <div className="font-semibold text-hope-dark">Checking the card…</div>
        </div>
      )}

      {state !== 'authorizing' && (
        <>
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-hope-dark">Take a HOPE Card</h1>
            <p className="text-sm text-muted-foreground">Point the camera at the code on the card</p>
          </div>

          <div id="merchant-qr-reader" className="bg-black rounded-2xl overflow-hidden min-h-[300px]" />

          {state === 'idle' && (
            <>
              <button
                onClick={startScanning}
                className="w-full bg-hope-green text-white rounded-2xl py-5 font-bold text-lg hover:bg-hope-teal transition-colors flex items-center justify-center gap-3"
              >
                <span className="text-3xl" aria-hidden="true">📷</span>
                Start scanning
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs text-muted-foreground">
                  <span className="bg-gray-50 px-2">or type the code</span>
                </div>
              </div>

              <div className="flex gap-2">
                <label htmlFor="manual-code" className="sr-only">Card code</label>
                <input
                  id="manual-code"
                  type="text"
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value.toUpperCase())}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && manualCode) authorize(manualCode)
                  }}
                  placeholder="HMLT-3F7K2QX9"
                  maxLength={17}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 border border-input rounded-xl px-4 py-3 text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-hope-green"
                />
                <button
                  onClick={() => authorize(manualCode)}
                  disabled={!/^[A-Z]{4}-[A-Z0-9]{4,10}$/.test(manualCode)}
                  className="bg-hope-green text-white px-5 rounded-xl font-semibold hover:bg-hope-teal transition-colors disabled:opacity-50"
                >
                  Check
                </button>
              </div>
            </>
          )}

          {error && (
            <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  )
}
