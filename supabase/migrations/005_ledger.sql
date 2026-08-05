-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 005 — THE SCRAPPY CUT
--
-- Implements the eight shape decisions from HOPE_MVP_Scrappy_Cut.md §1.
-- These are the decisions that are nearly free today and nearly impossible
-- to retrofit once real money has moved.
--
--   1. Double-entry, append-only ledger with idempotency keys
--   2. tenant_id column on every table (column only — no RLS, no config, no UI)
--   3. Authorize-then-capture-partial redemption model
--   4. credential_kind enum (paper_qr, nfc_sun, rotating_qr)
--   5. Append-only card_events (already present in 001; hardened in grants.sql)
--   6. Supabase region ca-central-1 (project setting, not schema — see DECISIONS.md)
--   7. No payout execution (a non-build; settlement produces instructions only)
--   8. Collect nothing that requires consent machinery
--
-- After this migration, cards.balance_cents is a PROJECTION, not the source of
-- truth. The ledger is the source of truth. See §"CARD BALANCE PROJECTION".
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- SHAPE 2 — TENANT
--
-- Column only. No RLS, no per-tenant config, no provisioning UI. That
-- machinery lands in 2027. What cannot be retrofitted is the column itself,
-- because adding it later means a data migration on a live money ledger.
-- ───────────────────────────────────────────────────────────────────────────

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

insert into tenants (id, name)
values ('0000f00e-0000-4000-8000-000000000001'::uuid, 'HOPE Hamilton (Pilot)')
on conflict do nothing;

-- The single pilot tenant. Every tenant_id column defaults to this.
create or replace function default_tenant_id()
returns uuid as $$
  select '0000f00e-0000-4000-8000-000000000001'::uuid
$$ language sql immutable;

alter table cities         add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table charities      add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table merchants      add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table cards          add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table donations      add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table card_events    add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table redemptions    add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table advocates      add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table profiles       add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table merchant_staff add column tenant_id uuid not null default default_tenant_id() references tenants(id);
alter table used_nonces    add column tenant_id uuid not null default default_tenant_id() references tenants(id);


-- ───────────────────────────────────────────────────────────────────────────
-- SHAPE 4 — CREDENTIAL KIND
--
-- Per HOPE_Tap_Without_Integration_Memo §6: Path A is NFC (NTAG 424 DNA in
-- SUN mode) with a printed QR on the same card as fallback. The credential
-- layer must be pluggable BEFORE the redemption path is written, or the NFC
-- upgrade becomes a redemption-path rewrite.
--
-- Resolution is one endpoint. Only the verification step differs per kind.
-- ───────────────────────────────────────────────────────────────────────────

create type credential_kind as enum ('paper_qr', 'nfc_sun', 'rotating_qr');

alter table cards
  add column credential_kind credential_kind not null default 'paper_qr',
  -- NTAG 424 DNA per-card AES key ref (never the key itself — that lives in
  -- the secret store keyed by this ref). Null until a card is NFC-provisioned.
  add column credential_key_ref text,
  -- SUN monotonic tap counter. Rejects replay: a tap whose counter is <= the
  -- stored value is a clone or a replay.
  add column credential_tap_counter bigint not null default 0,
  add column invalidated_at timestamptz,
  add column reissued_from_card_id uuid references cards(id);

create index cards_tenant_id_idx on cards(tenant_id);
create index cards_credential_kind_idx on cards(credential_kind);


-- ───────────────────────────────────────────────────────────────────────────
-- NON-ENUMERABLE CARD CODES
--
-- Scrappy Cut §3a control 1: "Card codes and credential tokens must be random
-- and non-enumerable. Sequential codes would turn this page into a
-- balance-scanning tool across the whole program."
--
-- HMLT-0001 is enumerable. Going forward: 8 characters of Crockford base32
-- with the ambiguous glyphs removed (I, L, O, U), giving ~40 bits. Existing
-- pilot codes keep working; the format check widens rather than changing.
-- ───────────────────────────────────────────────────────────────────────────

-- generate_card_code() is DEFINED IN 003_seed.sql, at the earliest point of
-- need, because the seed itself must produce non-enumerable codes. Defining
-- it here as well would be two copies of the alphabet free to drift apart.
--
-- The clause below is a no-op guard for any database that was migrated
-- before 003 carried the function — it creates it only if missing, using the
-- identical body.

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'generate_card_code'
  ) then
    execute $fn$
      create function generate_card_code(prefix text default 'HMLT')
      returns text as $body$
      declare
        alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- no I, L, O, U
        suffix text := '';
        i integer;
      begin
        for i in 1..8 loop
          suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        end loop;
        return prefix || '-' || suffix;
      end;
      $body$ language plpgsql volatile;
    $fn$;
  end if;
