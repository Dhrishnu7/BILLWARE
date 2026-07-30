-- Columns that were being dropped on the cloud round-trip of a sale:
--   bills.payment_mode  — Cash vs Credit was never saved, so a credit sale came
--                         back as "cash" after syncing from the cloud.
--   bill_items.pack     — pack size was never saved on line items.
-- (bill_items.hsn already existed and was being written; the read side was fixed
--  in code to actually load it back.)
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Safe to re-run — every statement is IF NOT EXISTS / idempotent.

alter table public.bills      add column if not exists payment_mode text not null default 'cash';
alter table public.bill_items add column if not exists pack         numeric not null default 0;
