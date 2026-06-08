-- pgTAP test: verify card_events is append-only (trigger blocks UPDATE & DELETE)
-- and verify seed data is correct
-- Run with: supabase test db

begin;

select plan(12);

-- ─── Trigger existence ───────────────────────────────────────────────────────

select has_trigger('public', 'card_events', 'card_events_no_update',
  'card_events_no_update trigger exists');

select has_trigger('public', 'card_events', 'card_events_no_delete',
  'card_events_no_delete trigger exists');

-- ─── Append-only enforcement ─────────────────────────────────────────────────

-- Grab an existing card_event id for the update/delete tests
do $$
begin
  if not exists (select 1 from card_events limit 1) then
    -- Insert a synthetic event if seed hasn't run
    insert into card_events (card_id, event_type, actor_type, actor_ref)
    select id, 'created', 'system', 'pgtap-setup'
    from cards limit 1;
  end if;
end $$;

select throws_ok(
  $$ update card_events set metadata = '{"test":true}'::jsonb
     where id = (select id from card_events limit 1) $$,
  'P0001',
  'card_events is append-only: updates and deletes are not permitted',
  'UPDATE on card_events raises append-only exception'
);

select throws_ok(
  $$ delete from card_events
     where id = (select id from card_events limit 1) $$,
  'P0001',
  'card_events is append-only: updates and deletes are not permitted',
  'DELETE on card_events raises append-only exception'
);

-- ─── Seed data verification ──────────────────────────────────────────────────

select ok(
  exists(select 1 from cities where name = 'Hamilton' and province = 'Ontario'),
  'Hamilton, Ontario seed city exists'
);

select ok(
  exists(select 1 from charities where name like 'Living Rock%'),
  'Living Rock charity seed exists'
);

select ok(
  exists(select 1 from charities where name like 'Helping Hands%'),
  'Helping Hands charity seed exists'
);

select ok(
  exists(select 1 from merchants where name = '541 Eatery & Exchange' and category = 'food'),
  '541 Eatery & Exchange merchant seed exists'
);

select is(
  (select count(*)::int from cards where card_code like 'HMLT-%' and state = 'unloaded'),
  50,
  '50 unloaded HMLT cards seeded'
);

select ok(
  exists(select 1 from cards where card_code = 'HMLT-0001'),
  'HMLT-0001 card exists'
);

select ok(
  exists(select 1 from cards where card_code = 'HMLT-0050'),
  'HMLT-0050 card exists'
);

-- All seeded cards should have a 'created' event in card_events
select ok(
  (select count(distinct card_id)::int
   from card_events
   where event_type = 'created'
   and card_id in (select id from cards where card_code like 'HMLT-%')) = 50,
  'All 50 seeded cards have a created event in card_events'
);

select * from finish();
rollback;