end $$;

-- Widen the accepted format. Old HMLT-0001 codes (4 chars) still validate;
-- new codes are 8. Enforced in the app layer via validateCardCode().
comment on column cards.card_code is
  'Format PREFIX-SUFFIX. New cards use 8 chars of Crockford base32 (non-enumerable). '
  'Legacy pilot cards may have 4. Never generate sequential codes — see Scrappy Cut §3a.';


-- ───────────────────────────────────────────────────────────────────────────
-- SHAPE 1 — DOUBLE-ENTRY LEDGER
--
-- Every movement of value is a transaction whose entries sum to zero.
-- Nothing outside src/ledger/ may write to these tables (Stack Decision
-- Record §4 rule 1). UPDATE and DELETE are revoked at the database level
-- in db/grants.sql (rule 2) — convention is insufficient.
--
-- Sign convention: amount_cents is signed. Positive is a DEBIT, negative is
-- a CREDIT. The entries of a transaction always sum to exactly zero.
-- Account balance is read through ledger_balances, which flips the sign for
-- credit-normal accounts so every balance reads positive in its own terms.
-- ───────────────────────────────────────────────────────────────────────────

create type ledger_account_type as enum (
  'cash_stripe',        -- asset:  cash held at Stripe on the Foundation's account
  'donor_clearing',     -- liability: donations received, inside the clearance hold
  'card_float',         -- liability: cleared funds, available to activate cards
  'card',               -- liability: value held on one specific card
  'authorization_hold', -- liability: value held against one open authorization
  'vendor_payable',     -- liability: captured value owed to one vendor
  'settled',            -- contra:  value discharged by a human-executed payment
  'reclaimed',          -- liability: value reclaimed from invalidated cards
  'chargeback'          -- contra-asset: donations reversed by the network
);

create type ledger_txn_kind as enum (
  'donation_received',    -- cash in, held in clearance
  'donation_cleared',     -- clearance elapsed, value joins the float
  'chargeback_reversal',  -- network reversed a donation
  'card_activation',      -- float assigned to a specific card
  'authorization_hold',   -- vendor opened an authorization against a card
  'capture',              -- vendor captured all or part of an authorization
  'authorization_void',   -- authorization released unspent
  'invalidation_reclaim', -- card invalidated, remaining value reclaimed
  'reissue',              -- reclaimed value assigned to a replacement card
  'settlement',           -- vendor payable discharged (instruction, not execution)
  'adjustment'            -- manual correction; always carries a memo
);

create table ledger_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default default_tenant_id() references tenants(id),
  account_type    ledger_account_type not null,
  -- Exactly one of these is set for per-subject accounts; both null for pooled.
  card_id         uuid references cards(id),
  merchant_id     uuid references merchants(id),
  normal_balance  text not null check (normal_balance in ('debit', 'credit')),
  created_at      timestamptz not null default now()
);

-- One card account per card; one payable per vendor; one singleton per pooled
-- type per tenant. These partial uniques are what make account lookup safe.
create unique index ledger_accounts_card_uniq
  on ledger_accounts(card_id) where card_id is not null;
create unique index ledger_accounts_merchant_uniq
  on ledger_accounts(merchant_id, account_type) where merchant_id is not null;
create unique index ledger_accounts_pooled_uniq
  on ledger_accounts(tenant_id, account_type)
  where card_id is null and merchant_id is null;

create index ledger_accounts_type_idx on ledger_accounts(account_type);

create table ledger_transactions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default default_tenant_id() references tenants(id),
  kind             ledger_txn_kind not null,
  -- Every money path is idempotent. Replaying a request with the same key is
  -- a no-op that returns the original result.
  idempotency_key  text not null unique,
  external_ref     text,   -- stripe payment_intent, authorization id, etc.
  memo             text,
  occurred_at      timestamptz not null default now()
);

create index ledger_transactions_kind_idx on ledger_transactions(kind);
create index ledger_transactions_occurred_at_idx on ledger_transactions(occurred_at);
create index ledger_transactions_external_ref_idx on ledger_transactions(external_ref);

