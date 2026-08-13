-- ─────────────────────────────────────────────────────────────
-- SUPPLIER OPENING BALANCE  (v397)
--
-- What a shop already owed a distributor on the day it started using
-- Billware. Until now there was nowhere to put this: a supplier's
-- balance is DERIVED — purchases − returns − payments — so the only
-- ways to state an opening figure were to invent a purchase (which
-- would add stock that does not exist and input tax credit that was
-- never earned) or to record a negative payment (which would corrupt
-- cash flow). Both fix one screen by breaking three.
--
-- So the opening gets a column of its own. It is read ONLY by the
-- supplier-balance formula in js/position.js. It never becomes a
-- purchase, so it cannot touch stock, GST or the P&L, and it never
-- becomes a payment, so it cannot touch the till or a bank account.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────

alter table public.suppliers
    add column if not exists opening_balance numeric(14,2) not null default 0;

-- The date that figure applies to. Optional, and shown on the ledger
-- so an opening can never be mistaken for a recent bill.
alter table public.suppliers
    add column if not exists opening_date date;

comment on column public.suppliers.opening_balance is
    'What was already owed to this supplier when the shop started using Billware. Added to purchases-minus-payments; never itself a purchase or a payment.';

-- Nothing else changes. The app works without this migration: the
-- writer retries without the column and the figure stays on the
-- device until the column exists, the same fallback used for
-- payment_mode and reg_no.
