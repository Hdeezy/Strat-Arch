# HOPE Card — MVP

A closed-loop, paper-QR voucher system that lets donors fund physical cards for people experiencing homelessness in Hamilton, Ontario. Cards redeem at vetted merchants (starting with 541 Eatery & Exchange) for essentials only — food, transit, clothing, hygiene. Funds cannot be spent on alcohol, drugs, or anything outside the closed loop.

---

## Architecture

- **Next.js 14** App Router, TypeScript, React Server Components
- **Supabase** — Postgres + Auth + RLS (Row-Level Security)
- **Stripe** — Checkout for donor payments, Connect for merchant payouts
- **Vercel** — deployment target
- **PWA** — installable via `next-pwa` with manifest and service worker
- **HMAC-signed QR codes** — `jose` (HS256 JWT), short-lived (5 min), replay-prevented via nonce table
- **Append-only audit trail** — `card_events` table, enforced at DB level via triggers

### Multi-tenant design
Every table carries `city_id` and `charity_id`. Hamilton is tenant 1. Adding HOPE Calgary requires only a new row in `cities` and `charities` — no schema migration.

---

## Local dev setup

### Prerequisites

- Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`)
- A Supabase project (free tier is fine)
- A Stripe account with test keys

### 1. Clone and install

```bash
git clone https://github.com/hdeezy/strat-arch
cd strat-arch
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | After running `stripe listen` (see step 5) |
| `STRIPE_CONNECT_CLIENT_ID` | Stripe Dashboard → Connect → Settings |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys |
| `HOPE_QR_SIGNING_SECRET` | Generate: `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev |
| `APPLE_WALLET_CERT_PATH` | Path to your `.p12` cert (optional) |
| `APPLE_WALLET_CERT_PASSWORD` | Cert password (optional) |
| `GOOGLE_WALLET_ISSUER_ID` | Google Pay & Wallet Console (optional) |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_KEY` | JSON string from GCP service account (optional) |

> **Apple/Google Wallet**: The app boots and runs without wallet certs. Wallet pass endpoints return HTTP 503 with a clear message when certs are not configured.

### 3. Run Supabase migrations

```bash
# Start local Supabase (or point to your hosted project)
supabase start

# Apply migrations
supabase db push
# or manually:
psql $DATABASE_URL < supabase/migrations/001_schema.sql
psql $DATABASE_URL < supabase/migrations/002_rls.sql
psql $DATABASE_URL < supabase/migrations/003_seed.sql
```

The seed creates:
- 1 city: Hamilton, Ontario
- 2 charities: Living Rock Ministries (Pilot), Helping Hands Hamilton
- 1 merchant: 541 Eatery & Exchange (food category)
- 50 unloaded cards: `HMLT-0001` through `HMLT-0050`

### 4. Run the dev server

```bash
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

### 5. Set up Stripe webhooks (local)

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the webhook signing secret printed by the CLI into `STRIPE_WEBHOOK_SECRET` in `.env.local`.

### 6. Create test users

In Supabase Dashboard → Authentication → Users, create users and assign roles via the `profiles` table:

```sql
-- Make a user a super_admin
UPDATE profiles SET role = 'super_admin' WHERE user_id = '<your-user-id>';

-- Make a user an advocate (also insert advocate row)
UPDATE profiles SET role = 'advocate' WHERE user_id = '<user-id>';
INSERT INTO advocates (charity_id, user_id, full_name)
VALUES ('00000000-0000-0000-0000-000000000010', '<user-id>', 'Jane Smith');

