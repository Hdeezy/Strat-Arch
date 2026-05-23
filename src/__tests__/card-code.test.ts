import { validateCardCode, normalizeCardCode } from '@/lib/utils'

describe('Card code validation', () => {
  it('accepts valid HOPE Card format XXXX-XXXX', () => {
    expect(validateCardCode('HMLT-0001')).toBe(true)
    expect(validateCardCode('HMLT-A4F2')).toBe(true)
    expect(validateCardCode('HOPE-1234')).toBe(true)
    expect(validateCardCode('ABCD-EFGH')).toBe(true)
    expect(validateCardCode('HMLT-0050')).toBe(true)
  })

  it('rejects invalid formats', () => {
    expect(validateCardCode('HMLT0001')).toBe(false)   // Missing dash
    expect(validateCardCode('HML-0001')).toBe(false)   // Three-letter prefix
    expect(validateCardCode('HMLT-001')).toBe(false)   // Three-char suffix
    expect(validateCardCode('hmlt-0001')).toBe(false)  // Lowercase (validate expects uppercase)
    expect(validateCardCode('')).toBe(false)
    expect(validateCardCode('HMLT-000G-X')).toBe(false) // Too long
    expect(validateCardCode('1234-5678')).toBe(false)  // Numeric prefix
  })

  it('normalizes card codes to uppercase and trimmed', () => {
    expect(normalizeCardCode('hmlt-0001')).toBe('HMLT-0001')
    expect(normalizeCardCode('  HMLT-0001  ')).toBe('HMLT-0001')
    expect(normalizeCardCode('HMLT-0001')).toBe('HMLT-0001')
  })
})
