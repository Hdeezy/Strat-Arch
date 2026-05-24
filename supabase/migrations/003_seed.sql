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
-- SEED: 50 unloaded cards HMLT-0001 through HMLT-0050
-- ─────────────────────────────────────────────

do $$
declare
  i integer;
  card_code_val text;
begin
  for i in 1..50 loop
    card_code_val := 'HMLT-' || lpad(i::text, 4, '0');
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

-- ─────────────────────────────────────────────
-- SEED: Advocate users (dev only)
-- Two placeholder auth users so the advocate portal
-- works immediately after `supabase db push` without
-- requiring manual signup. Passwords are fixed test
-- values — change before any shared/staging environment.
-- ─────────────────────────────────────────────

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
