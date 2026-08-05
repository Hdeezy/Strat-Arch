import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const schema = z.object({
  context_note: z.string().max(500).optional(),
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

    // Verify advocate role and get their charity
    const { data: advocate } = await admin
      .from('advocates')
      .select('id, charity_id, full_name')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!advocate) {
      return NextResponse.json({ error: 'Not authorized as advocate' }, { status: 403 })
    }

    // Verify card belongs to this advocate's charity
    const { data: card } = await admin
      .from('cards')
      .select('id, card_code, state, charity_id')
      .eq('id', params.id)
      .single()

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    if (card.charity_id !== advocate.charity_id) {
      return NextResponse.json({ error: 'Card belongs to a different charity' }, { status: 403 })
    }

    if (card.state !== 'active') {
      return NextResponse.json({ error: `Card is ${card.state} — only active cards can be issued` }, { status: 400 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    const context_note = parsed.success ? (parsed.data.context_note || null) : null

    // Log issued event (card stays active — issued is a custody record, not a state change)
    await admin.from('card_events').insert({
      card_id: card.id,
      event_type: 'issued',
      actor_type: 'advocate',
      actor_ref: user.id,
      metadata: {
        advocate_name: advocate.full_name,
        advocate_id: advocate.id,
        context_note,
      },
    })

    return NextResponse.json({ success: true, card_code: card.card_code })
  } catch (err) {
    console.error('Issue card error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
