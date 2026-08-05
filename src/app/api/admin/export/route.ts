import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateHamilton } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('user_id', user.id).single()

    if (!profile || !['charity_admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const url = new URL(req.url)
    const type = url.searchParams.get('type') || 'redemptions'
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    let csv = ''

    if (type === 'redemptions') {
      let query = admin
        .from('redemptions')
        .select('*, card:cards(card_code, charity_id), merchant:merchants(name, category)')
        .eq('status', 'succeeded')
        .order('occurred_at', { ascending: true })

      if (from) query = query.gte('occurred_at', from)
      if (to) query = query.lte('occurred_at', to)

      const { data: redemptions } = await query

      csv = 'Date,Card Code,Merchant,Category,Amount (CAD)\n'
      for (const r of redemptions || []) {
        const amount = (r.amount_cents / 100).toFixed(2)
        const date = formatDateHamilton(r.occurred_at)
        const card = r.card as { card_code: string } | null
        const merchant = r.merchant as { name: string; category: string } | null
        csv += `"${date}","${card?.card_code || ''}","${merchant?.name || ''}","${merchant?.category || ''}","${amount}"\n`
      }
    } else if (type === 'donations') {
      let query = admin
        .from('donations')
        .select('*, card:cards(card_code)')
        .order('created_at', { ascending: true })

      if (from) query = query.gte('created_at', from)
      if (to) query = query.lte('created_at', to)

      const { data: donations } = await query

      csv = 'Date,Card Code,Amount (CAD),Receipt Requested,Note\n'
      for (const d of donations || []) {
        const amount = (d.amount_cents / 100).toFixed(2)
        const date = formatDateHamilton(d.created_at)
        const card = d.card as { card_code: string } | null
        csv += `"${date}","${card?.card_code || ''}","${amount}","${d.receipt_requested}","${d.donor_note || ''}"\n`
      }
    }

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="hope-card-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (err) {
    console.error('Export error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
