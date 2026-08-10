-- ═══════════════════════════════════════════════════════════════════════════
--  STAFF & SALARIES
--
--  Two parts, and the split is the whole design:
--
--  1. `staff`  — WHO works here. A master record, nothing to do with money.
--
--  2. Salary payments are NOT a new table. They are ordinary rows in
--     `expenses`, with three extra columns naming the person and the kind of
--     payment. That is deliberate: the P&L, Day Book, Cash Flow and Tally
--     export all already read `expenses`, so a payment recorded here is picked
--     up by every one of them with no code change and NO possibility of the
--     staff report disagreeing with the profit figure. A separate salary
--     ledger would have been a second money path, and two money paths in one
--     app is how a shop ends up with two different answers for what it spent.
--
--  Pay basis is a free-text label, not an enum. Shops pay monthly, daily,
--  per-shift and by arrangement; the app records what happened rather than
--  insisting on one model.
--
--  PF/ESI are deliberately absent. PF applies at 20+ employees and ESI at 10+;
--  a single pharmacy is under both, and a half-built statutory engine is worse
--  than none because it looks authoritative while being wrong.
--
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.staff (
    staff_id    TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    role        TEXT DEFAULT '',
    phone       TEXT DEFAULT '',
    joined      DATE,
    pay_basis   TEXT DEFAULT '',        -- 'Monthly' | 'Daily' | free text
    pay_amount  NUMERIC(12,2) DEFAULT 0,-- optional default, only pre-fills the form
    active      BOOLEAN DEFAULT TRUE,
    note        TEXT DEFAULT '',
    saved_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_user_idx ON public.staff(user_id);

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_own" ON public.staff;
CREATE POLICY "staff_own" ON public.staff
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── The three columns that turn an expense into a salary payment ──────────
-- Nullable on purpose: every existing expense row stays valid, and an expense
-- that is not a salary simply leaves them empty.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS staff_id   TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS staff_name TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS pay_type   TEXT;

CREATE INDEX IF NOT EXISTS expenses_staff_idx ON public.expenses(user_id, staff_id);

-- ── Add to the delete-store cascade ───────────────────────────────────────
-- Every per-tenant table must be listed there, or deleting an owner leaves
-- orphaned rows behind. See migrations/add_delete_store_cascade.sql — add
-- 'staff' to its tbls array if this migration runs after it.
