import { extractCardCodeFromQR } from '@/lib/utils'

describe('extractCardCodeFromQR', () => {
  it('extracts card code from a full https URL', () => {
    expect(extractCardCodeFromQR('https://hope.card/donate/HMLT-0001')).toBe('HMLT-0001')
  })

  it('extracts card code from a relative URL', () => {
    expect(extractCardCodeFromQR('/donate/HMLT-0001')).toBe('HMLT-0001')
  })

  it('extracts card code from localhost dev URL', () => {
    expect(extractCardCodeFromQR('http://localhost:3000/donate/HMLT-0042')).toBe('HMLT-0042')
  })

  it('normalizes lowercase code to uppercase', () => {
    expect(extractCardCodeFromQR('/donate/hmlt-0001')).toBe('HMLT-0001')
  })

  it('returns null for a raw JWT string (3 dot-separated segments)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJjYXJkX2lkIjoiMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(extractCardCodeFromQR(jwt)).toBeNull()
  })

  it('returns null for an arbitrary unrecognized string', () => {
    expect(extractCardCodeFromQR('not-a-valid-url')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(extractCardCodeFromQR('')).toBeNull()
  })

  it('handles alphanumeric card codes correctly', () => {
    expect(extractCardCodeFromQR('/donate/HOPE-A4F2')).toBe('HOPE-A4F2')
    expect(extractCardCodeFromQR('/donate/HMLT-0050')).toBe('HMLT-0050')
  })

  it('returns null when path segment is malformed (too short)', () => {
    expect(extractCardCodeFromQR('/donate/HML-001')).toBeNull()
    expect(extractCardCodeFromQR('/donate/HMLT-001')).toBeNull()
  })

  it('returns null when code has digit-only prefix (must be alpha)', () => {
    expect(extractCardCodeFromQR('/donate/1234-5678')).toBeNull()
  })
})

describe('JWT vs URL disambiguation (merchant scan flow)', () => {
  it('a string with 3 segments and no /donate/ path is treated as JWT (passes through)', () => {
    const raw = 'header.payload.signature'
    const code = extractCardCodeFromQR(raw)
    // No URL match → null → caller treats as JWT
    expect(code).toBeNull()
    // Caller checks: raw.split('.').length === 3 → passes to validateCard directly
    expect(raw.split('.').length).toBe(3)
  })

  it('a /donate/ URL has 1 dot-segment and a code — treated as URL', () => {
    const raw = 'https://hope.card/donate/HMLT-0001'
    const code = extractCardCodeFromQR(raw)
    expect(code).toBe('HMLT-0001')
    // Caller fetches /api/cards/HMLT-0001/lookup to get a fresh JWT
    expect(raw.split('.').length).not.toBe(3)
  })
})
