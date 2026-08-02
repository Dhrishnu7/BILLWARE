-- Opening stock — the shop's own valuation of the goods on its shelves on the
-- day it started keeping records here.
--
-- WHY IT IS NEEDED
-- The Accounts view computes gross profit the way an accountant does:
--   Opening Stock + Purchases − Closing Stock = Cost of Goods Sold
-- Opening and closing stock are computed from the purchase history, which is
-- correct for any shop whose history goes back far enough. A shop that started
-- using the app mid-life was already holding stock that no purchase record ever
-- saw, so the computed opening figure is too low and gross profit comes out too
-- high. A physical count beats a computation over incomplete data, so the owner
-- can enter the real figure once and the statement uses it.
--
-- 0 = not entered; the computed figure is used and the report says so.
-- opening_stock_date is the date the count applies to. The entered value is only
-- used for periods that begin on or after it.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Safe to re-run — idempotent.

alter table public.shop_profiles add column if not exists opening_stock numeric not null default 0;
alter table public.shop_profiles add column if not exists opening_stock_date date;
