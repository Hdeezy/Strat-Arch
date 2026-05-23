import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD } from '@/lib/utils'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdvocatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/advocate')

  const admin = createAdminClient()
  const { data: advocate } = await admin
    .from('advocates')
    .select('id, charity_id, full_name')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!advocate) redirect('/auth/login')

  const { data: cards } = await admin
    .from('cards')
    .select('id, state, balance_cents')
    .eq('charity_id', advocate.charity_id)

  const stats = {
    active: cards?.filter(c => c.state === 'active').length || 0,
    unloaded: cards?.filter(c => c.state === 'unloaded').length || 0,
    exhausted: cards?.filter(c => c.state === 'exhausted').length || 0,
    totalLoaded: cards?.filter(c => c.state === 'active').reduce((s, c) => s + c.balance_cents, 0) || 0,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-hope-dark">Welcome back, {advocate.full_name.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">Outreach toolkit</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-hope-dark text-white rounded-2xl p-4">
          <div className="text-xs text-hope-light">Active Cards</div>
          <div className="text-3xl font-bold">{stats.active}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs text-muted-foreground">Total Value Active</div>
          <div className="text-2xl font-bold text-hope-dark">{formatCAD(stats.totalLoaded)}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs text-muted-foreground">Unloaded Cards</div>
          <div className="text-2xl font-bold text-hope-dark">{stats.unloaded}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs text-muted-foreground">Fully Used</div>
          <div className="text-2xl font-bold text-hope-dark">{stats.exhausted}</div>
        </div>
      </div>

      <div className="space-y-3">
        <Link href="/advocate/bulk-load" className="block w-full bg-hope-green hover:bg-hope-teal text-white rounded-2xl p-4 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💳</span>
            <div>
              <div className="font-semibold">Load Cards for Distribution</div>
              <div className="text-xs text-hope-light">Fund multiple cards before hitting the streets</div>
            </div>
            <span className="ml-auto">→</span>
          </div>
        </Link>

        <Link href="/advocate/cards" className="block w-full bg-white hover:bg-hope-pale rounded-2xl p-4 shadow-sm transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📋</span>
            <div>
              <div className="font-semibold text-hope-dark">Manage Distributed Cards</div>
              <div className="text-xs text-muted-foreground">Mark as issued, view status, invalidate</div>
            </div>
            <span className="ml-auto text-hope-green">→</span>
          </div>
        </Link>
      </div>
    </div>
  )
}