-- Make a user merchant staff
UPDATE profiles SET role = 'merchant_staff' WHERE user_id = '<user-id>';
INSERT INTO merchant_staff (merchant_id, user_id)
VALUES ('00000000-0000-0000-0000-000000000020', '<user-id>');
```

---

## First-run walkthrough

This demonstrates the complete flow: **load a card → issue it → redeem it → see chain of custody**.

### Step 1 — Donor funds a card

1. Open [http://localhost:3000/donate](http://localhost:3000/donate)
2. Enter card code `HMLT-0001` and click **Look Up Card**
3. Choose amount **$10**, keep all categories checked
4. Optionally add a note: _"Stay warm out there"_
5. Leave receipt toggle off (anonymous)
6. Click **Donate $10.00 to HMLT-0001**
7. Complete Stripe test payment with card `4242 4242 4242 4242`
8. You land on the success page — card is now **active** with $10.00 balance

Behind the scenes:
- `payment_intent.succeeded` webhook fires
- Stripe webhook handler creates a `donations` row and debits `cards.balance_cents += 1000`
- A `loaded` event is appended to `card_events`

### Step 2 — Advocate issues the card

1. Sign in as an advocate at [http://localhost:3000/auth/login](http://localhost:3000/auth/login)
2. Navigate to **My Cards** → find `HMLT-0001`
3. Click **Mark as Issued**

Behind the scenes:
- `POST /api/cards/:id/issue` appends an `issued` event to `card_events`
- Card remains `active` — issued is a custody record, not a state change

### Step 3 — Merchant redeems the card

1. Sign in as merchant staff at [http://localhost:3000/merchant](http://localhost:3000/merchant)
2. Click **Scan HOPE Card**
3. In the browser console or via curl, get a signed token:
   ```bash
   curl http://localhost:3000/api/cards/HMLT-0001/lookup
   # Returns: { card: {...}, token: "eyJ..." }
   ```
4. Or scan the QR from the wallet page: [http://localhost:3000/wallet/HMLT-0001](http://localhost:3000/wallet/HMLT-0001)
5. The merchant UI shows balance $10.00, type **8.50**, click **Charge $8.50**

Behind the scenes:
- `POST /api/cards/:id/redeem` runs `attemptRedemption()`:
  1. Verifies JWT signature
  2. Checks nonce not replayed
  3. Checks card state = `active`
  4. Checks category (541 Eatery = `food`, card allows `food`) ✓
  5. Checks daily cap (0 spent, $20 cap) ✓
  6. Checks balance ($10 ≥ $8.50) ✓
  7. Marks nonce used
  8. Creates `redemptions` row
  9. Decrements `balance_cents` to 150
  10. Appends `redemption_succeeded` to `card_events`
  11. Returns donor note if present

### Step 4 — Donor views chain of custody

1. Sign in as the donor (if receipt was requested; otherwise view via admin)
2. Navigate to [http://localhost:3000/donate/dashboard](http://localhost:3000/donate/dashboard)
3. Click **View chain of custody** on HMLT-0001

You see:
```
✦ Card created        — seeded
● Card funded         — May 16 at 8:32pm · $10.00
● Issued by outreach  — May 17 at 9:14am
● Used at merchant    — 541 Eatery & Exchange · $8.50
```

Balance remaining: $1.50. No recipient identity. Ever.

---

## PWA surfaces

| Surface | URL | Auth |
|---|---|---|
| Donor | `/donate` | Optional (magic link for receipts) |
| Recipient Wallet | `/wallet` | None |
| Merchant | `/merchant` | Required |
| Advocate | `/advocate` | Required |
| Admin | `/admin` | Required (charity_admin or super_admin) |

---

## API routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/stripe/webhook` | Stripe webhook — funds cards on `payment_intent.succeeded` |
| `POST` | `/api/checkout/create` | Creates Stripe Checkout session |
| `GET` | `/api/cards/[code]/lookup` | Look up card by code, returns fresh signed JWT |
| `GET` | `/api/cards/[id]` | Full card detail + chain of custody |
| `POST` | `/api/cards/validate-token` | Merchant: verify QR without debiting |
| `POST` | `/api/cards/[id]/redeem` | Merchant: debit card |
| `POST` | `/api/cards/[id]/issue` | Advocate: mark as issued |
| `POST` | `/api/cards/[id]/invalidate` | Advocate/admin: invalidate card |
| `POST` | `/api/cards/[id]/credit` | Advocate: earn-back rail (scaffold) |
| `GET` | `/api/wallet/apple/[id]` | Generate Apple Wallet `.pkpass` |
| `GET` | `/api/wallet/google/[id]` | Generate Google Wallet save URL |
| `GET` | `/api/admin/export` | CSV export (`?type=redemptions\|donations`) |
| `GET` | `/api/admin/flags` | Suspicious pattern detection |
| `GET` | `/api/admin/print-cards-pdf` | Generate print-ready PDF of unloaded cards |

