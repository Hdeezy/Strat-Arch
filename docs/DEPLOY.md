# DEPLOYING TO A SUPABASE PROJECT

## If you just want it done

Open Terminal. Paste this whole block at once, then press Enter:

```bash
cd ~/Projects/Strat-Arch
git fetch origin
git checkout claude/hope-card-mvp-BDgun
git pull origin claude/hope-card-mvp-BDgun
bash scripts/setup.sh
```

**The first four lines are not optional.** `scripts/setup.sh` only exists on
the `claude/hope-card-mvp-BDgun` branch. If your copy is on `main` you will
get `No such file or directory`, because the script that fetches the right
branch is itself on that branch. Fetch first, then run it.

If `git checkout` complains about local changes, stop and ask — do not force
it.

That checks your machine, gets the right code, sets up the database, verifies
the money ledger, and writes your `.env.local` with two secrets generated for
you. It stops at the first problem and tells you what to do about it, rather
than half-finishing.

Then:

```bash
bash scripts/make-me-admin.sh
```

after you've created your account in the Supabase dashboard — it prints the
link and walks you through it.

**You do not need to read the rest of this file.** It is the same sequence
written out by hand, for when something goes wrong or you want to know what
the script is doing.

---

## The manual sequence

One correct sequence. Written because three agents were about to run three
different versions of it against two different project refs.

**Run this from the machine that has the repo and the Supabase CLI.** Every
alternative — SQL Editor paste, browser driving, MCP connectors — is a
workaround for not being on that machine, and each one loses the migration
history table.

---

## 0. The project, and the branch

### The project ref

```
avwtfnfmkxeksfvtkyei        Canadian region. Empty. This is the one.
```

`mzmwvxizvjmqplyxtgst` was a **test environment and is being retired.** Do
not push to it. Nothing in it needs migrating — no card was ever issued to a
real person, which is why the enumerable-code rotation has no launch-day
role.

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

## 1. Region — already confirmed, verify once more at link time

`avwtfnfmkxeksfvtkyei` was created in the Canadian region. Shape decision 6
is satisfied.

`supabase projects list` prints the region alongside the ref. Glance at it
when you link — it costs nothing and it is the last cheap moment to catch a
wrong project. Region cannot be changed in place afterwards.

---

## 2. Link and push

```bash
supabase link --project-ref avwtfnfmkxeksfvtkyei
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

### If it fails on `relation already exists`

The project is not as empty as expected — objects exist but the history table
does not know about them, which is what pasting into the SQL Editor produces.

Given this project was created fresh, that result means you are pointed at
the wrong ref. Check before doing anything else. If it genuinely is the right
project and someone has pasted migrations into it, either start another fresh
project or run `supabase migration repair --status applied <version>` for
each migration already present, then push the remainder.

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

## 6. Print the cards

`/admin/print-cards` generates the PDF sheet from the 50 seeded cards.

The codes are non-enumerable from the moment they are seeded, so this is a
straight print — no rotation, no swap, nothing to destroy. That is the whole
benefit of having caught the seed bug before the first push rather than
after.

---

## Not applicable to this deployment

**`scripts/reissue-enumerable-cards.mjs`** and the `rotated > 0` path exist
for a database that ran the old sequential seed. This project never will.
The script stays in the repo because invalidate-and-reissue is a real
operation the programme needs — a member reporting a stolen card is exactly
that path — but it has no launch-day role.

---

## What is still a human decision

- The real lost-card phone number, and who answers it.
- Deleting the old test project once this one is verified.
- Printing the card stock.
