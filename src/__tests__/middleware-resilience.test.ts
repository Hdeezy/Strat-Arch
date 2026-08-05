/**
 * Middleware must never be able to 500 the whole site.
 *
 * A missing env var here previously produced MIDDLEWARE_INVOCATION_FAILED on
 * EVERY route — including the pages that would have explained the problem.
 */
import { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const ORIGINAL = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL } })

function req(path = '/') {
  return new NextRequest(`https://example.test${path}`)
}

describe('middleware with missing configuration', () => {
  it('reports unconfigured instead of throwing when both vars are absent', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const result = await updateSession(req())
    expect(result.kind).toBe('unconfigured')
    if (result.kind === 'unconfigured') {
      expect(result.missing).toEqual([
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ])
    }
  })

  it('names only the variable that is actually missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const result = await updateSession(req())
    expect(result.kind).toBe('unconfigured')
    if (result.kind === 'unconfigured') {
      expect(result.missing).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY'])
    }
  })

  it('does not throw on a protected path either', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    await expect(updateSession(req('/admin'))).resolves.toBeDefined()
  })
})
