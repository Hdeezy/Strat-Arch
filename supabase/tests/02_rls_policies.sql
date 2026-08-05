-- pgTAP test: verify RLS is enabled and all named policies exist
-- Run with: supabase test db

begin;

select plan(38);

-- ─── RLS enabled on all tables ───────────────────────────────────────────────

select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'cards' and n.nspname = 'public'),
  'RLS enabled on cards'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'donations' and n.nspname = 'public'),
  'RLS enabled on donations'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'card_events' and n.nspname = 'public'),
  'RLS enabled on card_events'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'redemptions' and n.nspname = 'public'),
  'RLS enabled on redemptions'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'advocates' and n.nspname = 'public'),
  'RLS enabled on advocates'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'used_nonces' and n.nspname = 'public'),
  'RLS enabled on used_nonces'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'merchant_staff' and n.nspname = 'public'),
  'RLS enabled on merchant_staff'
);

-- ─── Helper: policy existence check ─────────────────────────────────────────

create or replace function _policy_exists(tbl text, policy text)
returns boolean as $$
  select exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = tbl and policyname = policy
  );
$$ language sql;

-- ─── Cards policies ──────────────────────────────────────────────────────────

select ok(_policy_exists('cards', 'cards_super_admin_all'),    'cards_super_admin_all policy exists');
select ok(_policy_exists('cards', 'cards_charity_admin_all'),  'cards_charity_admin_all policy exists');
select ok(_policy_exists('cards', 'cards_advocate_read'),      'cards_advocate_read policy exists');
select ok(_policy_exists('cards', 'cards_merchant_read'),      'cards_merchant_read policy exists');
select ok(_policy_exists('cards', 'cards_donor_read'),         'cards_donor_read policy exists');

-- ─── Donations policies ──────────────────────────────────────────────────────

select ok(_policy_exists('donations', 'donations_super_admin_all'),   'donations_super_admin_all policy exists');
select ok(_policy_exists('donations', 'donations_charity_admin_read'), 'donations_charity_admin_read policy exists');
select ok(_policy_exists('donations', 'donations_donor_own'),          'donations_donor_own policy exists');

-- ─── Card events policies ────────────────────────────────────────────────────

select ok(_policy_exists('card_events', 'card_events_super_admin_all'),    'card_events_super_admin_all policy exists');
select ok(_policy_exists('card_events', 'card_events_charity_admin_read'), 'card_events_charity_admin_read policy exists');
select ok(_policy_exists('card_events', 'card_events_advocate_read'),      'card_events_advocate_read policy exists');
select ok(_policy_exists('card_events', 'card_events_donor_read'),         'card_events_donor_read policy exists');
select ok(_policy_exists('card_events', 'card_events_merchant_read'),      'card_events_merchant_read policy exists');

-- ─── Redemptions policies ────────────────────────────────────────────────────

select ok(_policy_exists('redemptions', 'redemptions_super_admin_all'),    'redemptions_super_admin_all policy exists');
select ok(_policy_exists('redemptions', 'redemptions_charity_admin_read'), 'redemptions_charity_admin_read policy exists');
select ok(_policy_exists('redemptions', 'redemptions_merchant_own'),       'redemptions_merchant_own policy exists');
select ok(_policy_exists('redemptions', 'redemptions_donor_read'),         'redemptions_donor_read policy exists');

-- ─── Advocates policies ──────────────────────────────────────────────────────

select ok(_policy_exists('advocates', 'advocates_super_admin_all'),   'advocates_super_admin_all policy exists');
select ok(_policy_exists('advocates', 'advocates_charity_admin_own'), 'advocates_charity_admin_own policy exists');
select ok(_policy_exists('advocates', 'advocates_self_read'),         'advocates_self_read policy exists');

-- ─── Profiles policies ──────────────────────────────────────────────────────

select ok(_policy_exists('profiles', 'profiles_self_read'),        'profiles_self_read policy exists');
select ok(_policy_exists('profiles', 'profiles_self_update'),      'profiles_self_update policy exists');
select ok(_policy_exists('profiles', 'profiles_super_admin_all'),  'profiles_super_admin_all policy exists');
select ok(_policy_exists('profiles', 'profiles_charity_admin_read'), 'profiles_charity_admin_read policy exists');

-- ─── Merchant staff policies ─────────────────────────────────────────────────

select ok(_policy_exists('merchant_staff', 'merchant_staff_super_admin_all'),    'merchant_staff_super_admin_all policy exists');
select ok(_policy_exists('merchant_staff', 'merchant_staff_charity_admin_own'),  'merchant_staff_charity_admin_own policy exists');
select ok(_policy_exists('merchant_staff', 'merchant_staff_self_read'),          'merchant_staff_self_read policy exists');

-- ─── Used nonces policy ──────────────────────────────────────────────────────

select ok(_policy_exists('used_nonces', 'used_nonces_super_admin_all'), 'used_nonces_super_admin_all policy exists');

-- ─── Self-escalation guard: profiles.role cannot be changed by the user ──────
-- The profiles_self_update policy has a WITH CHECK clause that prevents
-- a user from promoting their own role. Verify the policy has a check clause.
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'profiles_self_update'
    and qual is not null     -- USING clause
    and with_check is not null  -- WITH CHECK clause
  ),
  'profiles_self_update has both USING and WITH CHECK to block role self-escalation'
);

select * from finish();
rollback;
