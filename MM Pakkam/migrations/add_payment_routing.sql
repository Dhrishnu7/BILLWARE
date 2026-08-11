-- Where does each payment mode's money actually land?
--
-- THE BUG THIS FIXES
-- js/daybook.js has always treated cash, UPI and card alike as "cash"
-- (isCashMode), and js/finance.js feeds all of it into the primary CASH
-- account. So a UPI sale increases the shop's TILL, when the money is in a
-- bank or a settlement account and never touched the drawer. Two consequences:
--
--   * The till count is short by the day's UPI and card takings, EVERY day.
--     The screen invites the shop to explain a gap that the app created.
--   * A bank account only ever holds what someone typed on the Cash & Capital
--     tab, so it cannot be reconciled against a bank statement.
--
-- WHY THIS IS CONFIGURATION AND NOT A RULE
-- Billware is multi-tenant. One shop's UPI lands straight in a bank-linked
-- current account; another's sits with a PSP until it settles; another takes
-- cards on a machine from a different provider entirely. There is no correct
-- answer to hardcode, so the shop names the destination and the app derives
-- everything from that. (The same reasoning as the GSTR-3B worksheet: never
-- design a multi-tenant rule from one shop's arrangement.)
--
-- SHAPE
--   { "upi": "<account_id>", "card": "<account_id>", "cash": "<account_id>" }
-- keyed by the lowercased payment mode, valued with a finance_accounts
-- .account_id. A MISSING KEY MEANS "the primary till" — i.e. exactly what the
-- app does today. That default is deliberate: a shop that has not configured
-- anything must not have its till history silently re-stated overnight.
--
-- Only cash and bank accounts are ever offered as destinations; routing a sale
-- into a loan or an asset is meaningless.
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- Until it is run the client keeps the old behaviour and says so, so nothing
-- breaks meanwhile.

alter table public.shop_profiles
    add column if not exists payment_routing jsonb not null default '{}'::jsonb;

comment on column public.shop_profiles.payment_routing is
    'Payment mode -> finance_accounts.account_id. Missing key = the primary cash/till account, which is the pre-v373 behaviour. Only cash and bank accounts are valid destinations.';