create table ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default default_tenant_id() references tenants(id),
  transaction_id  uuid not null references ledger_transactions(id),
  account_id      uuid not null references ledger_accounts(id),
  -- Signed. Positive = debit, negative = credit. Zero is meaningless.
  amount_cents    bigint not null check (amount_cents <> 0),
  created_at      timestamptz not null default now()
);

create index ledger_entries_transaction_id_idx on ledger_entries(transaction_id);
create index ledger_entries_account_id_idx on ledger_entries(account_id);

-- ── Invariant 1, enforced structurally: entries sum to zero ────────────────
-- Deferred to transaction commit, because entries are inserted one row at a
-- time and the sum is only meaningful once the whole transaction is written.

create or replace function assert_ledger_transaction_balances()
returns trigger as $$
declare
  txn_sum bigint;
  entry_count integer;
begin
  select coalesce(sum(amount_cents), 0), count(*)
    into txn_sum, entry_count
    from ledger_entries
   where transaction_id = coalesce(new.transaction_id, old.transaction_id);

  if entry_count < 2 then
    raise exception 'ledger transaction % has % entries; double-entry requires at least 2',
      coalesce(new.transaction_id, old.transaction_id), entry_count;
  end if;

  if txn_sum <> 0 then
    raise exception 'ledger transaction % does not balance: entries sum to % (must be 0)',
      coalesce(new.transaction_id, old.transaction_id), txn_sum;
  end if;

  return null;
end;
$$ language plpgsql;

create constraint trigger ledger_entries_must_balance
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function assert_ledger_transaction_balances();

-- ── Append-only, enforced structurally ─────────────────────────────────────
-- grants.sql revokes UPDATE and DELETE from the application roles. These
-- triggers are the belt to that braces: they also catch the migration role.

create or replace function prevent_ledger_modification()
returns trigger as $$
begin
  raise exception '% is append-only: updates and deletes are not permitted', tg_table_name;
end;
$$ language plpgsql;

create trigger ledger_entries_no_update
  before update on ledger_entries
  for each row execute function prevent_ledger_modification();
create trigger ledger_entries_no_delete
  before delete on ledger_entries
  for each row execute function prevent_ledger_modification();
create trigger ledger_transactions_no_update
  before update on ledger_transactions
  for each row execute function prevent_ledger_modification();
create trigger ledger_transactions_no_delete
  before delete on ledger_transactions
  for each row execute function prevent_ledger_modification();

-- ── Balances ───────────────────────────────────────────────────────────────
-- The only correct way to read a balance. Flips the sign for credit-normal
-- accounts so every balance is positive in its own terms.

create view ledger_balances as
select
  a.id            as account_id,
  a.tenant_id,
  a.account_type,
  a.card_id,
  a.merchant_id,
  case when a.normal_balance = 'credit'
       then -coalesce(sum(e.amount_cents), 0)
       else  coalesce(sum(e.amount_cents), 0)
  end             as balance_cents
from ledger_accounts a
left join ledger_entries e on e.account_id = a.id
group by a.id, a.tenant_id, a.account_type, a.card_id, a.merchant_id, a.normal_balance;


-- ───────────────────────────────────────────────────────────────────────────
-- SHAPE 3 — AUTHORIZE THEN CAPTURE PARTIAL
--
-- The vendor opens an authorization for the room available, rings the sale,
-- then captures the actual amount. The unused remainder returns to the card.
--
-- This is what makes "room today" possible instead of "insufficient funds",
-- and it is what lets an offline sale be captured late against an
-- authorization that was already recorded.
--
-- Retrofitting this means rewriting the most-tested code in the system.
-- ───────────────────────────────────────────────────────────────────────────

create type authorization_status as enum ('open', 'captured', 'voided', 'expired');

create table authorizations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default default_tenant_id() references tenants(id),
  card_id           uuid not null references cards(id),
  merchant_id       uuid not null references merchants(id),
  authorized_cents  integer not null check (authorized_cents > 0),
  captured_cents    integer not null default 0 check (captured_cents >= 0),
  status            authorization_status not null default 'open',
  credential_kind   credential_kind not null,
  nonce             text not null,
  idempotency_key   text not null unique,
  opened_at         timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '15 minutes'),
  closed_at         timestamptz,

  -- ── Invariant 4, enforced structurally ──────────────────────────────────
  -- Capture can never exceed authorization. This is a CHECK rather than
  -- application logic because it is the single most consequential bound in
  -- the redemption path.
  constraint capture_within_authorization check (captured_cents <= authorized_cents)
);

