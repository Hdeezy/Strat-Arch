import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { v4 as uuidv4 } from 'uuid'
import type { QRPayload } from '@/lib/types'

function getSecret(): Uint8Array {
  const secret = process.env.HOPE_QR_SIGNING_SECRET
  if (!secret) throw new Error('HOPE_QR_SIGNING_SECRET is not configured')
  return new TextEncoder().encode(secret)
}

// Generate a short-lived signed JWT for live transaction use (5 min expiry)
export async function signCardPayload(
  card_id: string,
  card_code: string,
  city_id: string,
  charity_id: string
): Promise<string> {
  const nonce = uuidv4()
  const secret = getSecret()

  const token = await new SignJWT({
    card_id,
    card_code,
    city_id,
    charity_id,
    nonce,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret)

  return token
}

// Verify and decode a signed QR payload
export async function verifyCardPayload(token: string): Promise<QRPayload> {
  const secret = getSecret()

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    })

    const p = payload as JWTPayload & Partial<QRPayload>

    if (!p.card_id || !p.card_code || !p.city_id || !p.charity_id || !p.nonce) {
      throw new Error('Invalid QR payload: missing required claims')
    }

    return {
      card_id: p.card_id,
      card_code: p.card_code,
      city_id: p.city_id,
      charity_id: p.charity_id,
      nonce: p.nonce,
      iat: p.iat!,
      exp: p.exp!,
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('JWTExpired')) {
      throw new Error('QR code has expired — please refresh')
    }
    throw new Error('Invalid or tampered QR code')
  }
}

// Generate a QR code data URL from a string (for display in browser)
// This is called client-side; the signed JWT is fetched from the server first
export async function generateQRDataURL(content: string): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(content, {
    width: 300,
    margin: 2,
    color: { dark: '#1B4332', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  })
}

// Generate QR as SVG string (for PDF print sheets)
export async function generateQRSVG(content: string): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toString(content, {
    type: 'svg',
    margin: 2,
    color: { dark: '#1B4332', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  })
}
