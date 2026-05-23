import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const schema = z.object({
  amount_cents: z.number().int().min(1).max(100000),
  reason: z.string().max(200).optional().default('Earn-back credit'),
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

    // Only advocates and charity admins can credit cards
    const { data: advocate } = await admin
      .from('advocates')
      .select('id, charity_id, full_name')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!advocate) {
      const { data: profile } = await admin.from('profiles').select('role').eq('user_id', user.id).single()
      if (!profile || !['charity_admin', 'super_admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
      }
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { amount_cents, reason } = parsed.data

    // Fetch card
    const { data: card } = await admin
      .from('cards')
      .select('id, balance_cents, state, charity_id')
      .eq('id', params.id)
      .single()

    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    // Charity scoping for advocates
    if (advocate && card.charity_id !== advocate.charity_id) {
      return NextResponse.json({ error: 'Card belongs to a different charity' }, { status: 403 })
    }

    if (card.state === 'invalidated' || card.state === 'expired') {
      return NextResponse.json({ error: `Cannot credit a ${card.state} card` }, { status: 400 })
    }

    const newBalance = card.balance_cents + amount_cents
    const newState = card.state === 'unloaded' || card.state === 'exhausted' ? 'active' : card.state

    await admin.from('cards').update({ balance_cents: newBalance, state: newState }).eq('id', card.id)

    await admin.from('card_events').insert({
      card_id: card.id,
      event_type: 'loaded',
      actor_type: 'advocate',
      actor_ref: user.id,
      metadata: {
        amount_cents,
        reason,
        earn_back: true,
        advocate_name: advocate?.full_name || 'admin',
      },
    })

    return NextResponse.json({ success: true, new_balance_cents: newBalance })
  } catch (err) {
    console.error('Credit card error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
