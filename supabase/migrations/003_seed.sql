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
