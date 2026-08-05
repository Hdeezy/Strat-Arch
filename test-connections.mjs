// Run: node test-connections.mjs
// Tests Supabase + Stripe connections using your .env.local values

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local')
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim()
  }
} catch { console.error('❌ .env.local not found'); process.exit(1) }

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'HOPE_QR_SIGNING_SECRET',
  'NEXT_PUBLIC_APP_URL',
]

// 1. Check all keys present
console.log('\n── ENV KEYS ──────────────────────────')
let missing = []
for (const k of REQUIRED) {
  const val = process.env[k]
  if (!val) { console.log(`❌ ${k} MISSING`); missing.push(k) }
  else console.log(`✅ ${k} = ${val.slice(0,12)}…`)
}

if (missing.length) {
  console.log(`\n${missing.length} missing key(s). Add them to .env.local`)
  process.exit(1)
}

// 2. Test Supabase anon connection
console.log('\n── SUPABASE (anon) ───────────────────')
const sbRes = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/cities?select=name&limit=1`,
  { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
               Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } }
)
if (sbRes.ok) {
  const data = await sbRes.json()
  console.log(`✅ Supabase anon: ${JSON.stringify(data)}`)
} else {
  console.log(`❌ Supabase anon: HTTP ${sbRes.status} — ${await sbRes.text()}`)
}

// 3. Test Supabase service role
console.log('\n── SUPABASE (service role) ───────────')
const sbAdminRes = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/cards?select=id,card_code,state&limit=3`,
  { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
               Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
)
if (sbAdminRes.ok) {
  const data = await sbAdminRes.json()
  console.log(`✅ Supabase admin: ${data.length} card(s) — ${JSON.stringify(data.slice(0,2))}`)
} else {
  console.log(`❌ Supabase admin: HTTP ${sbAdminRes.status} — ${await sbAdminRes.text()}`)
}

// 4. Test Stripe
console.log('\n── STRIPE ────────────────────────────')
const stripeRes = await fetch('https://api.stripe.com/v1/balance', {
  headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
})
if (stripeRes.ok) {
  const data = await stripeRes.json()
  const avail = data.available?.map(b => `${b.currency.toUpperCase()} ${(b.amount/100).toFixed(2)}`).join(', ')
  console.log(`✅ Stripe: balance available = ${avail || 'empty'}`)
} else {
  const err = await stripeRes.json()
  console.log(`❌ Stripe: ${err.error?.message || stripeRes.status}`)
}

// 5. Check HOPE_QR_SIGNING_SECRET length
console.log('\n── QR SIGNING SECRET ─────────────────')
const secret = process.env.HOPE_QR_SIGNING_SECRET
if (secret.length >= 32) console.log(`✅ HOPE_QR_SIGNING_SECRET: ${secret.length} chars (OK)`)
else console.log(`❌ HOPE_QR_SIGNING_SECRET: ${secret.length} chars — needs ≥32 for HS256`)

console.log('\n──────────────────────────────────────\n')
