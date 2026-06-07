import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeFlags } from '@/lib/admin-flags'

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('user_id', user.id).single()

    if (!profile || !['charity_admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // Charity admins only see flags for their own charity
    let charityId: string | undefined
    if (profile.role === 'charity_admin') {
      const { data: advocate } = await admin
        .from('advocates')
        .select('charity_id')
        .eq('user_id', user.id)
        .single()
      charityId = advocate?.charity_id
    }

    const flags = await computeFlags(charityId)
    return NextResponse.json({ flags })
  } catch (err) {
    console.error('Flags error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
