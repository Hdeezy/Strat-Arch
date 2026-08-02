-- ─────────────────────────────────────────────
-- SEED: Hamilton, ON
-- ─────────────────────────────────────────────

insert into cities (id, name, province, country)
values (
  '00000000-0000-0000-0000-000000000001',
  'Hamilton',
  'Ontario',
  'Canada'
);

-- ─────────────────────────────────────────────
-- SEED: Charities
-- ─────────────────────────────────────────────

insert into charities (id, city_id, name, cra_registration, contact_email)
values
  (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',
    'Living Rock Ministries (Pilot)',
    '123456789RR0001',
    'admin@livingrock.ca'
  ),
  (
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    'Helping Hands Hamilton',
    '987654321RR0001',
    'admin@helpinghandshamilton.ca'
  );

-- ─────────────────────────────────────────────
-- SEED: Merchant — 541 Eatery & Exchange
-- ─────────────────────────────────────────────

insert into merchants (id, city_id, charity_id, name, address, lat, lng, category)
values (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '541 Eatery & Exchange',
  '541 Barton St E, Hamilton ON L8L 2Y6',
  43.2557,
  -79.8415,
  'food'
);

-- ─────────────────────────────────────────────
-- NON-ENUMERABLE CARD CODES
--
-- Defined here, at the earliest point of need, because the seed below uses
-- it. Migration 005 documents the reasoning and 008 uses it to rotate any
-- database that ran the ORIGINAL version of this file.
--
-- 8 characters of Crockford base32 with the ambiguous glyphs (I, L, O, U)
-- removed, about 40 bits.
-- ─────────────────────────────────────────────

create or replace function generate_card_code(prefix text default 'HMLT')
returns text as $$
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
$$ language plpgsql volatile;

-- ─────────────────────────────────────────────
-- SEED: 50 unloaded cards with non-enumerable codes
--
-- This used to emit HMLT-0001 … HMLT-0050 via lpad(). Sequential codes make
-- /wallet/[code] a balance-scanning tool across the whole programme: guess
-- one and you have guessed all fifty. Scrappy Cut §3a control 1 prohibits
-- exactly this, and seeding it here meant every fresh database shipped the
-- vulnerability.
--
-- Databases that already ran the old version of this file are fixed by
-- migration 008, which rotates the codes in place. This fixes the source so
-- 008 is only ever needed once.
-- ─────────────────────────────────────────────

do $$
declare
  i integer;
  card_code_val text;
begin
  for i in 1..50 loop
    -- Retry on the vanishingly unlikely collision rather than aborting the
    -- whole seed on a unique violation.
    loop
      card_code_val := generate_card_code('HMLT');
      exit when not exists (select 1 from cards where card_code = card_code_val);
    end loop;
    insert into cards (
      city_id,
      charity_id,
      card_code,
      state,
      balance_cents,
      allowed_categories
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000010',
      card_code_val,
      'unloaded',
      0,
      array['food','transit','clothing','hygiene']::card_category[]
    );
  end loop;
end $$;

-- Log creation events for all seeded cards
insert into card_events (card_id, event_type, actor_type, actor_ref, metadata)
select
  id,
  'created',
  'system',
  'seed',
  jsonb_build_object('seed', true, 'card_code', card_code)
from cards
where card_code like 'HMLT-%';

-- ═════════════════════════════════════════════════════════════════════════
-- SEED: Advocate users — LOCAL DEVELOPMENT ONLY, OFF BY DEFAULT
--
-- These two accounts have bcrypt hashes of publicly-known passwords
-- ('hope-dev-password-1' and '-2') and advocate privileges, which means the
-- ability to load and invalidate cards. The previous version of this file
-- inserted them unconditionally, so `supabase db push` against ANY project —
-- including one about to take real donations — planted two known-password
-- accounts with access to the money path.
--
-- They are now gated behind an explicit opt-in. To seed them locally:
--
--   psql "$DATABASE_URL" -c "set hope.seed_dev_users = 'on'" \
--        -f supabase/migrations/003_seed.sql
--
-- or inside a session:  set hope.seed_dev_users = 'on';
--
-- Without that setting the block is skipped and the migration succeeds
-- normally. Never set it on a shared or production project.
-- ═════════════════════════════════════════════════════════════════════════

do $seed_users$
begin
if coalesce(current_setting('hope.seed_dev_users', true), 'off') <> 'on' then
  raise notice 'Skipping dev advocate users (set hope.seed_dev_users = ''on'' to seed them locally).';
  return;
end if;

insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  role,
  aud,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'advocate1@livingrock.ca',
    -- bcrypt of 'hope-dev-password-1' (cost 10)
    '$2a$10$PkMDv3vSAXPIWxUbvZ2K2.U8n7OxGxQeU9zHk3yLmJWVn6X1FhB0i',
    now(),
    'authenticated',
    'authenticated',
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    '',
    '',
    '',
    ''
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'advocate2@helpinghandshamilton.ca',
    -- bcrypt of 'hope-dev-password-2' (cost 10)
    '$2a$10$QlNEw4wTBYQJXwVcAZPL3.V9o8PyHyRfV0aIl4zMnKXWo7Y2GiC1j',
    now(),
    'authenticated',
    'authenticated',
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    '',
    '',
    '',
    ''
  );

-- Profiles (auto-created by trigger in production;
-- inserted explicitly here so seed is idempotent via supabase db reset)
insert into profiles (user_id, role, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'advocate', 'Alex Rivera'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'advocate', 'Jordan Lee')
on conflict (user_id) do update set role = excluded.role, full_name = excluded.full_name;

-- Advocate rows — one per charity to test cross-tenant RLS scoping
insert into advocates (id, charity_id, user_id, full_name, phone) values
  (
    'bbbbbbbb-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',  -- Living Rock
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Alex Rivera',
    '905-555-0101'
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000011',  -- Helping Hands
    'aaaaaaaa-0000-0000-0000-000000000002',
    'Jordan Lee',
    '905-555-0102'
  );

raise notice 'Seeded 2 DEV advocate users with publicly-known passwords. Local use only.';
end
$seed_users$;