create index authorizations_card_id_idx on authorizations(card_id);
create index authorizations_merchant_id_idx on authorizations(merchant_id);
create index authorizations_status_idx on authorizations(status);
create index authorizations_expires_at_idx on authorizations(expires_at) where status = 'open';


-- ───────────────────────────────────────────────────────────────────────────
-- CLEARANCE HOLD
--
-- Scrappy Cut §2.4: "72h clearance hold on anonymous gifts."
--
-- Donations land in donor_clearing. A cron releases them to card_float once
-- the hold elapses. Cards are activated from the CLEARED float, never from an
-- individual uncleared gift — so a chargeback lands on the pool rather than
-- on a person standing at a counter with a card that just went dead.
-- ───────────────────────────────────────────────────────────────────────────

alter table donations
  add column is_anonymous      boolean not null default true,
  add column clearance_due_at  timestamptz not null default (now() + interval '72 hours'),
  add column cleared_at        timestamptz,
  add column reversed_at       timestamptz;

create index donations_clearance_due_idx on donations(clearance_due_at) where cleared_at is null;

-- Identified donors (logged in, or gave an email that has transacted before)
-- clear immediately. Anonymous gifts serve the full hold.
update donations set is_anonymous = (donor_user_id is null);


-- ───────────────────────────────────────────────────────────────────────────
-- CREDENTIAL LOOKUP RATE LIMITING
--
-- Scrappy Cut §3a control 2: "Rate-limit lookups per credential and per
-- source. Repeated balance lookups on many different cards from one device,
-- with no redemption following, is the signature of someone other than the
-- member scanning cards. Log it and alert; do not silently block."
--
-- source_hash is a salted hash of IP + user agent. The raw values are never
-- stored — shape decision 8 (collect nothing requiring consent machinery).
-- ───────────────────────────────────────────────────────────────────────────

create table credential_lookups (
  id           bigserial primary key,
  tenant_id    uuid not null default default_tenant_id() references tenants(id),
  card_id      uuid references cards(id),
  source_hash  text not null,
  outcome      text not null check (outcome in ('found', 'not_found', 'rate_limited')),
  looked_up_at timestamptz not null default now()
);

create index credential_lookups_source_idx on credential_lookups(source_hash, looked_up_at desc);
create index credential_lookups_card_idx on credential_lookups(card_id, looked_up_at desc);

-- Retention: these are a security signal, not a member record. 30 days.
create or replace function cleanup_credential_lookups()
returns void as $$
begin
  delete from credential_lookups where looked_up_at < now() - interval '30 days';
end;
$$ language plpgsql security definer;


-- ───────────────────────────────────────────────────────────────────────────
-- CARD BALANCE PROJECTION
--
-- cards.balance_cents is now a PROJECTION of the ledger, not the source of
-- truth. It is maintained inside the same database transaction as the ledger
-- entries by post_ledger_transaction(), and pgTAP invariant 3 asserts it
-- equals a replay of the entries.
--
-- It exists so that reads (member view, admin lists, donor dashboard) do not
-- have to aggregate the ledger on every page load. Nothing may write it
-- except the ledger module.
-- ───────────────────────────────────────────────────────────────────────────

comment on column cards.balance_cents is
  'PROJECTION of the ledger card account. Source of truth is ledger_entries. '
  'Written only by post_ledger_transaction(). Asserted equal by pgTAP invariant 3.';


-- ───────────────────────────────────────────────────────────────────────────
-- THE ONE FUNCTION THAT MOVES MONEY
--
-- Posts a balanced transaction and refreshes any affected card projection,
-- atomically. Raw plpgsql, no ORM (Stack Decision Record §3).
--
-- entries is a jsonb array: [{"account_id": uuid, "amount_cents": bigint}, ...]
-- ───────────────────────────────────────────────────────────────────────────

create or replace function post_ledger_transaction(
  p_kind            ledger_txn_kind,
  p_idempotency_key text,
  p_entries         jsonb,
  p_external_ref    text default null,
  p_memo            text default null
)
returns uuid as $$
declare
  v_txn_id     uuid;
  v_existing   uuid;
  v_entry      jsonb;
  v_sum        bigint := 0;
  v_card_id    uuid;
