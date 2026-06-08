import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Advocate Portal' }

export default async function AdvocateLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?redirectTo=/advocate')

  const admin = createAdminClient()
  const { data: advocate } = await admin
    .from('advocates')
    .select('full_name, charity:charities(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!advocate) {
    return (
      <div className="min-h-screen bg-hope-pale flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center space-y-3">
          <div className="text-4xl">🤝</div>
          <div className="font-semibold text-hope-dark">Not registered as an advocate</div>
          <div className="text-sm text-muted-foreground">Contact Living Rock Ministries to get access.</div>
          <a href="/" className="block text-sm text-hope-green">← Back to home</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-hope-dark text-white px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-hope-light">Advocate Portal</div>
            <div className="font-semibold text-sm">{advocate.full_name}</div>
          </div>
          <nav className="flex gap-3 text-xs text-hope-light">
            <a href="/advocate" className="hover:text-white">Home</a>
            <a href="/advocate/bulk-load" className="hover:text-white">Load Cards</a>
            <a href="/advocate/cards" className="hover:text-white">My Cards</a>
          </nav>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
