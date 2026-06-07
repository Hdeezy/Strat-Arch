-- pgTAP test: verify all tables, enums, columns, constraints, and indexes
-- Run with: supabase test db
-- or manually: psql $DATABASE_URL -f supabase/tests/01_schema_verification.sql

begin;

select plan(42);

-- ─── Tables ──────────────────────────────────────────────────────────────────

select has_table('public', 'cities',         'cities table exists');
select has_table('public', 'charities',      'charities table exists');
select has_table('public', 'merchants',      'merchants table exists');
select has_table('public', 'cards',          'cards table exists');
select has_table('public', 'donations',      'donations table exists');
select has_table('public', 'card_events',    'card_events table exists');
select has_table('public', 'redemptions',    'redemptions table exists');
select has_table('public', 'advocates',      'advocates table exists');
select has_table('public', 'profiles',       'profiles table exists');
select has_table('public', 'used_nonces',    'used_nonces table exists');
select has_table('public', 'merchant_staff', 'merchant_staff table exists');

-- ─── Enums ───────────────────────────────────────────────────────────────────

select has_type('public', 'card_state',        'card_state enum exists');
select has_type('public', 'card_category',     'card_category enum exists');
select has_type('public', 'card_event_type',   'card_event_type enum exists');
select has_type('public', 'actor_type',        'actor_type enum exists');
select has_type('public', 'redemption_status', 'redemption_status enum exists');
select has_type('public', 'user_role',         'user_role enum exists');

-- ─── Critical columns ────────────────────────────────────────────────────────

select has_column('public', 'cards',       'balance_cents',       'cards.balance_cents exists');
select has_column('public', 'cards',       'allowed_categories',  'cards.allowed_categories exists');
select has_column('public', 'cards',       'daily_cap_cents',     'cards.daily_cap_cents exists');
select has_column('public', 'cards',       'spent_today_cents',   'cards.spent_today_cents exists');
select has_column('public', 'cards',       'last_spent_reset_at', 'cards.last_spent_reset_at exists');
select has_column('public', 'redemptions', 'idempotency_key',     'redemptions.idempotency_key exists');
select has_column('public', 'redemptions', 'nonce',               'redemptions.nonce exists');
select has_column('public', 'used_nonces', 'expires_at',          'used_nonces.expires_at exists');
select has_column('public', 'donations',   'donor_note',          'donations.donor_note exists');

-- ─── NOT NULL constraints ────────────────────────────────────────────────────

select col_not_null('public', 'cards', 'balance_cents', 'cards.balance_cents is NOT NULL');
select col_not_null('public', 'cards', 'state',         'cards.state is NOT NULL');
select col_not_null('public', 'cards', 'card_code',     'cards.card_code is NOT NULL');

-- ─── Unique constraints ──────────────────────────────────────────────────────

select col_is_unique('public', 'cards',       array['card_code'],               'cards.card_code is unique');
select col_is_unique('public', 'redemptions', array['idempotency_key'],          'redemptions.idempotency_key is unique');
select col_is_unique('public', 'donations',   array['stripe_payment_intent_id'], 'donations.stripe_payment_intent_id is unique');

-- ─── Indexes ─────────────────────────────────────────────────────────────────

select has_index('public', 'cards',        'cards_card_code_idx',              'cards has card_code index');
select has_index('public', 'cards',        'cards_state_idx',                  'cards has state index');
select has_index('public', 'card_events',  'card_events_card_id_idx',          'card_events has card_id index');
select has_index('public', 'card_events',  'card_events_occurred_at_idx',      'card_events has occurred_at index');
select has_index('public', 'redemptions',  'redemptions_idempotency_key_idx',  'redemptions has idempotency_key index');
select has_index('public', 'used_nonces',  'used_nonces_expires_at_idx',       'used_nonces has expires_at index');

-- ─── Functions ───────────────────────────────────────────────────────────────

select has_function('public', 'cleanup_expired_nonces', 'cleanup_expired_nonces() function exists');
select has_function('public', 'auth_user_role',         'auth_user_role() function exists');
select has_function('public', 'auth_user_charity_id',   'auth_user_charity_id() function exists');
select has_function('public', 'auth_user_merchant_id',  'auth_user_merchant_id() function exists');

select * from finish();
rollback;
