import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { attemptRedemption } from '@/lib/redemption'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

const schema = z.object({
  token: z.string().min(1),
  amount_cents: z.number().int().min(1),
  idempotency_key: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params: _params }: { params: { id: string } }
) {
  try {
    // Auth: must be merchant_staff
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: staffRecord } = await admin
      .from('merchant_staff')
      .select('merchant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!staffRecord) {
      return NextResponse.json({ error: 'Not authorized as merchant staff' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { token, amount_cents } = parsed.data
    const idempotency_key = parsed.data.idempotency_key || uuidv4()

    const result = await attemptRedemption({
      token,
      merchant_id: staffRecord.merchant_id,
      amount_cents,
      idempotency_key,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.failure_reason, success: false },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: true,
      redemption_id: result.redemption_id,
      new_balance_cents: result.new_balance_cents,
      donor_note: result.donor_note,
    })
  } catch (err) {
    console.error('Redemption error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
