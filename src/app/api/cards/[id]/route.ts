import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const admin = createAdminClient()

    // Fetch card
    const { data: card, error: cardError } = await admin
      .from('cards')
      .select('*')
      .eq('id', params.id)
      .single()

    if (cardError || !card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    // Authorization check: donor can only read cards they funded
    if (user) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (profile?.role === 'donor') {
        const { data: donation } = await admin
          .from('donations')
          .select('id')
          .eq('card_id', params.id)
          .eq('donor_user_id', user.id)
          .single()

        if (!donation) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }
      }
    }

    // Fetch chain of custody
    const [eventsResult, redemptionsResult] = await Promise.all([
      admin
        .from('card_events')
        .select('*')
        .eq('card_id', params.id)
        .order('occurred_at', { ascending: true }),
      admin
        .from('redemptions')
        .select('*, merchant:merchants(id, name, address, category)')
        .eq('card_id', params.id)
        .eq('status', 'succeeded')
        .order('occurred_at', { ascending: true }),
    ])

    return NextResponse.json({
      card,
      events: eventsResult.data || [],
      redemptions: redemptionsResult.data || [],
    })
  } catch (err) {
    console.error('Card detail error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
