import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Merchant Portal',
}

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/merchant')

  const admin = createAdminClient()
  const { data: staffRecord } = await admin
    .from('merchant_staff')
    .select('merchant_id, merchant:merchants(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!staffRecord) {
    return (
      <div className="min-h-screen bg-hope-pale flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center space-y-3">
          <div className="text-4xl">🏪</div>
          <div className="font-semibold text-hope-dark">Not a registered merchant</div>
          <div className="text-sm text-muted-foreground">Your account is not linked to a merchant. Contact Living Rock Ministries.</div>
          <a href="/" className="block text-sm text-hope-green">← Back to home</a>
        </div>
      </div>
    )
  }

  const merchant = staffRecord.merchant as unknown as { name: string } | null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-hope-dark text-white px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-hope-light">Merchant Portal</div>
            <div className="font-semibold text-sm">{merchant?.name || 'Unknown Merchant'}</div>
          </div>
          <nav className="flex gap-3 text-xs text-hope-light">
            <a href="/merchant" className="hover:text-white">Scan</a>
            <a href="/merchant/history" className="hover:text-white">History</a>
            <a href="/merchant/reconcile" className="hover:text-white">Reconcile</a>
          </nav>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
