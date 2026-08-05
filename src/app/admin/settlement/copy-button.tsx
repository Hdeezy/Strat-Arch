'use client'

import * as React from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The only interactive thing on the settlement page.
 *
 * A transfer line is retyped into a bank's interface by a human, and a
 * transposed digit there is a real payment to a real vendor for the wrong
 * amount. Getting the line onto the clipboard exactly is the whole feature.
 */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard is unavailable over plain http and in some locked-down
      // browsers. Say so rather than silently doing nothing — the operator
      // needs to know to select the line by hand.
      window.prompt('Copy this line', text)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex flex-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
        copied
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      )}
      {copied ? 'Copied' : label}
    </button>
  )
}
