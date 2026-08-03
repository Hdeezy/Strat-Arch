# DEPLOYING TO A SUPABASE PROJECT

One correct sequence. Written because three agents were about to run three
different versions of it against two different project refs.

**Run this from the machine that has the repo and the Supabase CLI.** Every
alternative — SQL Editor paste, browser driving, MCP connectors — is a
workaround for not being on that machine, and each one loses the migration
history table.

---

## 0. Which project, and which branch

Two things have to be pinned before anything runs.

### The project ref

Two refs have been named in this project's history:

| Ref | Where it came from |
|---|---|
| `mzmwvxizvjmqplyxtgst` | Given as the live project |
| `avwtfnfmkxeksfvtkyei` | Named later in a separate session |

**These are different databases.** Confirm which one you mean before running
anything. Pushing to the wrong one leaves two half-migrated projects and no
clean way to tell them apart afterwards.

```bash
supabase projects list
```

### The branch

```bash
git fetch origin
git checkout claude/hope-card-mvp-BDgun
git pull
git log --oneline -1     # expect 0712f9d or later
ls supabase/migrations/  # expect 001 through 008
```

**This matters more than it looks.** `main` is at `be2cad8`, which predates
the ledger entirely. A `db push` from a stale clone applies 001–004 and stops
— no ledger, no invariants, and the *old* `003_seed.sql` that plants fifty
enumerable card codes and two known-password advocate accounts.

If `ls` does not show `008_rotate_enumerable_codes.sql`, stop. You are on the
wrong branch or have not pulled.

---

## 1. Region — do this before you push, not after

```
https://supabase.com/dashboard/project/<ref>/settings/general
```

Read **Region**.

- `Canada (Central)` / `ca-central-1` → proceed.
- Anything else → **stop.** Region cannot be changed in place. Create a new
  project in Canada (Central) and use that ref. Doing this before data exists
  is trivial; doing it after real donations is a migration on a live money
  ledger.

This is shape decision 6 in the Scrappy Cut, and it is the reason it is a
shape decision.

---

## 2. Link and push

```bash
supabase link --project-ref <ref>
supabase db push
```

`db push` records each migration in `supabase_migrations.schema_migrations`,
which the SQL Editor does not. That history is what makes the next migration
safe.

### What a clean run looks like

```
Applying migration 001_schema.sql...
...
Applying migration 003_seed.sql...
NOTICE: Skipping dev advocate users (set hope.seed_dev_users = 'on' to seed them locally).
...
Applying migration 008_rotate_enumerable_codes.sql...
NOTICE: Card code rotation complete.
NOTICE:   rotated: 0  (these cards MUST be re-printed)
NOTICE:   skipped: 0  (already issued to a person)
```

**`rotated: 0` on a fresh project is correct, not a failure.** 003 now seeds
non-enumerable codes directly, so 008 finds nothing to fix. It stays in the
chain because it is the only thing that repairs a database which already ran
the old seed.

### If the project is NOT empty

`db push` on a database whose objects exist but whose history table is empty
will fail on `relation already exists`. That happens when earlier migrations
were applied by pasting into the SQL Editor. Options, in order of preference:

1. **Start a fresh project.** At pilot scale with test data, this is faster
   and safer than reconciling history.
2. `supabase migration repair --status applied <version>` for each migration
   already present, then push the remainder.

Do not paste 005–008 into the SQL Editor to "catch up". It works once and
leaves the history table lying to you forever after.

---

## 3. Bootstrap the first real account

**A fresh push creates zero admin and zero advocate accounts**, by design —
the dev accounts with publicly-known passwords are gated off. Nothing can log
into `/admin` or `/advocate` until you create a real one.

1. Dashboard → **Authentication → Users → Add user**. Real email, strong
   password, "Auto Confirm User" on.
2. Copy the new user's UUID.
3. SQL Editor:

```sql
-- Promote to charity_admin
update profiles set role = 'charity_admin', full_name = 'Your Name'
 where user_id = '<uuid>';

-- Also make them an advocate so they can load and invalidate cards
insert into advocates (charity_id, user_id, full_name, phone)
select id, '<uuid>', 'Your Name', '<phone>'
  from charities order by created_at limit 1;
```

For **local development only**, the two seeded test accounts can be restored:

```bash
psql "$DATABASE_URL" -c "set hope.seed_dev_users = 'on'" \
     -f supabase/migrations/003_seed.sql
```

Never set that on a shared or production project. Those passwords are in the
git history.

---

## 4. Verify

```sql
select * from check_ledger_invariants();
```

All five must read `t`. Any `f` is a stop-everything result — do not load a
real card until it is resolved.

```sql
-- No enumerable codes should exist
select count(*) from cards where card_code ~ '^[A-Z]{4}-[A-Z0-9]{4}$';   -- expect 0

-- No known-password accounts
select email from auth.users where email like '%@livingrock.ca'
   or email like '%@helpinghandshamilton.ca';                            -- expect 0 rows
```

---

## 5. Environment variables

Vercel → Settings → Environment Variables.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → API. Server-side only. |
| `STRIPE_SECRET_KEY` | Foundation's own account, restricted key |
| `STRIPE_WEBHOOK_SECRET` | From the webhook endpoint config |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | |
| `HOPE_QR_SIGNING_SECRET` | ≥32 random chars. Also salts the lookup audit hash. |
| `CRON_SECRET` | **Required.** Without it all three crons return 503 and clearance never releases — the routes refuse to run open rather than let anyone trigger a clearance release. |
| `NEXT_PUBLIC_HOPE_INVALIDATION_PHONE` | The real lost-card line. If unset the wallet page says "ask your outreach worker" instead of dialling a wrong number. |

Redeploy after setting them.

---

## 6. Only if `rotated > 0`

That means you pushed to a database that had run the old seed. Any card the
migration reported as `skipped` is in someone's hands and needs the real
operation rather than a rename:

```bash
node scripts/reissue-enumerable-cards.mjs            # dry run
node scripts/reissue-enumerable-cards.mjs --execute
```

Have replacement cards printed first — this invalidates the old one.

Every card the migration *rotated* also needs re-printing. `/admin/print-cards`
generates the sheet.

---

## What is still a human decision

- The real lost-card phone number, and who answers it.
- Whether to retire the old project once the new one is verified.
- Printing and physically swapping card stock.
