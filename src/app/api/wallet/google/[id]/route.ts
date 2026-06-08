import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signCardPayload } from '@/lib/qr'
import { SignJWT, importPKCS8, type JWTPayload } from 'jose'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID
    const serviceAccountKeyStr = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_KEY

    if (!issuerId || !serviceAccountKeyStr) {
      return NextResponse.json(
        { error: 'Google Wallet not configured — set GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SERVICE_ACCOUNT_KEY' },
        { status: 503 }
      )
    }

    const admin = createAdminClient()
    const { data: card } = await admin
      .from('cards')
      .select('*')
      .eq('id', params.id)
      .single()

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    const token = await signCardPayload(card.id, card.card_code, card.city_id, card.charity_id)
    const serviceAccount = JSON.parse(serviceAccountKeyStr)
    const classId = `${issuerId}.hope_card`
    const objectId = `${issuerId}.${card.id}`

    const genericObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      cardTitle: { defaultValue: { language: 'en', value: 'HOPE Card' } },
      subheader: { defaultValue: { language: 'en', value: 'Closed-Loop Voucher' } },
      header: { defaultValue: { language: 'en', value: card.card_code } },
      textModulesData: [
        { id: 'balance', header: 'Balance', body: `$${(card.balance_cents / 100).toFixed(2)} CAD` },
        { id: 'categories', header: 'Valid For', body: card.allowed_categories.join(', ') },
      ],
      barcode: { type: 'QR_CODE', value: token },
      hexBackgroundColor: '#2D6A4F',
    }

    const privateKey = serviceAccount.private_key as string
    const privateKeyObj = await importPKCS8(privateKey, 'RS256')

    const payload = {
      iss: serviceAccount.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        genericObjects: [genericObject],
      },
    }

    const jwt = await new SignJWT(payload as JWTPayload)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKeyObj)

    const saveUrl = `https://pay.google.com/gp/v/save/${jwt}`
    return NextResponse.json({ url: saveUrl })
  } catch (err) {
    console.error('Google Wallet error:', err)
    return NextResponse.json({ error: 'Failed to generate Google Wallet pass' }, { status: 500 })
  }
}
