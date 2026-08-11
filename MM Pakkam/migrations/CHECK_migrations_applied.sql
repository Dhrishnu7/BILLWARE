/* ══════════════════════════════════════════════════════════════════════
   CHECK_migrations_applied.sql — which migrations actually ran?
   ══════════════════════════════════════════════════════════════════════
   Twenty-six migration files have accumulated, each one delivered as
   "run this in Supabase" and each one relying on someone remembering. If
   even one was missed, the feature that needs it does not fail loudly at
   deploy — it fails at a shop counter, weeks later, as a save that does
   nothing or a tab that will not load.

   This answers the question directly, in one paste, before the real-world
   testing pass rather than during it.

   READ ONLY. It creates nothing, alters nothing and deletes nothing —
   every statement is a SELECT against the catalogue. Safe to run on
   production, safe to run twice.

   HOW TO READ IT: any row saying MISSING is a migration that never ran.
   Run that file, then run this again until nothing is missing.
────────────────────────────────────────────────────────────────────── */

WITH expected_tables(tbl, migration) AS (VALUES
    ('app_config',         'add_app_config_table.sql'),
    ('audit_log',          'add_audit_log_table.sql'),
    ('barcodes',           'add_barcodes_table.sql'),
    ('customer_payments',  'add_customer_payments_table.sql'),
    ('expenses',           'add_expenses_table.sql'),
    ('mm_announcements',   'add_announcements_table.sql'),
    ('reorder_levels',     'add_reorder_levels_table.sql'),
    ('schedule_x_drugs',   'add_schedule_x_drugs_table.sql'),
    ('shop_billing',       'add_shop_billing_table.sql'),
    ('supplier_payments',  'add_supplier_payments_table.sql'),
    ('suppliers',          'add_suppliers_table.sql'),
    ('till_counts',        'add_till_counts_table.sql'),
    ('finance_accounts',   'add_finance_accounts.sql'),
    ('finance_entries',    'add_finance_accounts.sql'),
    ('customer_balance_ops', 'add_balance_ops.sql')
),
expected_columns(tbl, col, migration) AS (VALUES
    ('bill_items',          'hsn',            'add_hsn_columns.sql'),
    ('bill_items',          'pack',           'add_bill_columns.sql'),
    ('bills',               'customer_id',    'add_bill_customer_id.sql'),
    ('bills',               'payment_mode',   'add_bill_columns.sql'),
    ('customers',           'city',           'add_customer_gstin.sql'),
    ('customers',           'gstin',          'add_customer_gstin.sql'),
    ('customers',           'pincode',        'add_customer_gstin.sql'),
    ('mm_announcements',    'target_user',    'add_announcement_targeting.sql'),
    ('purchases',           'hsn',            'add_hsn_columns.sql'),
    ('schedule_h_register', 'doctor_reg_no',  'add_schedule_h_register_columns.sql'),
    ('schedule_h_register', 'entry_type',     'add_schedule_h_register_columns.sql'),
    ('schedule_h_register', 'schedule_class', 'add_schedule_h_register_columns.sql'),
    ('shop_profiles',       'city',           'add_customer_gstin.sql'),
    ('shop_profiles',       'credit_limit',   'add_credit_limit_column.sql'),
    ('shop_profiles',       'opening_stock',  'add_opening_stock.sql'),
    ('shop_profiles',       'opening_debtors', 'add_finance_accounts.sql'),
    ('shop_profiles',       'opening_creditors', 'add_finance_accounts.sql'),
    ('shop_profiles',       'pincode',        'add_customer_gstin.sql')
)

SELECT * FROM (
    -- ── Tables ──────────────────────────────────────────────────────
    SELECT
        CASE WHEN t.table_name IS NULL THEN '❌ MISSING' ELSE '✅ ok' END AS status,
        'table'        AS kind,
        e.tbl          AS object_name,
        e.migration    AS run_this_file
    FROM expected_tables e
    LEFT JOIN information_schema.tables t
           ON t.table_schema = 'public' AND t.table_name = e.tbl

    UNION ALL

    -- ── Columns ─────────────────────────────────────────────────────
    -- A column on a table that does not exist is reported as a missing
    -- column, which is the honest answer: whichever file is missing, the
    -- feature is equally broken.
    SELECT
        CASE WHEN c.column_name IS NULL THEN '❌ MISSING' ELSE '✅ ok' END,
        'column',
        e.tbl || '.' || e.col,
        e.migration
    FROM expected_columns e
    LEFT JOIN information_schema.columns c
           ON c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col

    UNION ALL

    -- ── Row Level Security ──────────────────────────────────────────
    -- Every per-shop table must have RLS ON. Five tables were once found
    -- without it, which is how one shop could read data belonging to a
    -- different shop; a new
    -- table added later without RLS would reopen exactly that hole, and
    -- nothing else in the app would notice.
    SELECT
        CASE WHEN cl.relrowsecurity THEN '✅ ok' ELSE '❌ RLS OFF' END,
        'rls',
        cl.relname,
        'see fix_cross_account_leaks.sql'
    FROM pg_class cl
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relkind = 'r'
      AND cl.relname IN (
          'bills','bill_items','purchases','customers','doctors','medicines',
          'shop_profiles','schedule_h_register','schedule_h_drugs','prescriptions',
          'promise_orders','barcodes','suppliers','supplier_payments',
          'customer_payments','expenses','reorder_levels','audit_log',
          'schedule_x_drugs','shop_billing','till_counts',
          'finance_accounts','finance_entries'
      )
) report
-- Problems first, so a clean run is obvious at a glance.
ORDER BY (status LIKE '✅%'), kind, object_name;
