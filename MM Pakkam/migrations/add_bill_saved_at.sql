-- add_bill_saved_at.sql
--
-- Gives a bill a real save TIME, separate from the date it is for.
--
-- Until now the bills table held only `date`, a DATE column. sales.html did
-- stamp a proper ISO timestamp on the bill object, but nothing sent it, so the
-- first cloud sync replaced it with the bare date. Every screen that shows a
-- bill's time then parsed '2026-08-05' as UTC midnight and printed 5:30 am --
-- the IST offset -- on every bill the shop had ever taken. Plausible enough
-- that nobody questioned it.
--
-- These are two genuinely different facts and neither can be derived from the
-- other: a bill can be legitimately back-dated to the day the goods went out,
-- while still having been keyed in this evening.
--
-- Safe to run more than once. Nothing breaks if it is never run at all --
-- dbSaveBill drops the column and retries when the schema lacks it, and the
-- device that took the bill keeps the true time in its own cache either way.
-- Running it is what makes the time visible on the shop's OTHER devices.

alter table public.bills
    add column if not exists saved_at timestamptz;

-- Existing rows have no time and must not be given a fabricated one: midnight
-- on the bill's own date would print as 5:30 am, which is the exact bug this
-- migration exists to end. They stay NULL, and the app shows no time for them.

comment on column public.bills.saved_at is
    'When the bill was keyed in (UTC). NULL for bills taken before this column existed. Distinct from "date", which is the date of supply and may be back-dated.';
