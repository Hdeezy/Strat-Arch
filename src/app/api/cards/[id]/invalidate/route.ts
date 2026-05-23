import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const schema = z.object({
  reason: z.string().max(500).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Check role
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const allowedRoles = ['advocate', 'charity_admin', 'super_admin']
    if (!profile || !allowedRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // For advocates, check charity scoping
    if (profile.role === 'advocate') {
      const { data: advocate } = await admin
        .from('advocates')
        .select('charity_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single()

      const { data: card } = await admin
        .from('cards')
        .select('charity_id, state')
        .eq('id', params.id)
        .single()

      if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
      if (advocate?.charity_id !== card.charity_id) {
        return NextResponse.json({ error: 'Card belongs to a different charity' }, { status: 403 })
      }
      if (card.state === 'invalidated') {
        return NextResponse.json({ error: 'Card is already invalidated' }, { status: 400 })
      }
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    const reason = parsed.success ? (parsed.data.reason || 'No reason provided') : 'No reason provided'

    const { error: updateError } = await admin
      .from('cards')
      .update({ state: 'invalidated' })
      .eq('id', params.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to invalidate card' }, { status: 500 })
    }

    await admin.from('card_events').insert({
      card_id: params.id,
      event_type: 'invalidated',
      actor_type: profile.role === 'super_admin' ? 'admin' : profile.role as 'advocate',
      actor_ref: user.id,
      metadata: { reason },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Invalidate card error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
