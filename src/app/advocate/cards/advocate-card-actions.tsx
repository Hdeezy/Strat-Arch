'use client'

import { useState } from 'react'
import type { CardState } from '@/lib/types'

interface Props {
  cardId: string
  cardCode: string
  cardState: CardState
  wasIssued: boolean
}

export default function AdvocateCardActions({ cardId, cardCode, cardState, wasIssued }: Props) {
  const [loading, setLoading] = useState<'issue' | 'invalidate' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleIssue() {
    setLoading('issue')
    try {
      const res = await fetch(`/api/cards/${cardId}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_note: null }),
      })
      if (res.ok) setDone('Marked as issued ✓')
      else setDone('Error — try again')
    } catch {
      setDone('Network error')
    } finally {
      setLoading(null)
    }
  }

  async function handleInvalidate() {
    setLoading('invalidate')
    setShowConfirm(false)
    try {
      const res = await fetch(`/api/cards/${cardId}/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Invalidated by advocate' }),
      })
      if (res.ok) setDone('Card invalidated')
      else setDone('Error — try again')
    } catch {
      setDone('Network error')
    } finally {
      setLoading(null)
    }
  }

  if (done) {
    return <div className="text-xs text-hope-green font-medium">{done}</div>
  }

  if (showConfirm) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
        <div className="text-sm font-semibold text-red-800">Invalidate {cardCode}?</div>
        <div className="text-xs text-red-700">This card will no longer be usable. This action cannot be undone.</div>
        <div className="flex gap-2">
          <button
            onClick={handleInvalidate}
            disabled={loading === 'invalidate'}
            className="flex-1 bg-red-600 text-white rounded-lg py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {loading === 'invalidate' ? 'Invalidating…' : 'Yes, Invalidate'}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            className="flex-1 bg-white border border-border rounded-lg py-1.5 text-xs font-semibold text-hope-dark"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      {cardState === 'active' && !wasIssued && (
        <button
          onClick={handleIssue}
          disabled={loading === 'issue'}
          className="flex-1 bg-hope-green text-white rounded-lg py-1.5 text-xs font-semibold hover:bg-hope-teal transition-colors disabled:opacity-50"
        >
          {loading === 'issue' ? 'Marking…' : 'Mark as Issued'}
        </button>
      )}
      {(cardState === 'active' || cardState === 'unloaded') && (
        <button
          onClick={() => setShowConfirm(true)}
          className="flex-1 bg-white border border-destructive text-destructive rounded-lg py-1.5 text-xs font-semibold hover:bg-red-50 transition-colors"
        >
          Invalidate
        </button>
      )}
    </div>
  )
}
