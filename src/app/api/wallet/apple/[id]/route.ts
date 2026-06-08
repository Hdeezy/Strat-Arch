import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signCardPayload } from '@/lib/qr'
import fs from 'fs'
import path from 'path'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const certPath = process.env.APPLE_WALLET_CERT_PATH
    const certPassword = process.env.APPLE_WALLET_CERT_PASSWORD

    if (!certPath || !certPassword || !fs.existsSync(path.resolve(certPath))) {
      return NextResponse.json(
        { error: 'Apple Wallet certificates not configured — set APPLE_WALLET_CERT_PATH and APPLE_WALLET_CERT_PASSWORD' },
        { status: 503 }
      )
    }

    const admin = createAdminClient()
    const { data: card } = await admin
      .from('cards')
      .select('*, charity:charities(name)')
      .eq('id', params.id)
      .single()

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    const token = await signCardPayload(card.id, card.card_code, card.city_id, card.charity_id)
    const balance = `$${(card.balance_cents / 100).toFixed(2)} CAD`
    const categories = card.allowed_categories.join(', ')

    const { PKPass } = await import('passkit-generator')
    // passkit-generator v3 model type is loosely typed; cast via unknown
    const pass = await PKPass.from(
      {
        model: {
          'pass.json': Buffer.from(JSON.stringify({
            passTypeIdentifier: 'pass.ca.livingrock.hopecard',
            teamIdentifier: 'XXXXXXXXXX',
            organizationName: 'Living Rock Ministries',
            description: 'HOPE Card',
            formatVersion: 1,
            generic: {
              primaryFields: [{ key: 'balance', label: 'Balance', value: balance }],
              secondaryFields: [
                { key: 'categories', label: 'Valid For', value: categories },
                { key: 'card_code', label: 'Card Code', value: card.card_code },
              ],
              auxiliaryFields: [],
              backFields: [
                {
                  key: 'terms',
                  label: 'Terms',
                  value: 'Closed-loop voucher. Redeemable for essentials at participating Hamilton merchants. Cannot be exchanged for cash. Not a payment card.',
                },
              ],
            },
            barcode: { message: token, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
            backgroundColor: 'rgb(45, 106, 79)',
            foregroundColor: 'rgb(255, 255, 255)',
            labelColor: 'rgb(212, 237, 218)',
          })),
        } as unknown as Record<string, Buffer>,
        certificates: {
          wwdr: fs.readFileSync(path.resolve('certs/wwdr.pem')),
          signerCert: fs.readFileSync(path.resolve(certPath)),
          signerKey: { key: fs.readFileSync(path.resolve(certPath)), passphrase: certPassword } as unknown as Buffer,
        },
      } as never,
      { serialNumber: card.id, description: `HOPE Card — ${card.card_code}` }
    )

    const buffer = await pass.getAsBuffer()

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="hope-card-${card.card_code}.pkpass"`,
      },
    })
  } catch (err) {
    console.error('Apple Wallet error:', err)
    return NextResponse.json({ error: 'Failed to generate Apple Wallet pass' }, { status: 500 })
  }
}
