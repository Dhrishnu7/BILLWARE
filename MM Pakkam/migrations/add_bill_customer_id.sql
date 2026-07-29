-- Link a bill to the customer RECORD, not just to their typed name.
--
-- WHY: GSTR-1 decides B2B vs B2C by looking up the customer's GSTIN, and until
-- now that lookup matched the customer's NAME as text. That breaks three ways,
-- all of them silently:
--
--     billed as "City Clnic"          -> no match -> filed B2C
--     billed as "City Clinic Pvt Ltd" -> no match -> filed B2C
--     customer later renamed          -> every old bill stops matching
--
-- A B2B sale wrongly filed as B2C costs the BUYER their input credit, and they
-- only find out weeks later. Storing the customer's id makes the link immune to
-- typos and renames: the id never changes.
--
-- Nobody types it. The Sales page attaches it when the customer is picked, and
-- it is never shown.
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run — idempotent.

alter table public.bills
    add column if not exists customer_id bigint;

-- Old bills have no id and keep matching by name, so the export needs both
-- paths; this index serves the id one.
create index if not exists bills_customer_id_idx
    on public.bills (user_id, customer_id)
    where customer_id is not null;

-- ── Verify ──────────────────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'bills' and column_name = 'customer_id';
