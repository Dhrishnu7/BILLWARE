-- GSTIN on a customer, so a sale to a registered buyer can be filed correctly.
--
-- WHY: GSTR-1 needs sales to a GSTIN holder (a clinic, a nursing home, another
-- chemist) filed under B2B, invoice by invoice, or that buyer cannot claim the
-- input credit on what they bought. Without somewhere to record their GSTIN the
-- export had no way to tell such a sale from a walk-in counter sale, so it filed
-- everything as B2C — quietly costing those buyers their credit.
--
-- Most customers will never have one. It is optional, blank by default, and only
-- the few that do change how their invoices are filed.
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run — idempotent.

alter table public.customers
    add column if not exists gstin text default '';

-- Only a handful of rows will ever be non-blank, so index just those: this is
-- what the GSTR-1 build scans to decide B2B vs B2C.
create index if not exists customers_gstin_idx
    on public.customers (user_id, gstin)
    where gstin is not null and gstin <> '';

-- ── Verify ──────────────────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'customers' and column_name = 'gstin';
