/**
 * COUNTER SHELL.
 *
 * A phone or tablet by a till. The person using it is serving a customer, so
 * the scan action has to be reachable in one tap from anywhere, and nothing
 * should require reading.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ScanLine, ReceiptText, Wallet, StoreIcon } from 'lucide-react'
import { MerchantTab } from './tab'

export const metadata: Metadata = { title: 'Accept HOPE Cards' }

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/merchant')

  const admin = createAdminClient()
  const { data: staffRow } = await admin
    .from('merchant_staff')
    .select('merchant_id, merchant:merchants(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  const staff = staffRow as unknown as
    | { merchant_id: string; merchant: { name: string } | { name: string }[] | null }
    | null

  if (!staff) {
    return (
      <main className="min-h-screen bg-hope-dark flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-7 max-w-sm w-full text-center space-y-3">
          <StoreIcon className="mx-auto h-9 w-9 text-slate-400" strokeWidth={1.5} />
          <h1 className="text-lg font-bold text-slate-900">This till isn&apos;t linked to a shop yet</h1>
          <p className="text-base text-slate-600">
            Your account works, but it hasn&apos;t been connected to a vendor. Whoever
            signed your shop up can finish that.
          </p>
          <Link href="/" className="inline-block text-base font-semibold text-hope-green pt-1">
            Back to home
          </Link>
        </div>
      </main>
    )
  }

  const merchant = Array.isArray(staff.merchant) ? staff.merchant[0] : staff.merchant

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-hope-dark text-white px-5 pt-5 pb-4">
        <div className="max-w-lg mx-auto">
          <p className="text-xs uppercase tracking-[0.12em] text-hope-light">Accepting HOPE Cards</p>
          <p className="text-xl font-bold mt-0.5">{merchant?.name ?? 'Your shop'}</p>
        </div>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-5 pb-24">{children}</main>

      <nav
        className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
        aria-label="Sections"
      >
        <div className="max-w-lg mx-auto grid grid-cols-3">
          <MerchantTab href="/merchant" label="Take payment" exact>
            <ScanLine className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </MerchantTab>
          <MerchantTab href="/merchant/history" label="Today">
            <ReceiptText className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </MerchantTab>
          <MerchantTab href="/merchant/reconcile" label="Getting paid">
            <Wallet className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </MerchantTab>
        </div>
      </nav>
    </div>
  )
}
