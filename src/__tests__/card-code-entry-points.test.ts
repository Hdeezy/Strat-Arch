import { validateCardCode, extractCardCodeFromQR, normalizeCardCode } from '@/lib/utils'

describe('card codes accepted across every entry point', () => {
  // The shapes real cards actually have.
  const NEW = 'HMLT-3F7K2QX9'   // 8 chars, what generate_card_code() emits
  const LEGACY = 'HMLT-0001'    // 4 chars, grandfathered pilot stock

  it('accepts a real 8-character code', () => {
    expect(validateCardCode(NEW)).toBe(true)
  })

  it('still accepts a grandfathered 4-character code', () => {
    expect(validateCardCode(LEGACY)).toBe(true)
  })

  it('pulls an 8-char code out of a printed donate QR', () => {
    expect(extractCardCodeFromQR(`https://hope.example/donate/${NEW}`)).toBe(NEW)
  })

  it('pulls a code out of a wallet URL too', () => {
    expect(extractCardCodeFromQR(`https://hope.example/wallet/${NEW}`)).toBe(NEW)
  })

  it('normalises lowercase typing at a counter', () => {
    expect(validateCardCode(normalizeCardCode(' hmlt-3f7k2qx9 '))).toBe(true)
  })

  it('rejects a three-letter prefix', () => {
    expect(validateCardCode('HML-0001')).toBe(false)
  })

  it('rejects a signed token', () => {
    expect(extractCardCodeFromQR('eyJhbG.eyJjYXJk.sig')).toBeNull()
  })
})
