-- ─────────────────────────────────────────────────────────────────────────
-- Purchase discount → carried to Sales
--
-- The shop's SELLING discount for a medicine, entered once on the Purchase
-- page so the biller does not have to remember it at the till. When that
-- product + batch is picked on the Sales page, Disc % auto-fills from here
-- and the biller can still change it.
--
-- This is NOT a trade discount from the distributor. It does not reduce the
-- purchase total, the payable to the supplier, or the GST input credit —
-- nothing already recorded changes meaning. Rows that existed before this
-- migration simply get 0, which is exactly how they behaved before.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.purchases.discount IS
    'Selling discount % for this batch, auto-filled into Sales Disc %. Not a trade discount: it never affects this purchase''s own total, payable or input credit.';

-- Verify: should list the column with default 0
SELECT column_name, data_type, column_default, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'purchases'
  AND  column_name  = 'discount';
