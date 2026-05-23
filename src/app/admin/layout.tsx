import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Admin Dashboard' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/admin')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['charity_admin', 'super_admin'].includes(profile.role)) {
    return (
      <div className="min-h-screen bg-hope-pale flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center space-y-3">
          <div className="text-4xl">🔒</div>
          <div className="font-semibold text-hope-dark">Access Denied</div>
          <div className="text-sm text-muted-foreground">Admin access required.</div>
          <a href="/" className="block text-sm text-hope-green">← Back to home</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-hope-dark text-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-hope-light">Admin</div>
            <div className="font-semibold">HOPE Card Dashboard</div>
          </div>
          <nav className="flex gap-4 text-xs text-hope-light">
            <a href="/admin" className="hover:text-white">Overview</a>
            <a href="/admin/cards" className="hover:text-white">Cards</a>
            <a href="/admin/donations" className="hover:text-white">Donations</a>
            <a href="/admin/redemptions" className="hover:text-white">Redemptions</a>
            <a href="/admin/advocates" className="hover:text-white">Advocates</a>
            <a href="/admin/merchants" className="hover:text-white">Merchants</a>
            <a href="/admin/print-cards" className="hover:text-white">Print Cards</a>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
