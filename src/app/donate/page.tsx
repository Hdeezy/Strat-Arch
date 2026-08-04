'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { validateCardCode, normalizeCardCode, extractCardCodeFromQR } from '@/lib/utils'

export default function DonatePage() {
  const [manualCode, setManualCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrCodeRef = useRef<unknown>(null)

  async function startScanner() {
    setScanning(true)
    setError(null)
    const { Html5Qrcode } = await import('html5-qrcode')
    const scanner = new Html5Qrcode('qr-reader')
    html5QrCodeRef.current = scanner

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          stopScanner()
          handleScannedValue(decodedText)
        },
        undefined
      )
    } catch {
      setError('Camera access denied. Please allow camera access or enter the code manually.')
      setScanning(false)
    }
  }

  async function stopScanner() {
    const scanner = html5QrCodeRef.current as { stop: () => Promise<void> } | null
    if (scanner) {
      try { await scanner.stop() } catch { /* ignore */ }
      html5QrCodeRef.current = null
    }
    setScanning(false)
  }

  async function handleScannedValue(value: string) {
    // Card codes are parsed by the SHARED helper. A private regex here is
    // what quietly broke this scanner when codes went from 4 characters of
    // suffix to 8 — the camera read the card fine and the page said the QR
    // was invalid.
    const fromUrl = extractCardCodeFromQR(value)
    const code = fromUrl ?? normalizeCardCode(value)

    if (validateCardCode(code)) {
      router.push(`/donate/${code}`)
      return
    }

    // A signed token rather than a card URL. There is no route that trades a
    // token for a card here, so say so plainly instead of pushing to
    // /donate/scan-result, which does not exist and 404s.
    if (value.split('.').length === 3) {
      setError('That code is for a shop till, not for giving. Type the card code printed on the card instead.')
      return
    }

    setError('That didn\u2019t scan as a HOPE Card. Try again, or type the code printed on the card.')
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const code = normalizeCardCode(manualCode)
    if (!validateCardCode(code)) {
      setError('That doesn\u2019t look like a card code. It looks like HMLT-3F7K2QX9.')
      return
    }
    setLoading(true)
    router.push(`/donate/${code}`)
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-hope-dark">Fund a HOPE Card</h1>
        <p className="text-sm text-muted-foreground">
          Scan the QR code on a blank card, or enter the code printed on it.
        </p>
      </div>

      {/* QR Scanner */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
        <div className="text-sm font-medium text-hope-dark">Scan Card</div>

        {scanning ? (
          <div className="space-y-3">
            <div id="qr-reader" ref={scannerRef} className="w-full rounded-xl overflow-hidden" />
            <button
              onClick={stopScanner}
              className="w-full text-sm text-muted-foreground hover:text-destructive"
            >
              Cancel scanning
            </button>
          </div>
        ) : (
          <button
            onClick={startScanner}
            className="w-full bg-hope-green text-white rounded-xl py-4 font-semibold text-base hover:bg-hope-teal transition-colors flex items-center justify-center gap-2"
          >
            <span className="text-xl">📷</span>
            Open Camera to Scan
          </button>
        )}
      </div>

      {/* Manual entry */}
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <div className="text-sm font-medium text-hope-dark">Enter Card Code</div>
        <form onSubmit={handleManualSubmit} className="space-y-2">
          <input
            type="text"
            value={manualCode}
            onChange={e => setManualCode(e.target.value.toUpperCase())}
            placeholder="HMLT-0001"
            maxLength={9}
            className="w-full border border-input rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-hope-green"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-hope-pale text-hope-dark rounded-lg py-2.5 font-semibold text-sm hover:bg-hope-light transition-colors disabled:opacity-50"
          >
            {loading ? 'Looking up…' : 'Look Up Card'}
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
