-- Per-shop khata credit limit. When a credit (khata) sale would push a customer's
-- outstanding balance over this limit, the Sales page blocks the bill and shows
-- "Khata limit exceeded". 0 = no limit (unlimited, the default).
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Safe to re-run — idempotent.

alter table public.shop_profiles add column if not exists credit_limit numeric not null default 0;
