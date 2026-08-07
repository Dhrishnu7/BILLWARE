-- add_finance_accounts.sql
--
-- THE RIGHT-HAND SIDE OF THE BALANCE SHEET.
--
-- "Where You Stand" has always ended with a list of what it does NOT include:
-- cash and bank, what the owner put in and took out, the fridge and the
-- shelving and their depreciation, loans and deposits, and anything that
-- existed before the shop started using Billware. Those are not small
-- omissions — between them they are most of a real balance sheet's right-hand
-- side, which is exactly why js/position.js refuses to call itself one.
--
-- This is where those things finally live. Two tables, deliberately:
--
--   finance_accounts  the things that HOLD a balance
--   finance_entries   the movements against them
--
-- WHAT THIS IS NOT
-- It is not double-entry. There is no chart of accounts, no journal, no
-- trial balance, and nothing here posts a sale or a purchase — those are
-- already documents and js/pnl.js already reads them. Adding a second,
-- posted copy of a bill would give the app two answers to "what did we sell",
-- and the one nobody is looking at would be the wrong one. Same reasoning as
-- _mmNormalizeBills, mmTaxHead and mmPosition.suppliers: one formula, one
-- owner, everything else derives.
--
-- What it IS: a cash book per account, plus enough about assets and loans to
-- work out depreciation and an interest/principal split.
--
-- PAIRED MOVEMENTS
-- Some movements genuinely touch two accounts — an EMI leaves the bank AND
-- reduces the loan; moving the day's takings to the bank leaves the till and
-- arrives at the bank. Those are written as TWO rows sharing one `ref`, so
-- the balances are right on both sides and an undo can remove the pair. That
-- is informal double-entry and it is named as such rather than pretended
-- otherwise. It is the minimum that keeps a cash balance believable.
--
-- Safe to run more than once.


-- ──────────────────────────────────────────────────────────────────────────
-- ACCOUNTS
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_accounts (
    id           bigserial primary key,
    account_id   text not null unique,          -- client-generated, like payment_id
    user_id      text not null,
    kind         text not null,                 -- see the check below
    name         text not null,
    opening      numeric not null default 0,
    opening_date date,
    meta         jsonb not null default '{}'::jsonb,
    active       boolean not null default true,
    saved_at     timestamptz not null default now()
);

-- The six kinds, and what `opening` means for each. It is one column because
-- it is one idea — "the figure this account started at, on opening_date" —
-- and six nullable columns would only invite five of them to disagree.
--
--   cash     money in the till          opening = balance on opening_date
--   bank     a bank account             opening = balance on opening_date
--   capital  the owner's own money      opening = capital at go-live
--   loan     money borrowed             opening = OUTSTANDING on opening_date
--   asset    fridge, racks, computer    opening = COST, opening_date = bought
--   deposit  rent deposit, advances     opening = amount paid
--
-- The asset row is the one worth reading twice: cost and purchase date, NOT
-- written-down value at go-live. Depreciation is then computed from the day
-- it was bought, which is both more accurate and impossible to double-apply.
-- See js/finance.js — depreciation is DERIVED and never stored, for the same
-- reason v300 exists: an insert is not idempotent, and a stored yearly
-- depreciation entry re-posted on a sync is a silent, plausible-looking lie.
--
-- meta carries only what is specific to a kind:
--   bank    { bank: 'HDFC', last4: '4471' }   ← LAST FOUR DIGITS ONLY, never
--                                               the full account number
--   loan    { lender, rate, emi }
--   asset   { method: 'wdv'|'slm', rate, salvage }
--   deposit { party }
alter table public.finance_accounts drop constraint if exists finance_accounts_kind_chk;
alter table public.finance_accounts add constraint finance_accounts_kind_chk
    check (kind in ('cash', 'bank', 'capital', 'loan', 'asset', 'deposit'));

create index if not exists finance_accounts_user_idx
    on public.finance_accounts (user_id, kind);


