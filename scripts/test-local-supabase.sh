#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HOPE Card — local Supabase test runner
#
# Usage:
#   ./scripts/test-local-supabase.sh           # full test run
#   ./scripts/test-local-supabase.sh --skip-reset  # skip db reset (faster re-runs)
#
# Prerequisites:
#   - Supabase CLI ≥ 1.170  (npm i -g supabase)
#   - Docker running
#   - jq (optional, for pretty output)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SKIP_RESET=false
for arg in "$@"; do
  [[ "$arg" == "--skip-reset" ]] && SKIP_RESET=true
done

PASS=0
FAIL=0
ERRORS=()

pass() { echo "  ✓ $1"; ((PASS++)); }
fail() { echo "  ✗ $1"; ((FAIL++)); ERRORS+=("$1"); }
section() { echo; echo "── $1 ──────────────────────────────────────"; }

# ─── 0. Prerequisites ────────────────────────────────────────────────────────

section "Prerequisites"

if ! command -v supabase &>/dev/null; then
  echo "ERROR: supabase CLI not found. Run: npm i -g supabase"
  exit 1
fi
pass "supabase CLI installed ($(supabase --version))"

if ! docker info &>/dev/null; then
  echo "ERROR: Docker is not running."
  exit 1
fi
pass "Docker is running"

# ─── 1. Start Supabase ──────────────────────────────────────────────────────

section "Supabase local stack"

if supabase status 2>/dev/null | grep -q "API URL"; then
  pass "Supabase already running"
else
  echo "  Starting Supabase..."
  supabase start
  pass "Supabase started"
fi

DB_URL=$(supabase status --output env 2>/dev/null | grep DATABASE_URL | cut -d= -f2- || true)
if [[ -z "$DB_URL" ]]; then
  # Fallback for older CLI versions
  DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"
fi

# ─── 2. Apply migrations ────────────────────────────────────────────────────

section "Database reset & migrations"

if [[ "$SKIP_RESET" == "false" ]]; then
  echo "  Running supabase db reset (applies all migrations + seed)..."
  if supabase db reset --local; then
    pass "supabase db reset succeeded"
  else
    fail "supabase db reset failed — check migration SQL for errors"
    echo "  Run manually: supabase db reset --local"
    exit 1
  fi
else
  pass "Database reset skipped (--skip-reset)"
fi

# ─── 3. Verify migration files ───────────────────────────────────────────────

section "Migration file integrity"

for f in supabase/migrations/001_schema.sql supabase/migrations/002_rls.sql supabase/migrations/003_seed.sql; do
  if [[ -f "$f" ]]; then
    pass "$f present"
  else
    fail "$f MISSING"
  fi
done

# ─── 4. Schema verification (direct SQL) ────────────────────────────────────

section "Schema verification (direct SQL)"

check_table() {
  local table=$1
  if psql "$DB_URL" -tAc "select exists(select 1 from information_schema.tables where table_schema='public' and table_name='$table')" 2>/dev/null | grep -q t; then
    pass "Table: $table"
  else
    fail "Table MISSING: $table"
  fi
}

for t in cities charities merchants cards donations card_events redemptions advocates profiles used_nonces merchant_staff; do
  check_table "$t"
done

check_enum() {
  local enum=$1
  if psql "$DB_URL" -tAc "select exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typname='$enum' and n.nspname='public')" 2>/dev/null | grep -q t; then
    pass "Enum: $enum"
  else
    fail "Enum MISSING: $enum"
  fi
}

for e in card_state card_category card_event_type actor_type redemption_status user_role; do
  check_enum "$e"
done

# ─── 5. Append-only trigger ─────────────────────────────────────────────────

section "Append-only trigger on card_events"

