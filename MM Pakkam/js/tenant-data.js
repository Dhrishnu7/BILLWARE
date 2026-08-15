/* ══════════════════════════════════════════════════════════════════════════
   THE CANONICAL LIST OF EVERYTHING A SHOP OWNS.

   Why this file exists
   ────────────────────
   Three separate places used to keep their own hand-written list of the
   shop's tables:

     1. the Backup button          (report.html backupData)
     2. the delete-store cascade   (migrations/add_delete_store_cascade.sql)
     3. the login-time sync        (dbSyncCoreData in js/supabase.js)

   Every one of them has been caught incomplete at least once. v347: the sync
   had never fetched the Schedule-H drug list, so controlled-drug sales were
   silently skipping the register. 2026-08-12: the backup covered 12 datasets
   out of 23 — the entire Cash & Capital layer, both payment ledgers, staff
   and the Schedule-X list were in NO backup file, while the button still
   reported "✅ Saved!".

   A shop holding a backup that is missing half its accounts is worse off than
   a shop holding none, because it has stopped worrying.

   So: ONE list, here. Consumers derive from it instead of remembering.
   Adding a table means adding ONE entry below.

   ⚠️ The SQL cascade cannot read JavaScript. When you add an entry here, add
   its `table` to the tbls[] array in add_delete_store_cascade.sql too — and
   mmTenantData.tables() prints the exact list to compare against.

   Field guide
   ───────────
   key      the property name inside a backup .json file. NEVER rename one:
            older backup files are read by this name and must keep working.
   label    what the shop sees in the backup/restore log.
   table    the Supabase table, for the cascade cross-check.
   get      name of the fetch helper (a string, resolved at call time, so a
            page that has not loaded supabase.js cannot crash the backup).
   put      name of the write helper used to restore it.
   mode     how `put` wants the data:
              'each'   call put(row) once per row
              'bulk'   call put(wholeArray) once
              'names'  put(arrayOfNames) — the row may be a string or {name}
              'args'   use `spread` to turn a row into positional arguments
              'single' not an array; one object (the shop profile)
              'custom' report.html has a bespoke block for it — the generic
                       restorer must SKIP it rather than double-write
   idempotent  true  = the writer upserts on a stable id, so replaying a
                      backup cannot create duplicates.
              false = needs a dedup guard; those all live in the bespoke
                      blocks in report.html, which is why they are 'custom'.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var DATASETS = [
        /* ── The original v2.0 sections. Their restore logic is bespoke in
              report.html (they insert rather than upsert, so each one carries
              its own dedup key). Listed here so the BACKUP still derives from
              one list — the bug was in what got fetched, not in restore. ── */
        { key: 'bills',             label: '🧾 Sales bills',            table: 'bills',
          get: 'dbGetBills',              put: null, mode: 'custom', idempotent: false },
        { key: 'purchases',         label: '📦 Purchases',              table: 'purchases',
          get: 'dbGetPurchases',          put: null, mode: 'custom', idempotent: false },
        { key: 'customers',         label: '👥 Customers (incl. khata)', table: 'customers',
          get: 'dbGetCustomers',          put: null, mode: 'custom', idempotent: false },
        { key: 'doctors',           label: '🩺 Doctors',                table: 'doctors',
          get: 'dbGetDoctors',            put: null, mode: 'custom', idempotent: false },
        { key: 'medicines',         label: '💊 Medicines',              table: 'medicines',
          get: 'dbGetMedicines',          put: null, mode: 'custom', idempotent: true },
        { key: 'stockAdjustments',  label: '📊 Stock adjustments',      table: 'stock_adjustments',
          get: 'dbGetStockAdjustments',   put: null, mode: 'custom', idempotent: false },
        { key: 'promiseOrders',     label: '📝 Promise orders',         table: 'promise_orders',
          get: 'dbGetPromiseOrders',      put: null, mode: 'custom', idempotent: false },
        { key: 'scheduleHDrugs',    label: '🅗 Schedule-H drugs',       table: 'schedule_h_drugs',
          get: 'dbGetScheduleHDrugs',     put: null, mode: 'custom', idempotent: true },
        { key: 'scheduleHRegister', label: '🅗 Schedule-H register',    table: 'schedule_h_register',
          get: 'dbGetScheduleHRegister',  put: null, mode: 'custom', idempotent: true },
        { key: 'prescriptions',     label: '📄 Prescriptions',          table: 'prescriptions',
          get: 'dbGetPrescriptions',      put: null, mode: 'custom', idempotent: true },
        { key: 'expenses',          label: '💸 Expenses',               table: 'expenses',
          get: 'dbGetExpenses',           put: null, mode: 'custom', idempotent: true },
        { key: 'shopProfile',       label: '🏪 Shop profile',           table: 'shop_profiles',
          get: 'dbGetShopProfile',        put: null, mode: 'custom', idempotent: true, single: true },

        /* ── ADDED 2026-08-12 (backup v3.0). None of these were in any backup
              file. Every one of their writers upserts on a stable id, so the
              generic restorer can simply replay them. ── */
        { key: 'financeAccounts',   label: '🏦 Cash & Capital accounts', table: 'finance_accounts',
          get: 'dbGetFinanceAccounts',    put: 'dbSaveFinanceAccount', mode: 'each', idempotent: true },
        { key: 'financeEntries',    label: '🏦 Account movements',       table: 'finance_entries',
          get: 'dbGetFinanceEntries',     put: 'dbAddFinanceEntries',  mode: 'bulk', idempotent: true },
        { key: 'suppliers',         label: '🏭 Suppliers',               table: 'suppliers',
          get: 'dbGetSuppliers',          put: 'dbAddSupplier',        mode: 'args', idempotent: true,
          spread: function (s) { return [s.name, s.gstin, s.phone, s.address]; } },
        { key: 'supplierPayments',  label: '💰 Payments to suppliers',   table: 'supplier_payments',
          get: 'dbGetSupplierPayments',   put: 'dbAddSupplierPayment', mode: 'each', idempotent: true },
        { key: 'customerPayments',  label: '💵 Payments from customers', table: 'customer_payments',
          get: 'dbGetCustomerPayments',   put: 'dbAddCustomerPayment', mode: 'each', idempotent: true },
        { key: 'staff',             label: '👔 Staff',                   table: 'staff',
          get: 'dbGetStaff',              put: 'dbSaveStaff',          mode: 'each', idempotent: true },
        { key: 'tillCounts',        label: '🧮 Till counts',             table: 'till_counts',
          get: 'dbGetTillCounts',         put: 'dbSaveTillCount',      mode: 'each', idempotent: true },
        { key: 'reconciliations',   label: '🔍 Bank reconciliations',    table: 'bank_reconciliations',
          get: 'dbGetReconciliations',    put: 'dbSaveReconciliation', mode: 'each', idempotent: true },
        { key: 'barcodes',          label: '🏷️ Barcodes',                table: 'barcodes',
          get: 'dbGetBarcodes',           put: 'dbAddBarcode',         mode: 'args', idempotent: true,
          spread: function (b) { return [b.barcode || b.code, b.product_name || b.name]; } },
        { key: 'reorderLevels',     label: '🛒 Reorder levels',          table: 'reorder_levels',
          get: 'dbGetReorderLevels',      put: 'dbSetReorderLevel',    mode: 'args', idempotent: true,
          spread: function (r) { return [r.name, r.level]; } },
        { key: 'scheduleXDrugs',    label: '🅧 Schedule-X drugs',        table: 'schedule_x_drugs',
          get: 'dbGetScheduleXDrugs',     put: 'dbAddScheduleXDrugs',  mode: 'names', idempotent: true },

        /* The audit trail is deliberately BACKED UP BUT NEVER RESTORED. It
           records who did what and when; re-inserting it from a file would let
           the history be edited offline and replayed, which is the one thing a
           log must not allow. Keeping it in the file still preserves the
           evidence if the shop ever has to prove what happened. */
        { key: 'auditLog',          label: '🕓 Audit trail (kept, not restored)', table: 'audit_log',
          get: 'dbGetAuditLog',           put: null, mode: 'none', idempotent: true }
    ];

    /* Tables that are per-tenant but deliberately NOT in a backup, each with
       the reason. Named explicitly so the completeness check can tell
       "decided against" apart from "forgotten" — which is the whole point. */
    var EXCLUDED = {
        customer_balance_ops:    'Replay guard. Restoring old op-ids would make a real payment look already-applied.',
        shop_edit_requests:      'A support queue, not shop data.',
        extra_user_requests:     'A support queue, not shop data.',
        password_reset_requests: 'A support queue, and restoring it would be a security hazard.',
        customer_issues:         'A support queue, not shop data.',
        bill_items:              'Child rows of bills; restored with their parent.',
        app_config:              'Global platform config, not owned by the shop.',
        announcements:           'Sent BY the platform, not owned by the shop.',
        shop_billing:            'Subscription state, owned by the platform.',
        ocr_usage:               'Metering counters, regenerated by use.',
        branch_groups:           'Which shops belong to one owner. A security fact like memberships, not shop data — restoring a backup must never be able to re-link one shop to another.',
        branches:                'Maps a branch to its group. Same reason as branch_groups.'
    };

    /* Derived views, not stored tables — they must never be treated as a
       missing dataset by the completeness check. */
    var DERIVED = ['dbGetKhataData', 'dbGetReportData'];

    window.mmTenantData = {
        datasets:  function () { return DATASETS.slice(); },
        excluded:  function () { return EXCLUDED; },
        derived:   function () { return DERIVED.slice(); },
        keys:      function () { return DATASETS.map(function (d) { return d.key; }); },
        tables:    function () { return DATASETS.map(function (d) { return d.table; }); },
        byKey:     function (k) {
            for (var i = 0; i < DATASETS.length; i++) if (DATASETS[i].key === k) return DATASETS[i];
            return null;
        },
        /* The datasets the generic restorer owns — everything with a writer
           that upserts. 'custom' and 'none' are excluded by construction, so a
           bespoke block can never be double-written by the generic loop. */
        restorable: function () {
            return DATASETS.filter(function (d) {
                return d.put && d.mode !== 'custom' && d.mode !== 'none';
            });
        }
    };
})();
