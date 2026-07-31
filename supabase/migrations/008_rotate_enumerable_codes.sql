-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 008 — ROTATE ENUMERABLE CARD CODES
--
-- The pilot cards are HMLT-0001 … HMLT-0050. Sequential, and therefore a
-- balance-scanning tool across the whole programme now that /wallet/[code]
-- exists: guess one code and you have guessed all of them.
--
-- Scrappy Cut §3a control 1: "Card codes and credential tokens must be random
-- and non-enumerable."
--
-- This rotates every legacy code to 8 characters of Crockford base32.
--
-- ┌─ ROTATION IS NOT REISSUE ──────────────────────────────────────────────┐
-- │                                                                        │
-- │  Rotating a code changes an IDENTIFIER. The card_id, the ledger        │
-- │  account, and the balance are all untouched — no money moves, and the  │
-- │  ledger is not involved. It is the right operation for a card that is  │
-- │  still in a drawer.                                                    │
-- │                                                                        │
-- │  It is the WRONG operation for a card already in someone's hands: the  │
-- │  code printed on the plastic they are holding would silently stop      │
-- │  working, with no way for them to know why. Those go through           │
-- │  invalidate → reissue instead, which moves the value to a new card.    │
-- │                                                                        │
-- │  So this migration rotates ONLY cards that have never been issued.     │
-- │  Anything already handed out is skipped and reported.                  │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Any card whose code is rotated must be RE-PRINTED before distribution.
-- The mapping below is kept so physical stock can be reconciled and the old
-- printed cards destroyed rather than quietly becoming dead plastic.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- THE MAPPING
--
-- Kept permanently. When someone finds a HMLT-0007 card in a box next year,
-- this table is how they learn it was rotated and destroyed rather than lost.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists card_code_rotations (
  id          bigserial primary key,
  tenant_id   uuid not null default default_tenant_id() references tenants(id),
  card_id     uuid not null references cards(id),
  old_code    text not null,
  new_code    text not null,
  reason      text not null,
  rotated_at  timestamptz not null default now()
);

create index if not exists card_code_rotations_card_idx on card_code_rotations(card_id);
create index if not exists card_code_rotations_old_code_idx on card_code_rotations(old_code);

comment on table card_code_rotations is
  'Old-to-new card code mapping. A rotated card must be re-printed; the old '
  'printed card is dead plastic and should be destroyed. See migration 008.';


-- ───────────────────────────────────────────────────────────────────────────
-- COLLISION-SAFE CODE GENERATION
--
-- generate_card_code() is random, so at scale a collision is possible and at
-- pilot scale it is vanishingly unlikely — but "vanishingly unlikely" is not
-- a thing to leave to chance on a unique column inside a migration that
-- cannot be half-applied.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function generate_unique_card_code(prefix text default 'HMLT')
returns text as $$
declare
  candidate text;
  tries integer := 0;
begin
  loop
    candidate := generate_card_code(prefix);
    exit when not exists (select 1 from cards where card_code = candidate)
          and not exists (select 1 from card_code_rotations where old_code = candidate);

    tries := tries + 1;
    if tries > 50 then
      raise exception 'Could not generate a unique card code after 50 attempts';
    end if;
  end loop;
  return candidate;
end;
$$ language plpgsql volatile;


-- ───────────────────────────────────────────────────────────────────────────
-- ROTATE
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  r          record;
  new_code   text;
  rotated    integer := 0;
  skipped    integer := 0;
  skipped_codes text[] := '{}';
begin
  for r in
    select c.id, c.card_code, c.state
      from cards c
     -- The legacy shape: exactly 4 characters of suffix. New codes are 8.
     where c.card_code ~ '^[A-Z]{4}-[A-Z0-9]{4}$'
     order by c.card_code
  loop
    -- Never rotate a card that has left the building. If an 'issued' event
    -- exists, a human handed this card to a person, and the code on the
    -- plastic in their pocket must keep working.
    if exists (
      select 1 from card_events e
       where e.card_id = r.id and e.event_type = 'issued'
    ) then
      skipped := skipped + 1;
      skipped_codes := skipped_codes || r.card_code;
      continue;
    end if;

    new_code := generate_unique_card_code('HMLT');

    insert into card_code_rotations (card_id, old_code, new_code, reason)
    values (r.id, r.card_code, new_code,
            'Sequential pilot code was enumerable; rotated per Scrappy Cut §3a control 1');

    update cards set card_code = new_code where id = r.id;

    -- Append-only audit. The old code is recorded so chain of custody
    -- survives the rename.
    insert into card_events (card_id, event_type, actor_type, actor_ref, metadata)
    values (r.id, 'created', 'system', 'migration-008',
            jsonb_build_object(
              'action', 'card_code_rotated',
              'old_code', r.card_code,
              'new_code', new_code,
              'reason', 'enumerable sequential code'
            ));

    rotated := rotated + 1;
  end loop;

  raise notice '─────────────────────────────────────────────────────────';
  raise notice 'Card code rotation complete.';
  raise notice '  rotated: %  (these cards MUST be re-printed)', rotated;
  raise notice '  skipped: %  (already issued to a person)', skipped;
  if skipped > 0 then
    raise notice '';
    raise notice 'SKIPPED CODES — these are in someone''s hands and are still';
    raise notice 'enumerable. Put each through invalidate -> reissue so the';
    raise notice 'holder gets a new card carrying the same money:';
    raise notice '  %', array_to_string(skipped_codes, ', ');
  end if;
  raise notice '─────────────────────────────────────────────────────────';
end $$;


-- ───────────────────────────────────────────────────────────────────────────
-- GUARD AGAINST REGRESSION
--
-- Nothing should ever mint a 4-character suffix again. This refuses the
-- write rather than trusting everyone to remember.
--
-- Existing rows are not re-validated (NOT VALID), because any legacy code
-- that survived the loop above did so deliberately — it is on a card in
-- someone's hands and is waiting for invalidate → reissue.
-- ───────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'card_code_not_enumerable'
       and conrelid = 'cards'::regclass
  ) then
    alter table cards
      add constraint card_code_not_enumerable
      check (card_code !~ '^[A-Z]{4}-[A-Z0-9]{4}$')
      not valid;
  end if;
end $$;

comment on constraint card_code_not_enumerable on cards is
  'New card codes carry 8 characters of entropy. Sequential 4-char codes are '
  'a balance-scanning tool across the programme — Scrappy Cut §3a control 1. '
  'NOT VALID: pre-existing issued cards are grandfathered until reissued.';


grant select on card_code_rotations to service_role;
revoke all on card_code_rotations from anon, authenticated;