TRIGGER_OK=$(psql "$DB_URL" -tAc "
  select count(*) from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where c.relname = 'card_events' and n.nspname = 'public'
  and t.tgname in ('card_events_no_update','card_events_no_delete')
" 2>/dev/null || echo 0)

if [[ "$TRIGGER_OK" == "2" ]]; then
  pass "Both card_events triggers present"
else
  fail "card_events triggers missing or incomplete (found: $TRIGGER_OK, expected: 2)"
fi

# Attempt an update — must fail
UPDATE_RESULT=$(psql "$DB_URL" -tAc "
  do \$\$
  begin
    update card_events set metadata = '{}'::jsonb where id = (select id from card_events limit 1);
    raise exception 'TRIGGER_MISSING: update should have been blocked';
  exception
    when others then
      if sqlerrm like '%append-only%' then
        raise notice 'TRIGGER_OK';
      else
        raise exception 'UNEXPECTED: %', sqlerrm;
      end if;
  end \$\$;
" 2>&1 || true)

if echo "$UPDATE_RESULT" | grep -q "TRIGGER_OK"; then
  pass "UPDATE on card_events correctly rejected"
else
  fail "UPDATE on card_events was not rejected (trigger may be missing)"
fi

# ─── 6. RLS policies ────────────────────────────────────────────────────────

section "Row Level Security policies"

check_policy() {
  local table=$1
  local policy=$2
  if psql "$DB_URL" -tAc "
    select exists(
      select 1 from pg_policies
      where schemaname='public' and tablename='$table' and policyname='$policy'
    )
  " 2>/dev/null | grep -q t; then
    pass "Policy: $table.$policy"
  else
    fail "Policy MISSING: $table.$policy"
  fi
}

check_policy cards        cards_super_admin_all
check_policy cards        cards_charity_admin_all
check_policy cards        cards_advocate_read
check_policy cards        cards_merchant_read
check_policy cards        cards_donor_read
check_policy donations    donations_donor_own
check_policy card_events  card_events_donor_read
check_policy card_events  card_events_merchant_read
check_policy redemptions  redemptions_merchant_own
check_policy profiles     profiles_self_update
check_policy profiles     profiles_super_admin_all
check_policy used_nonces  used_nonces_super_admin_all

# ─── 7. Seed data ───────────────────────────────────────────────────────────

section "Seed data"

CARD_COUNT=$(psql "$DB_URL" -tAc "select count(*)::int from cards where card_code like 'HMLT-%'" 2>/dev/null | tr -d ' \n' || echo 0)
if [[ "$CARD_COUNT" == "50" ]]; then
  pass "50 HMLT cards seeded"
else
  fail "Expected 50 HMLT cards, got: $CARD_COUNT"
fi

CITY_OK=$(psql "$DB_URL" -tAc "select exists(select 1 from cities where name='Hamilton')" 2>/dev/null | tr -d ' \n')
[[ "$CITY_OK" == "t" ]] && pass "Hamilton city seeded" || fail "Hamilton city missing"

MERCHANT_OK=$(psql "$DB_URL" -tAc "select exists(select 1 from merchants where name='541 Eatery & Exchange')" 2>/dev/null | tr -d ' \n')
[[ "$MERCHANT_OK" == "t" ]] && pass "541 Eatery seeded" || fail "541 Eatery missing"

ADVOCATE_COUNT=$(psql "$DB_URL" -tAc "select count(*)::int from advocates" 2>/dev/null | tr -d ' \n' || echo 0)
[[ "$ADVOCATE_COUNT" -ge "2" ]] && pass "≥2 advocates seeded" || fail "Advocates missing (got $ADVOCATE_COUNT)"

# ─── 8. pgTAP tests ─────────────────────────────────────────────────────────

section "pgTAP SQL tests"

if psql "$DB_URL" -tAc "select 1 from pg_extension where extname='pgtap'" 2>/dev/null | grep -q 1; then
  echo "  Running pgTAP tests..."
  for sql_file in supabase/tests/*.sql; do
    test_name=$(basename "$sql_file")
    if psql "$DB_URL" -f "$sql_file" 2>&1 | grep -qE "^not ok|FAILED"; then
      fail "pgTAP: $test_name"
    else
      pass "pgTAP: $test_name"
    fi
  done
else
  echo "  pgTAP not installed — skipping SQL tests"
  echo "  Install: supabase db extension enable pgtap --local"
fi

# ─── 9. Jest unit tests ──────────────────────────────────────────────────────

section "Jest unit tests"

export HOPE_QR_SIGNING_SECRET="test-secret-long-enough-for-hmac-sha256-algorithm"

if npm test -- --ci --passWithNoTests 2>&1; then
  pass "Jest test suite passed"
else
  fail "Jest test suite FAILED"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo
echo "════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════"

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo
  echo "Failed checks:"
  for e in "${ERRORS[@]}"; do
    echo "  ✗ $e"
  done
  echo
  exit 1
fi

echo
echo "All checks passed. HOPE Card local stack is healthy."
echo
