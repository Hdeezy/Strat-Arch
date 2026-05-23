-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────

create type card_state as enum (
  'unloaded', 'active', 'exhausted', 'invalidated', 'expired'
);

create type card_category as enum (
  'food', 'transit', 'clothing', 'hygiene', 'shelter', 'multi'
);

create type card_event_type as enum (
  'created', 'loaded', 'issued',
  'redemption_attempted', 'redemption_succeeded', 'redemption_failed',
  'invalidated', 'expired'
);

create type actor_type as enum (
  'system', 'donor', 'advocate', 'merchant', 'admin'
);

create type redemption_status as enum (
  'pending', 'succeeded', 'failed', 'refunded'
);

create type user_role as enum (
  'donor', 'advocate', 'merchant_staff', 'charity_admin', 'super_admin'
);

-- ─────────────────────────────────────────────
-- CITIES
-- ─────────────────────────────────────────────

create table cities (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  province    text not null,
  country     text not null default 'Canada',
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- CHARITIES
-- ─────────────────────────────────────────────

create table charities (
  id                          uuid primary key default uuid_generate_v4(),
  city_id                     uuid not null references cities(id),
  name                        text not null,
  cra_registration            text,
  contact_email               text not null,
  stripe_connect_account_id   text,
  bank_designated_account_ref text,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now()
);

create index charities_city_id_idx on charities(city_id);

-- ─────────────────────────────────────────────
-- MERCHANTS
-- ─────────────────────────────────────────────

create table merchants (
  id                          uuid primary key default uuid_generate_v4(),
  city_id                     uuid not null references cities(id),
  charity_id                  uuid not null references charities(id),
  name                        text not null,
  address                     text not null,
  lat                         double precision,
  lng                         double precision,
  category                    card_category not null,
  stripe_connect_account_id   text,
  payout_schedule_days        integer not null default 7,
  is_active                   boolean not null default true,
  trust_score                 double precision not null default 0.5,
  created_at                  timestamptz not null default now()
);

create index merchants_city_id_idx on merchants(city_id);
create index merchants_charity_id_idx on merchants(charity_id);

-- ─────────────────────────────────────────────
-- CARDS
-- ─────────────────────────────────────────────

create table cards (
  id                    uuid primary key default uuid_generate_v4(),
  city_id               uuid not null references cities(id),
  charity_id            uuid not null references charities(id),
  card_code             text not null unique,
  state                 card_state not null default 'unloaded',
  balance_cents         integer not null default 0 check (balance_cents >= 0),
  allowed_categories    card_category[] not null default array['food','transit','clothing','hygiene']::card_category[],
  daily_cap_cents       integer not null default 2000,
  spent_today_cents     integer not null default 0 check (spent_today_cents >= 0),
  last_spent_reset_at   timestamptz not null default now(),
  signed_payload        text,
  created_at            timestamptz not null default now()
);

create index cards_city_id_idx on cards(city_id);
create index cards_charity_id_idx on cards(charity_id);
create index cards_card_code_idx on cards(card_code);
create index cards_state_idx on cards(state);

-- ─────────────────────────────────────────────
-- DONATIONS
-- ─────────────────────────────────────────────

create table donations (
  id                        uuid primary key default uuid_generate_v4(),
  card_id                   uuid not null references cards(id),
  donor_user_id             uuid references auth.users(id),
  donor_email               text,
  amount_cents              integer not null check (amount_cents > 0),
  stripe_payment_intent_id  text not null unique,
  stripe_receipt_url        text,
  donor_note                text check (char_length(donor_note) <= 140),
  receipt_requested         boolean not null default false,
  receipt_issued_at         timestamptz,
  created_at                timestamptz not null default now()
);

create index donations_card_id_idx on donations(card_id);
create index donations_donor_user_id_idx on donations(donor_user_id);
create index donations_stripe_payment_intent_idx on donations(stripe_payment_intent_id);

-- ─────────────────────────────────────────────
-- CARD EVENTS (append-only audit trail)
-- ─────────────────────────────────────────────

create table card_events (
  id          uuid primary key default uuid_generate_v4(),
  card_id     uuid not null references cards(id),
  event_type  card_event_type not null,
  actor_type  actor_type not null,
  actor_ref   text not null,
  metadata    jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index card_events_card_id_idx on card_events(card_id);
create index card_events_occurred_at_idx on card_events(occurred_at);

-- Prevent updates and deletes on card_events
create or replace function prevent_card_events_modification()
returns trigger as $$
begin
  raise exception 'card_events is append-only: updates and deletes are not permitted';
end;
$$ language plpgsql;

create trigger card_events_no_update
  before update on card_events
  for each row execute function prevent_card_events_modification();

create trigger card_events_no_delete
  before delete on card_events
  for each row execute function prevent_card_events_modification();

-- ─────────────────────────────────────────────
-- REDEMPTIONS
-- ─────────────────────────────────────────────

create table redemptions (
  id               uuid primary key default uuid_generate_v4(),
  card_id          uuid not null references cards(id),
  merchant_id      uuid not null references merchants(id),
  amount_cents     integer not null check (amount_cents > 0),
  status           redemption_status not null default 'pending',
  failure_reason   text,
  idempotency_key  text not null unique,
  nonce            text not null,
  occurred_at      timestamptz not null default now()
);

create index redemptions_card_id_idx on redemptions(card_id);
create index redemptions_merchant_id_idx on redemptions(merchant_id);
create index redemptions_occurred_at_idx on redemptions(occurred_at);
create index redemptions_idempotency_key_idx on redemptions(idempotency_key);

-- ─────────────────────────────────────────────
-- ADVOCATES
-- ─────────────────────────────────────────────

create table advocates (
  id          uuid primary key default uuid_generate_v4(),
  charity_id  uuid not null references charities(id),
  user_id     uuid not null references auth.users(id),
  full_name   text not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(charity_id, user_id)
);

create index advocates_charity_id_idx on advocates(charity_id);
create index advocates_user_id_idx on advocates(user_id);

-- ─────────────────────────────────────────────
-- PROFILES (extends auth.users)
-- ─────────────────────────────────────────────

create table profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'donor',
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (user_id, role)
  values (new.id, 'donor');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─────────────────────────────────────────────
-- USED NONCES (replay prevention, short TTL)
-- ─────────────────────────────────────────────

create table used_nonces (
  nonce       text primary key,
  card_id     uuid not null references cards(id),
  used_at     timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '10 minutes')
);

create index used_nonces_expires_at_idx on used_nonces(expires_at);

-- Cleanup function for expired nonces
create or replace function cleanup_expired_nonces()
returns void as $$
begin
  delete from used_nonces where expires_at < now();
end;
$$ language plpgsql security definer;

-- ─────────────────────────────────────────────
-- MERCHANT STAFF (maps user to merchant)
-- ─────────────────────────────────────────────

create table merchant_staff (
  id          uuid primary key default uuid_generate_v4(),
  merchant_id uuid not null references merchants(id),
  user_id     uuid not null references auth.users(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(merchant_id, user_id)
);

create index merchant_staff_merchant_id_idx on merchant_staff(merchant_id);
create index merchant_staff_user_id_idx on merchant_staff(user_id);
