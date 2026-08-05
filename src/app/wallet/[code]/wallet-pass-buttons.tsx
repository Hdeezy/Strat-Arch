'use client'

import { useState } from 'react'

export default function WalletPassButtons({ cardId }: { cardId: string }) {
  const [appleLoading, setAppleLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

  async function addToApple() {
    setAppleLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wallet/apple/${cardId}`)
      if (res.status === 503) {
        setError('Apple Wallet not configured on this server')
        return
      }
      if (!res.ok) {
        setError('Failed to generate Apple Wallet pass')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.location.href = url
    } catch {
      setError('Network error')
    } finally {
      setAppleLoading(false)
    }
  }

  async function addToGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wallet/google/${cardId}`)
      const data = await res.json()
      if (res.status === 503) {
        setError('Google Wallet not configured on this server')
        return
      }
      if (!res.ok || !data.url) {
        setError('Failed to generate Google Wallet pass')
        return
      }
      window.location.href = data.url
    } catch {
      setError('Network error')
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      {(isIOS || !isAndroid) && (
        <button
          onClick={addToApple}
          disabled={appleLoading}
          className="w-full bg-black text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-gray-900 transition-colors disabled:opacity-50"
        >
          <span className="text-lg"></span>
          {appleLoading ? 'Generating…' : 'Add to Apple Wallet'}
        </button>
      )}
      {(isAndroid || !isIOS) && (
        <button
          onClick={addToGoogle}
          disabled={googleLoading}
          className="w-full bg-white text-gray-800 border border-gray-200 rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <span className="text-lg">G</span>
          {googleLoading ? 'Generating…' : 'Add to Google Wallet'}
        </button>
      )}
      {error && <p className="text-xs text-red-300 text-center">{error}</p>}
    </div>
  )
}
