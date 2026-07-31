-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 006 — GRANTS
--
-- Stack Decision Record §4 rule 2: "db/grants.sql revokes UPDATE and DELETE
-- on ledger tables from the application role. Convention is insufficient;
-- make the mutation impossible."
--
-- This lives in migrations/ rather than a bare db/grants.sql so that it runs
-- in the migration chain and cannot be forgotten on a fresh environment.
-- Recorded in DECISIONS.md.
--
-- Supabase roles:
--   anon           — unauthenticated requests through PostgREST
--   authenticated  — signed-in users through PostgREST
--   service_role   — the server-side admin client. BYPASSRLS, but grants
--                    still apply, which is exactly what we need here: the
--                    service role is powerful enough to be the real risk.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- THE LEDGER IS APPEND-ONLY, AT THE DATABASE LEVEL
--
-- The application can insert. It can never update or delete. Financial
-- history that has been written stays written, including by the code path
-- that made a mistake writing it. Corrections are new compensating
-- transactions, never edits.
-- ───────────────────────────────────────────────────────────────────────────

revoke update, delete, truncate on ledger_entries      from anon, authenticated, service_role;
revoke update, delete, truncate on ledger_transactions from anon, authenticated, service_role;
revoke update, delete, truncate on card_events         from anon, authenticated, service_role;

-- Reads and appends stay available to the server-side client.
grant select, insert on ledger_entries      to service_role;
grant select, insert on ledger_transactions to service_role;
grant select, insert on card_events         to service_role;
grant select          on ledger_balances    to service_role;
grant select, insert  on ledger_accounts    to service_role;

-- The ledger is never readable directly by a browser session. Every read
-- goes through a server route that decides what that caller may see.
revoke all on ledger_entries      from anon, authenticated;
revoke all on ledger_transactions from anon, authenticated;
revoke all on ledger_accounts     from anon, authenticated;
revoke all on ledger_balances     from anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- DONATIONS AND AUTHORIZATIONS ARE NOT DELETABLE
--
-- Authorizations must be updatable — captured_cents and status change as the
-- authorization progresses — but the row can never disappear. The
-- capture_within_authorization CHECK bounds what an update may do.
-- ───────────────────────────────────────────────────────────────────────────

revoke delete, truncate on donations      from anon, authenticated, service_role;
revoke delete, truncate on authorizations from anon, authenticated, service_role;
revoke delete, truncate on redemptions    from anon, authenticated, service_role;

grant select, insert, update on authorizations to service_role;
grant select, insert, update on donations      to service_role;
grant select, insert, update on redemptions    to service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- CARDS
--
-- balance_cents is a projection maintained by post_ledger_transaction(),
-- which is SECURITY DEFINER and therefore runs as the function owner rather
-- than the caller. That is what lets us keep the app's own UPDATE on cards
-- narrow while still allowing the ledger to refresh the projection.
--
-- A column-level revoke on balance_cents would be the stronger control, but
-- it breaks the SECURITY DEFINER path under some Supabase role
-- configurations. The enforced control is pgTAP invariant 3: the projection
-- must equal a replay of the ledger. Drift is caught in CI and nightly,
-- rather than prevented at write time. Recorded as a known gap in
-- DECISIONS.md and THREAT-MODEL.md.
-- ───────────────────────────────────────────────────────────────────────────

revoke delete, truncate on cards from anon, authenticated, service_role;
grant select, insert, update on cards to service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- LOOKUP LOG
--
-- Insert-only from the app. It is a security signal; the app has no reason
-- to rewrite it. Pruned by cleanup_credential_lookups() on the nightly cron,
-- which is SECURITY DEFINER.
-- ───────────────────────────────────────────────────────────────────────────

revoke update, delete, truncate on credential_lookups from anon, authenticated, service_role;
grant select, insert on credential_lookups to service_role;
revoke all on credential_lookups from anon, authenticated;
