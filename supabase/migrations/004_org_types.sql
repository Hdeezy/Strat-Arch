-- Migration 004: organization type model
-- Allows charities, sponsor pass-through orgs, and direct-executive orgs to coexist
-- in the same system. The donor UI hides the tax-receipt toggle when
-- receives_tax_receipts = false.

create type organization_type as enum (
  'charity',       -- CRA-registered, full tax receipts (e.g. Living Rock)
  'sponsor_org',   -- Pass-through sponsor, no CRA number, no formal receipt
  'direct'         -- Executive/direct giving, no intermediary, no receipt
);

alter table charities
  add column org_type         organization_type not null default 'charity',
  add column receives_tax_receipts boolean not null default true;

-- Back-fill: rows with a cra_registration are charitable; those without are not
update charities
  set org_type = 'charity', receives_tax_receipts = true
  where cra_registration is not null;

update charities
  set org_type = 'sponsor_org', receives_tax_receipts = false
  where cra_registration is null;

-- Add org_type to the super_admin write policy (no schema change needed —
-- the existing super_admin_all policy on charities already covers this column).
