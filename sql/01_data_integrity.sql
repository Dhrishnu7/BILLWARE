-- ============================================================================
-- 01_data_integrity.sql   ·   Billware / MM Pakkam
-- SAFE TO RUN NOW. Non-breaking. Protects against DATA LOSS/corruption.
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- ----------------------------------------------------------------------------
-- What it does:
--   1. Adds created_at / updated_at timestamps to every core data table.
--   2. Adds a trigger that stamps updated_at automatically on every change.
-- Why it's safe: the app ignores these extra columns on read, and never sends
--   them on insert (so defaults apply). Nothing breaks. You gain an audit trail
--   that makes it possible to spot and recover from a bad sync / accidental
--   overwrite.
-- Also do (no SQL, in the dashboard): Database → Backups → enable Point-in-Time
--   Recovery (PITR) or confirm daily backups are on. This is the single most
--   important defense against data loss.
-- ============================================================================

-- 1) Helper that stamps updated_at on every UPDATE.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2) Add timestamps + the trigger to every core data table (idempotent).
do $$
declare t text;
begin
  foreach t in array array[
    'customers','doctors','medicines','purchases','bills','bill_items',
    'stock_adjustments','promise_orders','schedule_h_drugs',
    'schedule_h_register','shop_profiles','mm_users'
  ]
  loop
    execute format('alter table if exists %I add column if not exists created_at timestamptz default now();', t);
    execute format('alter table if exists %I add column if not exists updated_at timestamptz default now();', t);
    execute format('drop trigger if exists trg_%I_updated on %I;', t, t);
    execute format('create trigger trg_%I_updated before update on %I for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- Done. This script is safe to re-run.