---

## QR code format

Every QR encodes a URL: `https://<APP_URL>/donate/<CARD_CODE>`

When a donor or merchant scans it, the server:
1. Looks up the card by `card_code`
2. Generates a fresh HS256 JWT (5-minute expiry) with claims:
   ```json
   { "card_id": "uuid", "card_code": "HMLT-0001", "city_id": "...", "charity_id": "...", "nonce": "uuid-v4", "iat": 1234, "exp": 1534 }
   ```
3. Returns the token to the client
4. Client passes the token on every transaction attempt

On redemption, the server verifies the signature, checks the nonce hasn't been used in the last 10 minutes (`used_nonces` table), then runs all business rule checks.

---

## Running tests

```bash
npm test
# or watch mode:
npm run test:watch
```

Tests cover:
- `qr.test.ts` — JWT signing, claim verification, unique nonces, tamper rejection, wrong-secret rejection
- `daily-cap.test.ts` — `isNewDay`, full cap, partial spend, lazy reset from yesterday, floor at 0
- `category-gate.test.ts` — direct match, non-match, `multi` wildcard, empty array, case-sensitivity
- `card-code.test.ts` — valid/invalid code formats, normalization
- `redemption-idempotency.test.ts` — happy path, duplicate idempotency key, nonce replay, invalidated card, insufficient balance, category mismatch, daily cap exceeded, unloaded card

---

## Database migrations

```
supabase/migrations/
├── 001_schema.sql   # All tables, enums, indexes, append-only triggers
├── 002_rls.sql      # Row-level security policies + helper functions
└── 003_seed.sql     # Hamilton, charities, 541 Eatery, 50 HMLT cards
```

To add a new city/charity tenant, insert rows into `cities` and `charities` and generate new card codes. No migration required.

---

## Printing cards

1. Go to [http://localhost:3000/admin/print-cards](http://localhost:3000/admin/print-cards)
2. Click **Download PDF**
3. Print on business card paper (3.5" × 2", 10 per sheet)
4. Cut along lines, distribute to advocates

Each card shows the HOPE Card wordmark, a QR code pointing to `/donate/<CARD_CODE>`, and the human-readable code. The QR encodes a stable URL — the signed JWT is generated dynamically on each scan, never printed.

---

## Security principles

1. **HMAC-signed QR payloads** — screenshots cannot be replayed; each JWT has a nonce + 5-min TTL
2. **Server-side authority** — all business rules enforced in Postgres RLS + route handlers; client is never trusted
3. **Closed-loop in code** — category gate is enforced on every redemption attempt; a clothing merchant cannot debit a food-only card
4. **Append-only audit trail** — `card_events` cannot be updated or deleted (DB trigger raises exception)
5. **Privacy-first** — no recipient identity ever stored; no names, photos, or biometrics on cards
6. **Multi-tenant isolation** — every table scoped by `city_id` + `charity_id`; RLS policies prevent cross-tenant reads

---

## Deployment (Vercel)

```bash
vercel --prod
```

Set all environment variables in the Vercel dashboard under **Settings → Environment Variables**.

For Stripe webhooks in production:
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-app.vercel.app/api/stripe/webhook`
3. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`

---

## Phase 2 roadmap (not built)

- **Earn-back rail UI** — `/api/cards/:id/credit` endpoint is complete; advocacy UI deferred
- **App-to-app recipient transfer** — endpoint scaffolded in spec, NFC tap-to-redeem via Web NFC API
- **Advocate camera multi-scan** — batch QR scanning without manual code entry
- **Stripe Transfer automation** — automatic merchant payout on `payout_schedule_days` cadence
- **SMS notifications** — email only in v1