begin
  -- Idempotency: replaying a key returns the original transaction untouched.
  select id into v_existing
    from ledger_transactions
   where idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_entries) < 2 then
    raise exception 'double-entry requires at least 2 entries, got %',
      jsonb_array_length(p_entries);
  end if;

  -- Pre-flight the sum so the error names the caller's mistake rather than
  -- surfacing as a deferred constraint violation at commit.
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_sum := v_sum + (v_entry->>'amount_cents')::bigint;
  end loop;

  if v_sum <> 0 then
    raise exception 'entries do not balance: sum is % (must be 0)', v_sum;
  end if;

  insert into ledger_transactions (kind, idempotency_key, external_ref, memo)
  values (p_kind, p_idempotency_key, p_external_ref, p_memo)
  returning id into v_txn_id;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    insert into ledger_entries (transaction_id, account_id, amount_cents)
    values (
      v_txn_id,
      (v_entry->>'account_id')::uuid,
      (v_entry->>'amount_cents')::bigint
    );
  end loop;

  -- Refresh the projection for every card account this transaction touched.
  for v_card_id in
    select distinct a.card_id
      from ledger_entries e
      join ledger_accounts a on a.id = e.account_id
     where e.transaction_id = v_txn_id
       and a.card_id is not null
  loop
    update cards c
       set balance_cents = b.balance_cents,
           state = case
             when c.state = 'invalidated' then 'invalidated'
             when c.state = 'expired'     then 'expired'
             when b.balance_cents = 0 and c.state = 'active' then 'exhausted'
             when b.balance_cents > 0 then 'active'
             else c.state
           end
      from ledger_balances b
     where b.card_id = v_card_id
       and c.id = v_card_id;
  end loop;

  return v_txn_id;
end;
$$ language plpgsql volatile security definer;


-- ───────────────────────────────────────────────────────────────────────────
-- ACCOUNT RESOLUTION
--
-- Get-or-create for the account types the app needs. Pooled accounts are
-- singletons per tenant; card and vendor accounts are created on demand.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function ledger_pooled_account(p_type ledger_account_type)
returns uuid as $$
declare
  v_id uuid;
  v_normal text;
begin
  select id into v_id
    from ledger_accounts
   where account_type = p_type
     and tenant_id = default_tenant_id()
     and card_id is null and merchant_id is null;

  if v_id is not null then return v_id; end if;

  v_normal := case p_type
    when 'cash_stripe' then 'debit'
    when 'settled'     then 'debit'
    when 'chargeback'  then 'debit'
    else 'credit'
  end;

  insert into ledger_accounts (account_type, normal_balance)
  values (p_type, v_normal)
  returning id into v_id;

  return v_id;
end;
$$ language plpgsql volatile security definer;

create or replace function ledger_card_account(p_card_id uuid)
returns uuid as $$
declare v_id uuid;
begin
  select id into v_id from ledger_accounts where card_id = p_card_id;
  if v_id is not null then return v_id; end if;

  insert into ledger_accounts (account_type, card_id, normal_balance)
  values ('card', p_card_id, 'credit')
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql volatile security definer;

create or replace function ledger_vendor_account(p_merchant_id uuid)
returns uuid as $$
declare v_id uuid;
begin
  select id into v_id
    from ledger_accounts
   where merchant_id = p_merchant_id and account_type = 'vendor_payable';
  if v_id is not null then return v_id; end if;

  insert into ledger_accounts (account_type, merchant_id, normal_balance)
  values ('vendor_payable', p_merchant_id, 'credit')
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql volatile security definer;


-- ───────────────────────────────────────────────────────────────────────────
-- BACKFILL
--
-- Existing cards carry a balance that predates the ledger. Post it as an
-- opening adjustment so that replay reconciles from row one. Without this,
-- invariant 3 fails on day one and the ledger's whole claim — that balances
-- equal replay — is false from the start.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  v_float uuid;
  v_card  uuid;
begin
  v_float := ledger_pooled_account('card_float');

  for r in select id, balance_cents from cards where balance_cents > 0 loop
    v_card := ledger_card_account(r.id);
    perform post_ledger_transaction(
      'adjustment',
      'opening-balance:' || r.id::text,
      jsonb_build_array(
        jsonb_build_object('account_id', v_float, 'amount_cents',  r.balance_cents),
        jsonb_build_object('account_id', v_card,  'amount_cents', -r.balance_cents)
      ),
      r.id::text,
      'Opening balance carried into the ledger at migration 005'
    );
  end loop;
end $$;
