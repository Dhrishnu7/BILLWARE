-- ============================================================================
-- VERIFY_sales_analytics.sql
-- Run AFTER add_sales_analytics.sql. Installs nothing — three read-only checks.
-- Run them ONE AT A TIME (highlight one block, press Run) so you can see which
-- answer belongs to which check.
-- ============================================================================


-- ── CHECK 1 ─────────────────────────────────────────────────────────────────
-- Did all six functions get created?
-- EXPECT: exactly 6 rows.
-- Fewer than 6 means part of the migration did not run — re-run it.

select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('mm_norm_product', 'mm_season', 'mm_bill_day',
                    'mm_sa_product_leaders', 'mm_sa_product_trend', 'mm_sa_coverage')
order by 1;


-- ── CHECK 2 ─────────────────────────────────────────────────────────────────
-- Does the name normaliser actually normalise?
-- EXPECT: one row, one column, reading exactly:   dolo 650
-- This proves punctuation, the unit (mg) and the dosage form (TAB) were all
-- stripped. If it comes back as 'dolo-650mg tab' the function exists but is not
-- doing its job — stop here and say so.

select public.mm_norm_product('DOLO-650mg TAB') as should_be_dolo_650;


-- ── CHECK 3 ─────────────────────────────────────────────────────────────────
-- What data does the feature actually have to work with?
-- EXPECT: one row per shop.
-- Read the `lines` column: a shop with bills but lines = 0 has no line items,
-- and would silently contribute nothing to every ranking.
-- The district / state columns will mostly be empty at this point — that is
-- expected, nothing has filled them in yet.

select * from public.mm_sa_coverage();
