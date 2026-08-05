-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 009 — FIX ACCOUNT CREATION
--
-- Symptom: creating any user in the Supabase dashboard fails with
--   "Database error saving new user"
--
-- Cause: 002_rls.sql enables row level security on `profiles` and adds
-- policies for SELECT, UPDATE, and a super_admin ALL — but no INSERT policy
-- anyone can satisfy at signup time.
--
-- `handle_new_user()` fires on every insert into auth.users and inserts a
-- profile row. It is SECURITY DEFINER, so it runs as its owner — and on
-- Supabase that owner does not bypass RLS. The insert is refused, the
-- trigger raises, and the whole auth.users insert rolls back. No account.
--
-- The super_admin ALL policy cannot help: it tests auth_user_role(), which
-- reads the profiles row that does not exist yet. Chicken and egg.
--
-- Reproduced against Postgres 16 with a non-superuser, non-bypassrls owner:
--   ERROR: new row violates row-level security policy for table "profiles"
--   CONTEXT: PL/pgSQL function handle_new_user() line 3
--
-- Two independent fixes, because account creation is not a thing that
-- should have a single point of failure:
--   1. An INSERT policy, so the normal path works.
--   2. An exception handler, so that even if a future policy change breaks
--      the insert again, signup still succeeds.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. A signup can create its own profile
--
-- Deliberately narrow. `user_id = auth.uid()` stops one user minting a
-- profile for another, and `role = 'donor'` stops anyone self-issuing
-- charity_admin. Those two clauses are the whole security value of this
-- policy — do not loosen either to 'true' to make something else work.
--
-- Role escalation stays where it belongs: an existing admin, or the
-- scripts/make-me-admin.sh path.
-- ───────────────────────────────────────────────────────────────────────────

drop policy if exists "profiles_insert_self" on profiles;

create policy "profiles_insert_self" on profiles
  for insert
  with check (user_id = auth.uid() and role = 'donor');


-- ───────────────────────────────────────────────────────────────────────────
-- 2. A profile-row problem must never cost someone their account
--
-- The profile row is a convenience: a place to hang a display name and a
-- role. auth.users is the account. Letting a failure in the former destroy
-- the latter is backwards, and it produces exactly the error message that
-- started this — one that names the database but not the cause.
--
-- If the insert cannot happen, the account is still created and a warning
-- goes to the Postgres log. scripts/make-me-admin.sh upserts the profile,
-- so the recovery path already exists.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
-- Pin the search path: a SECURITY DEFINER function without one can be
-- hijacked by a caller who puts a lookalike `profiles` earlier in theirs.
set search_path = public
as $$
begin
  insert into profiles (user_id, role)
  values (new.id, 'donor')
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    raise warning 'handle_new_user could not create a profile for % — account still created. Reason: %',
      new.id, sqlerrm;
    return new;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Let the auth service reach the table at all
--
-- supabase_auth_admin is the role Supabase Auth connects as. It needs to be
-- able to see the public schema for the trigger to resolve, and the trigger
-- needs to be able to write the row. Guarded because the role does not
-- exist on a plain Postgres instance, only on Supabase.
-- ───────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant select, insert on public.profiles to supabase_auth_admin;
    grant select on public.tenants to supabase_auth_admin;
  end if;
end $$;


comment on function handle_new_user() is
  'Creates a donor profile when an account is created. Never raises: a '
  'failure here logs a warning and lets the account through. See migration '
  '009 — a raising version of this made every signup fail with "Database '
  'error saving new user".';
