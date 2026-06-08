import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Only use in server-side code (Route Handlers, Server Actions)
// This bypasses RLS — never expose to the client
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Supabase admin credentials are not configured')
  }

  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