-- ──────────────────────────────────────────────────────────────────────────
-- ENTRIES — the movements
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_entries (
    id          bigserial primary key,
    entry_id    text not null unique,           -- client-generated; upsert key
    user_id     text not null,
    account_id  text not null,
    entry_date  date not null,
    direction   smallint not null default 1,    -- +1 into the account, -1 out
    amount      numeric not null default 0,     -- always POSITIVE; direction signs it
    interest    numeric not null default 0,     -- EMI rows only — see below
    kind        text not null,
    note        text,
    ref         text,                           -- links the two halves of a pair
    saved_at    timestamptz not null default now()
);

-- Amount is positive and `direction` carries the sign, rather than storing a
-- signed amount. A signed column invites the classic pair of bugs: a UI that
-- stores −100 for a withdrawal against code that also multiplies by −1, and a
-- validator that cannot tell "negative because it is a withdrawal" from
-- "negative because somebody typed a minus sign". Here "an amount is never
-- negative" is simply true, and every reader applies direction once.
alter table public.finance_entries drop constraint if exists finance_entries_dir_chk;
alter table public.finance_entries add constraint finance_entries_dir_chk
    check (direction in (-1, 1));

alter table public.finance_entries drop constraint if exists finance_entries_amt_chk;
alter table public.finance_entries add constraint finance_entries_amt_chk
    check (amount >= 0 and interest >= 0);

-- `interest` is a real column and not a key in a jsonb blob because the P&L
-- reads it. An EMI is one payment that does two different things: part of it
-- repays the loan (a balance sheet movement, `amount`) and part of it is
-- interest (a P&L expense, `interest`). Splitting them at entry is what lets
-- js/pnl.js charge the interest without inventing it from a rate, and lets
-- the loan balance fall by the principal alone. A single "EMI paid" figure
-- would make one of those two numbers wrong for ever.
--
-- kind values, per account type:
--   cash/bank  deposit · withdrawal · transfer · charge · takings
--   capital    introduce · drawing
--   loan       emi · repay · borrow
--   asset      purchase · sale · improve
--   deposit    paid · refunded
create index if not exists finance_entries_user_date_idx
    on public.finance_entries (user_id, entry_date);
create index if not exists finance_entries_account_idx
    on public.finance_entries (user_id, account_id);
create index if not exists finance_entries_ref_idx
    on public.finance_entries (user_id, ref);


-- ──────────────────────────────────────────────────────────────────────────
-- OPENING BALANCES THAT ARE NOT ACCOUNTS
--
-- opening_stock already lives on shop_profiles (add_opening_stock.sql) for
-- exactly this reason: a shop that started using the app mid-life was already
-- owed money and already owed money out, and no document here ever saw it.
-- Debtors and creditors are computed from bills and purchases, so the same
-- gap applies to both, and the same fix does.
--
-- 0 = not entered, and the screen says the figure is computed. As with
-- opening stock, these are only applied to periods beginning on or after
-- opening_balances_date.
-- ──────────────────────────────────────────────────────────────────────────
alter table public.shop_profiles add column if not exists opening_debtors   numeric not null default 0;
alter table public.shop_profiles add column if not exists opening_creditors numeric not null default 0;
alter table public.shop_profiles add column if not exists opening_balances_date date;


-- ──────────────────────────────────────────────────────────────────────────
-- GRANTS + RLS — same shape as every other per-tenant table here.
-- ──────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.finance_accounts to anon, authenticated;
grant select, insert, update, delete on public.finance_entries  to anon, authenticated;
grant usage, select on sequence public.finance_accounts_id_seq to anon, authenticated;
grant usage, select on sequence public.finance_entries_id_seq  to anon, authenticated;

alter table public.finance_accounts enable row level security;
alter table public.finance_entries  enable row level security;

drop policy if exists tenant_rw on public.finance_accounts;
create policy tenant_rw on public.finance_accounts
    for all using (true) with check (true);

drop policy if exists tenant_rw on public.finance_entries;
create policy tenant_rw on public.finance_entries
    for all using (true) with check (true);

comment on table public.finance_accounts is
    'Cash, bank, capital, loans, fixed assets and deposits — the parts of the shop''s finances that no bill or purchase records. Not a chart of accounts; there is no double entry. opening/opening_date mean different things per kind, documented in the migration.';
comment on table public.finance_entries is
    'Movements against a finance_account. amount is always positive and direction (+1/-1) signs it. interest is the P&L half of an EMI. Two rows sharing a ref are the two sides of one paired movement.';
