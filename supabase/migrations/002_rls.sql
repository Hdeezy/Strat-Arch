-- ─────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────────

create or replace function auth_user_role()
returns user_role as $$
  select role from profiles where user_id = auth.uid()
$$ language sql security definer stable;

create or replace function auth_user_charity_id()
returns uuid as $$
  select charity_id from advocates where user_id = auth.uid() and is_active = true limit 1
$$ language sql security definer stable;

create or replace function auth_user_merchant_id()
returns uuid as $$
  select merchant_id from merchant_staff where user_id = auth.uid() and is_active = true limit 1
$$ language sql security definer stable;

-- ─────────────────────────────────────────────
-- CITIES — public read
-- ─────────────────────────────────────────────

alter table cities enable row level security;

create policy "cities_public_read" on cities
  for select using (true);

create policy "cities_super_admin_all" on cities
  for all using (auth_user_role() = 'super_admin');

-- ─────────────────────────────────────────────
-- CHARITIES — public read of active; admin write
-- ─────────────────────────────────────────────

alter table charities enable row level security;

create policy "charities_public_read_active" on charities
  for select using (is_active = true);

create policy "charities_charity_admin_read" on charities
  for select using (
    auth_user_role() in ('charity_admin', 'super_admin')
  );

create policy "charities_super_admin_all" on charities
  for all using (auth_user_role() = 'super_admin');

-- ─────────────────────────────────────────────
-- MERCHANTS — public read of active; admin write
-- ─────────────────────────────────────────────

alter table merchants enable row level security;

create policy "merchants_public_read_active" on merchants
  for select using (is_active = true);

create policy "merchants_charity_admin_read" on merchants
  for select using (
    auth_user_role() in ('charity_admin', 'super_admin')
    or charity_id = auth_user_charity_id()
  );

create policy "merchants_charity_admin_write" on merchants
  for all using (
    auth_user_role() in ('charity_admin', 'super_admin')
    and (auth_user_role() = 'super_admin' or charity_id = auth_user_charity_id())
  );

-- ─────────────────────────────────────────────
-- CARDS
-- ─────────────────────────────────────────────

alter table cards enable row level security;

-- Super admin: everything
create policy "cards_super_admin_all" on cards
  for all using (auth_user_role() = 'super_admin');

-- Charity admin: own charity
create policy "cards_charity_admin_all" on cards
  for all using (
    auth_user_role() = 'charity_admin'
    and charity_id = auth_user_charity_id()
  );

-- Advocates: read own charity cards, write 'issued' events (via card_events)
create policy "cards_advocate_read" on cards
  for select using (
    auth_user_role() = 'advocate'
    and charity_id = auth_user_charity_id()
  );

-- Merchant staff: read any card (to validate on scan) — write handled via API
create policy "cards_merchant_read" on cards
  for select using (
    auth_user_role() = 'merchant_staff'
  );

-- Donors: read cards they funded
create policy "cards_donor_read" on cards
  for select using (
    auth_user_role() = 'donor'
    and id in (
      select card_id from donations where donor_user_id = auth.uid()
    )
  );

-- Anonymous: read card by card_code (for /donate and /wallet flows via service role)
-- NOTE: anonymous reads go through server-side API routes using service role key, not direct RLS

-- ─────────────────────────────────────────────
-- DONATIONS
-- ─────────────────────────────────────────────

alter table donations enable row level security;

create policy "donations_super_admin_all" on donations
  for all using (auth_user_role() = 'super_admin');

create policy "donations_charity_admin_read" on donations
  for select using (
    auth_user_role() = 'charity_admin'
    and card_id in (
      select id from cards where charity_id = auth_user_charity_id()
    )
  );

create policy "donations_donor_own" on donations
  for select using (
    auth_user_role() = 'donor'
    and donor_user_id = auth.uid()
  );

-- ─────────────────────────────────────────────
-- CARD EVENTS
-- ─────────────────────────────────────────────

alter table card_events enable row level security;

create policy "card_events_super_admin_all" on card_events
  for all using (auth_user_role() = 'super_admin');

create policy "card_events_charity_admin_read" on card_events
  for select using (
    auth_user_role() = 'charity_admin'
    and card_id in (
      select id from cards where charity_id = auth_user_charity_id()
    )
  );

create policy "card_events_advocate_read" on card_events
  for select using (
    auth_user_role() = 'advocate'
    and card_id in (
      select id from cards where charity_id = auth_user_charity_id()
    )
  );

-- Donors can read events for their funded cards (for chain-of-custody display)
create policy "card_events_donor_read" on card_events
  for select using (
    auth_user_role() = 'donor'
    and card_id in (
      select card_id from donations where donor_user_id = auth.uid()
    )
  );

-- Merchant staff can read events for cards they've redeemed
create policy "card_events_merchant_read" on card_events
  for select using (
    auth_user_role() = 'merchant_staff'
    and card_id in (
      select card_id from redemptions where merchant_id = auth_user_merchant_id()
    )
  );

-- ─────────────────────────────────────────────
-- REDEMPTIONS
-- ─────────────────────────────────────────────

alter table redemptions enable row level security;

create policy "redemptions_super_admin_all" on redemptions
  for all using (auth_user_role() = 'super_admin');

create policy "redemptions_charity_admin_read" on redemptions
  for select using (
    auth_user_role() = 'charity_admin'
    and merchant_id in (
      select id from merchants where charity_id = auth_user_charity_id()
    )
  );

create policy "redemptions_merchant_own" on redemptions
  for select using (
    auth_user_role() = 'merchant_staff'
    and merchant_id = auth_user_merchant_id()
  );

create policy "redemptions_donor_read" on redemptions
  for select using (
    auth_user_role() = 'donor'
    and card_id in (
      select card_id from donations where donor_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- ADVOCATES
-- ─────────────────────────────────────────────

alter table advocates enable row level security;

create policy "advocates_super_admin_all" on advocates
  for all using (auth_user_role() = 'super_admin');

create policy "advocates_charity_admin_own" on advocates
  for all using (
    auth_user_role() = 'charity_admin'
    and charity_id = auth_user_charity_id()
  );

create policy "advocates_self_read" on advocates
  for select using (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────

alter table profiles enable row level security;

create policy "profiles_self_read" on profiles
  for select using (user_id = auth.uid());

create policy "profiles_self_update" on profiles
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and role = (select role from profiles where user_id = auth.uid())
  );

create policy "profiles_super_admin_all" on profiles
  for all using (auth_user_role() = 'super_admin');

create policy "profiles_charity_admin_read" on profiles
  for select using (
    auth_user_role() in ('charity_admin', 'advocate', 'merchant_staff')
  );

-- ─────────────────────────────────────────────
-- USED NONCES — service role only
-- ─────────────────────────────────────────────

alter table used_nonces enable row level security;

create policy "used_nonces_super_admin_all" on used_nonces
  for all using (auth_user_role() = 'super_admin');

-- ─────────────────────────────────────────────
-- MERCHANT STAFF
-- ─────────────────────────────────────────────

alter table merchant_staff enable row level security;

create policy "merchant_staff_super_admin_all" on merchant_staff
  for all using (auth_user_role() = 'super_admin');

create policy "merchant_staff_charity_admin_own" on merchant_staff
  for all using (
    auth_user_role() = 'charity_admin'
    and merchant_id in (
      select id from merchants where charity_id = auth_user_charity_id()
    )
  );

create policy "merchant_staff_self_read" on merchant_staff
  for select using (user_id = auth.uid());
