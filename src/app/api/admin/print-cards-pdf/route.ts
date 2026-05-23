import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateQRSVG } from '@/lib/qr'

export const runtime = 'nodejs'

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

    const { data: cards } = await admin
      .from('cards')
      .select('id, card_code, city_id, charity_id')
      .eq('state', 'unloaded')
      .order('card_code', { ascending: true })
      .limit(100)

    if (!cards || cards.length === 0) {
      return NextResponse.json({ error: 'No unloaded cards to print' }, { status: 404 })
    }

    const { renderToBuffer, Document, Page, View, Text, Svg, Path, Image } = await import('@react-pdf/renderer')
    const { StyleSheet } = await import('@react-pdf/renderer')
    const QRCode = (await import('qrcode')).default

    const styles = StyleSheet.create({
      page: { flexDirection: 'row', flexWrap: 'wrap', padding: 20, backgroundColor: '#ffffff' },
      card: {
        width: '252pt',
        height: '144pt',
        margin: 5,
        backgroundColor: '#1B4332',
        borderRadius: 8,
        padding: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
      },
      cardLeft: { flex: 1, justifyContent: 'space-between' },
      cardRight: { width: 100, alignItems: 'center', justifyContent: 'center' },
      logo: { fontSize: 16, color: '#74C69D', fontFamily: 'Helvetica-Bold' },
      wordmark: { fontSize: 8, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', marginTop: 4 },
      subtext: { fontSize: 6, color: '#74C69D' },
      code: { fontSize: 10, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', marginTop: 4 },
      backText: { fontSize: 5, color: '#74C69D', marginTop: 2 },
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const cardComponents = await Promise.all(
      cards.map(async (card) => {
        const url = `${appUrl}/donate/${card.card_code}`
        const qrDataUrl = await QRCode.toDataURL(url, {
          width: 90,
          margin: 1,
          color: { dark: '#1B4332', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        })

        return { card, qrDataUrl }
      })
    )

    const doc = Document({
      children: [
        Page({
          size: [612, 792],
          style: styles.page,
          children: cardComponents.map(({ card, qrDataUrl }) =>
            View({
              style: styles.card,
              children: [
                View({
                  style: styles.cardLeft,
                  children: [
                    View({
                      children: [
                        Text({ style: styles.logo, children: ['🌿'] }),
                        Text({ style: styles.wordmark, children: ['HOPE Card — Hamilton'] }),
                        Text({ style: styles.subtext, children: ['Closed-loop essentials voucher'] }),
                      ],
                    }),
                    View({
                      children: [
                        Text({ style: styles.code, children: [card.card_code] }),
                        Text({ style: styles.backText, children: ['Cannot be exchanged for cash'] }),
                      ],
                    }),
                  ],
                }),
                View({
                  style: styles.cardRight,
                  children: [
                    Image({ src: qrDataUrl, style: { width: 90, height: 90 } }),
                  ],
                }),
              ],
            })
          ),
        }),
      ],
    })

    const buffer = await renderToBuffer(doc)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="hope-cards-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    })
  } catch (err) {
    console.error('Print cards PDF error:', err)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
