-- How was this payment actually made?
--
-- Sales and expenses have carried a payment mode for a long time, so v373's
-- routing could send a UPI sale to the bank instead of the drawer. The two
-- OTHER ways money moves had no mode at all:
--
--   supplier_payments  paying a distributor
--   customer_payments  a customer settling their khata
--
-- So a supplier paid by NEFT was indistinguishable from one paid out of the
-- till, and a khata settled by UPI was recorded as notes in the drawer. Both
-- land on the till in js/daybook.js for want of anywhere better, which
-- overstates the drawer and understates the bank — the same defect v373 fixed
-- for sales, in the two places it could not reach.
--
-- It is also what blocks bank reconciliation: a bank statement is mostly
-- supplier payments, and the app cannot yet say which of them went by bank.
--
-- Default 'Cash' is deliberate. Every payment recorded before today WAS
-- treated as cash, so 'Cash' is what actually happened as far as the books
-- are concerned. Defaulting to blank would instead invent a third state that
-- every reader would have to guess about, and re-stating history as "unknown"
-- helps nobody.
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- Until it is run the client drops the column and retries, so payments keep
-- saving exactly as they do today.

alter table public.supplier_payments
    add column if not exists payment_mode text not null default 'Cash';

alter table public.customer_payments
    add column if not exists payment_mode text not null default 'Cash';

comment on column public.supplier_payments.payment_mode is
    'Cash / UPI / Card / Bank / Cheque. Routed to a finance account by shop_profiles.payment_routing; an unmapped mode falls back to the till.';
comment on column public.customer_payments.payment_mode is
    'Cash / UPI / Card / Bank / Cheque. Routed to a finance account by shop_profiles.payment_routing; an unmapped mode falls back to the till.';
