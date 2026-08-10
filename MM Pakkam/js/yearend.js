/**
 * yearend.js — the Year-End Pack
 *
 * One file to hand an accountant, instead of seven exports taken on seven
 * different screens with seven different date ranges. That mismatch is the
 * actual problem this solves: the shop exports a P&L for one period, a Tally
 * XML for another, forgets the asset register entirely, and the accountant
 * spends a billable hour reconciling figures that were never meant to differ.
 *
 * NOTHING HERE COMPUTES A FIGURE. Every number comes from the module that
 * already owns it — mmPnl, mmPosition, mmFinance, mmTally, mmGstr1. A second
 * implementation of gross profit is how two screens of one app start
 * disagreeing, and there is no way for the shop to tell which is right. This
 * file is a renderer and an envelope, and if a total looks wrong the bug is
 * upstream, in one place, where fixing it fixes every screen at once.
 *
 * Output is a single self-contained HTML file: opens in any browser, prints to
 * PDF, and carries the machine-readable Tally XML and GSTR-1 JSON inside it as
 * download links. No zip library, no CDN, nothing to install at the other end —
 * an accountant can open it on a laptop that has never heard of this app.
 */
(function () {
    'use strict';

    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    function r2(v) { return Math.round(num(v) * 100) / 100; }
    function d10(v) { return String(v || '').slice(0, 10); }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function inr(v) {
        var n = num(v);
        var neg = n < 0;
        var s = Math.abs(r2(n)).toFixed(2);
        var parts = s.split('.');
        var x = parts[0];
        // Indian grouping: last three, then pairs.
        var last3 = x.slice(-3), rest = x.slice(0, -3);
        if (rest) x = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
        else x = last3;
        return (neg ? '−' : '') + '₹' + x + '.' + parts[1];
    }

    function dmy(iso) {
        var s = d10(iso);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
        var p = s.split('-');
        var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return p[2] + ' ' + M[+p[1] - 1] + ' ' + p[0];
    }

    /* An Indian financial year runs 1 April to 31 March. Given any date, the FY
       it belongs to is the one ENDING on the next 31 March. Built from the date
       parts rather than a Date object on purpose: `new Date('2026-04-01')` is
       parsed as UTC and reads as 31 March in IST, which would put every 1 April
       transaction in the wrong year — the same class of bug as the 5:30 am
       timestamps. */
    function fyOf(iso) {
        var s = d10(iso) || todayLocal();
        var y = +s.slice(0, 4), m = +s.slice(5, 7);
        var startYear = (m >= 4) ? y : y - 1;
        return {
            from: startYear + '-04-01',
            to:   (startYear + 1) + '-03-31',
            label: 'FY ' + startYear + '–' + String(startYear + 1).slice(2)
        };
    }

    // "2025-06" -> "Jun 2025". The accountant reads month names, not keys.
    function monthName(ym) {
        var p = String(ym || '').split('-');
        if (p.length !== 2) return ym || '—';
        var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return (M[+p[1] - 1] || p[1]) + ' ' + p[0];
    }

    function todayLocal() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
             + '-' + String(d.getDate()).padStart(2, '0');
    }

    // The FYs the shop actually has data for, newest first, so the picker never
    // offers a year with nothing in it.
    function availableYears() {
        var dates = [];
        function collect(key, field) {
            try {
                (JSON.parse(localStorage.getItem(key) || '[]') || []).forEach(function (r) {
                    var d = d10(r && (r[field] || r.date));
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
                });
            } catch (e) {}
        }
        collect('mm_sales', 'date');
        collect('mm_purchases', 'date');
        var seen = {}, out = [];
        dates.forEach(function (d) {
            var fy = fyOf(d);
            if (!seen[fy.from]) { seen[fy.from] = 1; out.push(fy); }
        });
        var cur = fyOf(todayLocal());
        if (!seen[cur.from]) out.push(cur);
        out.sort(function (a, b) { return b.from.localeCompare(a.from); });
        return out;
    }

    /* TWO SPELLINGS ON ONE DEVICE, again. The localStorage copy is camelCase
       (`shopName`) because the app writes it; `window.mmShopProfile` is the RAW
       cloud row and is snake_case (`shop_name`). Reading only one gave a pack
       headed "Shop" while the GSTIN came through fine — `gstin` is spelled the
       same in both shapes, so the bug hid behind a field that happened to work.
       Same class as the productName/product_name stock adjustments. */
    function shopProfile() {
        var p = {};
        try { p = JSON.parse(localStorage.getItem('mm_shop_profile') || '{}') || {}; } catch (e) {}
        if (window.mmShopProfile && typeof window.mmShopProfile === 'object') {
            Object.keys(window.mmShopProfile).forEach(function (k) {
                if (p[k] == null || p[k] === '') p[k] = window.mmShopProfile[k];
            });
        }
        return p;
    }

    function shopName(p) {
        return String((p && (p.shopName || p.shop_name || p.storeName || p.store_name || p.name)) || '').trim();
    }

    /* ── the documents ────────────────────────────────────────────────────── */

    function gather(fy, opts) {
        opts = opts || {};
        var out = { fy: fy, built: [], missing: [] };

        function attempt(key, label, fn) {
            if (typeof fn !== 'function') { out.missing.push(label); return null; }
            try {
                var v = fn();
                if (v == null) { out.missing.push(label); return null; }
                out.built.push(label);
                return v;
            } catch (e) {
                /* A module that throws must not take the whole pack with it.
                   The accountant gets every other statement plus a named gap,
                   which is far more useful than a failed download and no clue
                   which document broke. */
                out.missing.push(label + ' (failed: ' + (e && e.message ? e.message : 'error') + ')');
                return null;
            }
        }

        out.pnl = attempt('pnl', 'Profit & Loss', function () {
            return window.mmPnl && mmPnl.build({ from: fy.from, to: fy.to });
        });
        out.position = attempt('position', 'Balance position', function () {
            return window.mmPosition && mmPosition.build({ asOf: fy.to });
        });
        out.finance = attempt('finance', 'Cash, bank & capital', function () {
            return window.mmFinance && mmFinance.summary({ asOf: fy.to });
        });
        out.assets = attempt('assets', 'Fixed asset register', function () {
            return window.mmFinance && mmFinance.assetSchedule({ from: fy.from, to: fy.to });
        });
        out.loans = attempt('loans', 'Loan schedule', function () {
            return window.mmFinance && mmFinance.loanSchedule({ from: fy.from, to: fy.to });
        });
        /* Cash flow rides on the P&L build rather than a second call — the
           bridge is part of what mmPnl already returned, and calling build()
           twice for one report would be two chances to disagree. */
        if (out.pnl && out.pnl.cash) out.built.push('Cash flow');
        else out.missing.push('Cash flow');

        out.suppliers = attempt('suppliers', 'Supplier ledger', function () {
            if (!window.mmPosition || typeof mmPosition.suppliers !== 'function') return null;
            var pays = [];
            try { pays = JSON.parse(localStorage.getItem('mm_supplier_payments') || '[]') || []; } catch (e) {}
            var res = mmPosition.suppliers(pays);
            var rows = ((res && res.data) || []).filter(function (r) {
                return Math.abs(num(r.purchased)) > 0.005 || Math.abs(num(r.balance)) > 0.005;
            });
            return rows.length ? rows : null;
        });
        out.staff = attempt('staff', 'Staff cost', function () {
            var exp = [];
            try { exp = JSON.parse(localStorage.getItem('mm_expenses') || '[]') || []; } catch (e) {}
            var rows = exp.filter(function (r) {
                if (!r || !(r.staffId || r.staffName)) return false;
                var d = d10(r.date);
                return d >= fy.from && d <= fy.to;   // the pack's year, not all time
            });
            return rows.length ? rows : null;
        });
        out.customers = attempt('customers', 'Customer ledger', function () {
            var cust = [];
            try { cust = JSON.parse(localStorage.getItem('mm_customers') || '[]') || []; } catch (e) {}
            var rows = cust.filter(function (c) { return num(c && c.balance) > 0.005; })
                           .sort(function (a, b) { return num(b.balance) - num(a.balance); });
            return rows.length ? rows : null;
        });

        out.tally = attempt('tally', 'Tally XML', function () {
            return window.mmTally && mmTally.build({
                from: fy.from, to: fy.to,
                sales: true, purchases: true, expenses: true, returns: true
            });
        });

        // GSTR-1 is filed monthly, so the pack carries all twelve returns of the
        // year rather than one impossible annual file.
        out.gstr1 = [];
        if (opts.gstin && window.mmGstr1 && typeof mmGstr1.build === 'function') {
            var y = +fy.from.slice(0, 4);
            for (var i = 0; i < 12; i++) {
                var mm = ((3 + i) % 12) + 1;
                var yy = (mm >= 4) ? y : y + 1;
                /* YYYY-MM, NOT the portal's MMYYYY. mmGstr1 filters bills with
                   `date.slice(0,7)` and converts to MMYYYY itself for the `fp`
                   field (gstr1-export.js:53-57). Passing the portal format here
                   matched zero bills in every month and emptied the entire GST
                   section of the pack without erroring — the summary just said
                   nothing was filed that year. */
                var month = String(yy) + '-' + String(mm).padStart(2, '0');
                try {
                    var g = mmGstr1.build({ month: month, gstin: opts.gstin });
                    if (g && g.summary && g.summary.bills) out.gstr1.push({ month: month, res: g });
                } catch (e) {}
            }
            if (out.gstr1.length) out.built.push('GSTR-1 (' + out.gstr1.length + ' month(s))');
            else out.missing.push('GSTR-1 — no bills in this year');
        } else if (!opts.gstin) {
            out.missing.push('GSTR-1 — no GSTIN in Shop Setup');
        }

        return out;
    }

    /* ── rendering ────────────────────────────────────────────────────────── */

    function row(label, value, cls) {
        return '<tr class="' + (cls || '') + '"><td>' + esc(label) +
               '</td><td class="n">' + (value == null ? '' : inr(value)) + '</td></tr>';
    }

    function section(title, body, note) {
        return '<section><h2>' + esc(title) + '</h2>' +
               (note ? '<p class="note">' + note + '</p>' : '') + body + '</section>';
    }

    function pnlHtml(p) {
        if (!p) return '';
        var s = '<table class="fin">';
        s += row('Sales (taxable)', p.sales.taxable);
        s += row('Less: Sales returns', -p.salesReturns.taxable);
        s += row('Net sales', p.netSales, 'sub');
        s += row('Opening stock', p.stock.opening);
        s += row('Add: Purchases', p.netPurchases);
        s += row('Less: Closing stock', -p.stock.closing);
        s += row('Cost of goods sold', p.cogs, 'sub');
        s += row('Gross profit', p.grossProfit, 'tot');
        s += row('Less: Expenses', -p.expenses.total);
        if (p.expenses.depreciation) s += row('   of which depreciation', -p.expenses.depreciation, 'dim');
        if (p.expenses.loanInterest) s += row('   of which loan interest', -p.expenses.loanInterest, 'dim');
        s += row('Net profit', p.netProfit, 'tot');
        s += '</table>';
        s += '<p class="meta">Opening stock ' + esc(p.stock.openingSource) +
             ' · gross margin ' + (p.netSales ? r2(p.grossProfit / p.netSales * 100) : 0) + '%' +
             ' · net margin ' + p.netPct + '%</p>';
        return section('Profit & Loss', s);
    }

    function positionHtml(q) {
        if (!q) return '';
        var s = '<table class="fin">';
        s += row('Stock at cost', q.stock);
        s += row('Money owed to you (khata)', q.debtors);
        s += row('Cash in hand', q.cash);
        s += row('Bank', q.bank);
        s += row('Fixed assets (written-down value)', q.assets);
        s += row('Deposits', q.deposits);
        s += row('What the business holds', q.assetSide, 'tot');
        s += row('Owed to suppliers', q.creditors);
        s += row('Loans outstanding', q.loans);
        /* GST ONLY COUNTS AS A LIABILITY WHEN IT IS POSITIVE. mmPosition uses
           Math.max(0, gstNet), because a negative net is input credit the shop
           is owed — a receivable, not something it owes. Printing the raw
           negative on a line above the total left the column short by exactly
           that amount, which is the first thing an accountant checks and the
           fastest way to lose their confidence in the rest of the pack.
           The payable line carries the figure the total actually uses; a credit
           position is stated separately, below the total, where it cannot
           imply it was added in. */
        var gstPayable = Math.max(0, num(q.gstNet));
        s += row('GST payable (net)', gstPayable);
        s += row('What the business owes', q.liabilitySide, 'tot');
        if (num(q.gstNet) < 0) {
            s += row('GST credit due back to you (not counted above)', -num(q.gstNet), 'dim');
        }
        s += row('Owner’s capital introduced', q.capital);
        s += '</table>';
        var foots = Math.abs(r2(num(q.creditors) + gstPayable + num(q.loans)) - r2(q.liabilitySide)) < 0.02;
        return section('Where the business stands, as at ' + dmy(q.asOf), s,
            foots ? '' : '<strong>The liabilities column does not add up — please tell your ' +
                         'software provider before relying on this page.</strong>');
    }

    function assetsHtml(a) {
        if (!a || !a.rows.length) return '';
        var s = '<table class="grid"><thead><tr><th>Asset</th><th>Method</th><th class="n">Rate</th>' +
                '<th class="n">Opening WDV</th><th class="n">Additions</th>' +
                '<th class="n">Depreciation</th><th class="n">Closing WDV</th></tr></thead><tbody>';
        a.rows.forEach(function (r) {
            s += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.method) + '</td>' +
                 '<td class="n">' + (r.rate ? r.rate + '%' : '—') + '</td>' +
                 '<td class="n">' + inr(r.openingWdv) + '</td>' +
                 '<td class="n">' + inr(r.additions) + '</td>' +
                 '<td class="n">' + inr(r.depreciation) + '</td>' +
                 '<td class="n">' + inr(r.closingWdv) + '</td></tr>';
        });
        s += '</tbody><tfoot><tr><td colspan="3">Total</td>' +
             '<td class="n">' + inr(a.openingWdv) + '</td>' +
             '<td class="n">' + inr(a.additions) + '</td>' +
             '<td class="n">' + inr(a.depreciation) + '</td>' +
             '<td class="n">' + inr(a.closingWdv) + '</td></tr></tfoot></table>';
        return section('Fixed asset register',
            s, 'Depreciation is <strong>derived</strong> from cost, method and rate every time ' +
               'this is built — it is never stored, so it cannot drift from the asset it belongs to.');
    }

    function loansHtml(l) {
        if (!l || !l.rows.length) return '';
        var s = '<table class="grid"><thead><tr><th>Loan</th><th>Lender</th>' +
                '<th class="n">Opening</th><th class="n">Borrowed</th><th class="n">Repaid</th>' +
                '<th class="n">Interest</th><th class="n">Closing</th></tr></thead><tbody>';
        l.rows.forEach(function (r) {
            s += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.lender || '—') + '</td>' +
                 '<td class="n">' + inr(r.opening) + '</td>' +
                 '<td class="n">' + inr(r.borrowed) + '</td>' +
                 '<td class="n">' + inr(r.repaid) + '</td>' +
                 '<td class="n">' + inr(r.interest) + '</td>' +
                 '<td class="n">' + inr(r.closing) + '</td></tr>';
        });
        s += '</tbody><tfoot><tr><td colspan="2">Total</td>' +
             '<td class="n">' + inr(l.opening) + '</td>' +
             '<td class="n">' + inr(l.borrowed) + '</td>' +
             '<td class="n">' + inr(l.repaid) + '</td>' +
             '<td class="n">' + inr(l.interest) + '</td>' +
             '<td class="n">' + inr(l.closing) + '</td></tr></tfoot></table>';
        return section('Loan schedule', s,
            'Interest is shown separately from principal because only the interest is an expense.');
    }

    /* CASH FLOW. A P&L answers "did I make money"; this answers "then where did
       it go", which is the question an owner actually asks and the one a
       profit statement structurally cannot. mmPnl already builds the bridge
       (pnl.js:632) — each item computed from source, with whatever the named
       items cannot explain shown as a residual rather than forced to zero. */
    function cashHtml(p) {
        if (!p || !p.cash) return '';
        var c = p.cash;
        var s = '<table class="fin">';
        s += row('Counter collections', c.counter);
        if (c.byMode) {
            s += row('   cash', c.byMode.cash, 'dim');
            s += row('   UPI', c.byMode.upi, 'dim');
            s += row('   card', c.byMode.card, 'dim');
        }
        s += row('Khata collections', c.khata);
        s += row('Money in', c.inTotal, 'sub');
        s += row('Paid to suppliers', -num(c.suppliers));
        s += row('Expenses paid', -num(c.expenses));
        s += row('Money out', c.outTotal, 'sub');
        s += row('Net cash movement', c.net, 'tot');
        s += '</table>';

        var b = '';
        if (c.bridge && c.bridge.length) {
            b = '<h3 style="font-size:0.95rem;margin:22px 0 6px;">From profit to cash</h3>' +
                '<table class="fin">';
            c.bridge.forEach(function (x) {
                b += row(x.label, x.amount, x.residual ? 'dim' : '');
            });
            b += row('Net cash movement', c.net, 'tot') + '</table>';
        }
        return section('Cash flow', s + b,
            'Profit and cash are computed independently and then reconciled. ' +
            'Anything the named lines cannot explain is shown as a residual rather ' +
            'than forced to zero — a statement that admits what it cannot explain ' +
            'is worth more than one that always balances.');
    }

    /* LEDGERS. The position page gives two totals — owed to suppliers, owed to
       you. An accountant needs the names behind them, because that is what a
       confirmation letter is written against. */
    function supplierLedgerHtml(rows) {
        if (!rows || !rows.length) return '';
        var s = '<table class="grid"><thead><tr><th>Supplier</th><th class="n">Purchased</th>' +
                '<th class="n">Returns</th><th class="n">Paid</th><th class="n">Balance owed</th>' +
                '</tr></thead><tbody>';
        /* ONLY POSITIVE BALANCES ARE "OWED". mmPosition counts a supplier as a
           creditor only where balance > 0 — a NEGATIVE balance means the shop
           has paid more than it has bought, which is an advance sitting with
           the supplier: a receivable, not a payable. Totalling the column raw
           made the ledger disagree with the "Owed to suppliers" figure on the
           page above it, which is the same defect as the GST row and just as
           quick for an accountant to spot. Advances are stated separately,
           below, so nothing is hidden and nothing is double-counted. */
        var t = { p: 0, r: 0, pd: 0, owed: 0, adv: 0 };
        rows.forEach(function (r) {
            var bal = num(r.balance);
            t.p += num(r.purchased); t.r += num(r.returned); t.pd += num(r.paid);
            if (bal > 0.005) t.owed += bal; else t.adv += -bal;
            s += '<tr><td>' + esc(r.firm) + '</td><td class="n">' + inr(r.purchased) + '</td>' +
                 '<td class="n">' + inr(r.returned) + '</td><td class="n">' + inr(r.paid) + '</td>' +
                 '<td class="n">' + (bal > 0.005 ? inr(bal) : '—') + '</td></tr>';
        });
        s += '</tbody><tfoot><tr><td>Total owed</td><td class="n">' + inr(t.p) + '</td>' +
             '<td class="n">' + inr(t.r) + '</td><td class="n">' + inr(t.pd) + '</td>' +
             '<td class="n">' + inr(t.owed) + '</td></tr></tfoot></table>';
        if (t.adv > 0.005) {
            s += '<p class="meta">Advances paid and not yet bought against: <strong>' +
                 inr(t.adv) + '</strong>. These are money the supplier holds for you, ' +
                 'so they are <em>not</em> part of the total owed above.</p>';
        }
        return section('Supplier ledger', s,
            'Balance = purchases − returns − payments. Purchases are lifetime, not ' +
            'this year only, because a balance owed is a balance owed whenever it arose.');
    }

    /* STAFF COST. Sits inside the P&L's expense total already — this breaks it
       out by person, which is what an accountant asks for and what a wage
       lump cannot answer. Read from the expense rows themselves rather than
       from a staff table, because the expense IS the payment: one money path,
       so this can never total to something the P&L disagrees with. */
    function staffHtml(rows) {
        if (!rows || !rows.length) return '';
        var byPerson = {};
        var types = {};
        var total = 0;
        rows.forEach(function (r) {
            var nm = String(r.staffName || 'Unnamed').trim() || 'Unnamed';
            var amt = num(r.amount);
            if (!byPerson[nm]) byPerson[nm] = { paid: 0, days: 0, n: 0 };
            byPerson[nm].paid += amt;
            byPerson[nm].days += num(r.days);
            byPerson[nm].n += 1;
            var ty = String(r.payType || 'Salary');
            types[ty] = (types[ty] || 0) + amt;
            total += amt;
        });
        var names = Object.keys(byPerson).sort(function (a, b) {
            return byPerson[b].paid - byPerson[a].paid;
        });
        var anyDays = names.some(function (n) { return byPerson[n].days > 0; });

        var s = '<table class="grid"><thead><tr><th>Person</th><th class="n">Payments</th>' +
                (anyDays ? '<th class="n">Days</th>' : '') +
                '<th class="n">Total paid</th></tr></thead><tbody>';
        names.forEach(function (n) {
            var p = byPerson[n];
            s += '<tr><td>' + esc(n) + '</td><td class="n">' + p.n + '</td>' +
                 (anyDays ? '<td class="n">' + (p.days ? p.days : '—') + '</td>' : '') +
                 '<td class="n">' + inr(p.paid) + '</td></tr>';
        });
        s += '</tbody><tfoot><tr><td>Total</td><td class="n">' + rows.length + '</td>' +
             (anyDays ? '<td class="n"></td>' : '') +
             '<td class="n">' + inr(total) + '</td></tr></tfoot></table>';

        var byType = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; });
        if (byType.length > 1) {
            s += '<h3 style="font-size:0.95rem;margin:20px 0 6px;">By kind of payment</h3><table class="fin">';
            byType.forEach(function (t) { s += row(t, types[t]); });
            s += row('Total', total, 'tot') + '</table>';
        }
        return section('Staff cost', s,
            'These payments are already inside “Less: Expenses” in the Profit &amp; Loss — ' +
            'this is the same money broken out by person, not an addition to it. ' +
            'An advance is shown in the period it was paid.');
    }

    function customerLedgerHtml(rows) {
        if (!rows || !rows.length) return '';
        var s = '<table class="grid"><thead><tr><th>Customer</th><th>Phone</th>' +
                '<th class="n">Balance due</th></tr></thead><tbody>';
        var tot = 0;
        rows.forEach(function (c) {
            tot += num(c.balance);
            s += '<tr><td>' + esc(c.name || '—') + '</td><td>' + esc(c.phone || '') + '</td>' +
                 '<td class="n">' + inr(c.balance) + '</td></tr>';
        });
        s += '</tbody><tfoot><tr><td colspan="2">Total owed to the shop</td>' +
             '<td class="n">' + inr(tot) + '</td></tr></tfoot></table>';
        return section('Customer ledger (khata)', s,
            'Outstanding balances only — customers who have settled are not listed.');
    }

    function gstHtml(pack) {
        if (!pack.gstr1.length) return '';
        var s = '<table class="grid"><thead><tr><th>Month</th><th class="n">Bills</th>' +
                '<th class="n">Taxable</th><th class="n">Tax</th></tr></thead><tbody>';
        var tT = 0, tX = 0, tB = 0;
        pack.gstr1.forEach(function (g) {
            var u = g.res.summary;
            tT += num(u.taxable); tX += num(u.tax); tB += num(u.bills);
            s += '<tr><td>' + esc(monthName(g.month)) + '</td><td class="n">' + u.bills + '</td>' +
                 '<td class="n">' + inr(u.taxable) + '</td><td class="n">' + inr(u.tax) + '</td></tr>';
        });
        s += '</tbody><tfoot><tr><td>Total</td><td class="n">' + tB + '</td>' +
             '<td class="n">' + inr(tT) + '</td><td class="n">' + inr(tX) + '</td></tr></tfoot></table>';
        return section('GST — outward supplies by month', s,
            'These are the GSTR-1 figures as this app would file them. The JSON for each month ' +
            'is attached below.');
    }

    // Attachments as data: URIs so they survive the file being saved, emailed
    // and reopened somewhere else. A blob: URL would be dead on arrival.
    function attachment(name, mime, text) {
        var uri = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);
        return '<li><a download="' + esc(name) + '" href="' + uri + '">' + esc(name) + '</a> ' +
               '<span class="dim">(' + Math.ceil(text.length / 1024) + ' KB)</span></li>';
    }

    function attachmentsHtml(pack) {
        var items = '';
        if (pack.tally && pack.tally.xml) {
            items += attachment('Tally-' + pack.fy.label.replace(/[^\w–-]/g, '') + '.xml',
                                'application/xml', pack.tally.xml);
        }
        pack.gstr1.forEach(function (g) {
            items += attachment('GSTR1-' + g.month + '.json', 'application/json',
                                JSON.stringify(g.res.json, null, 2));
        });
        if (!items) return '';
        return section('Attached files',
            '<ul class="files">' + items + '</ul>',
            'Click to save. These are inside this HTML file, so they travel with it.');
    }

    function warningsHtml(pack) {
        var w = (pack.pnl && pack.pnl.warnings) || [];
        var items = '';
        w.forEach(function (x) {
            items += '<li>' + esc(typeof x === 'string' ? x : (x && x.text) || '') + '</li>';
        });
        pack.missing.forEach(function (m) { items += '<li>Not included: ' + esc(m) + '</li>'; });
        if (!items) return '';
        /* Surfaced at the TOP of the pack, not buried at the end. An accountant
           who finds out on page six that the opening stock was a guess has
           already done five pages of work on it. */
        return section('Read this first — ' + (w.length + pack.missing.length) + ' point(s) to check',
            '<ul class="warn">' + items + '</ul>');
    }

    function render(pack) {
        var sp = shopProfile();
        var name = shopName(sp) || 'Shop';
        var title = name + ' — Year-End Pack — ' + pack.fy.label;
        var css =
            'body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;padding:32px;background:#fff;}' +
            '.wrap{max-width:900px;margin:0 auto;}' +
            'h1{font-size:1.6rem;margin:0 0 4px;}h2{font-size:1.05rem;margin:32px 0 10px;padding-bottom:6px;border-bottom:2px solid #0f172a;}' +
            '.sub{color:#475569;margin:0 0 24px;}' +
            'table{width:100%;border-collapse:collapse;margin:8px 0;}' +
            'td,th{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;}' +
            'th{background:#f8fafc;font-size:0.8rem;text-transform:uppercase;letter-spacing:.04em;}' +
            '.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
            '.fin td:first-child{width:60%;}' +
            'tr.sub td{font-weight:600;background:#f8fafc;}' +
            'tr.tot td{font-weight:800;border-top:2px solid #0f172a;border-bottom:2px solid #0f172a;}' +
            'tr.dim td{color:#64748b;font-size:0.9em;}' +
            'tfoot td{font-weight:800;background:#f1f5f9;}' +
            '.note,.meta{color:#475569;font-size:0.86rem;margin:6px 0 0;}' +
            '.warn li{margin:4px 0;}ul.warn{background:#fffbeb;border:1px solid #fde68a;padding:12px 12px 12px 28px;border-radius:8px;}' +
            'ul.files{padding-left:20px;}ul.files li{margin:5px 0;}' +
            '.dim{color:#94a3b8;}' +
            'footer{margin-top:40px;padding-top:14px;border-top:1px solid #e2e8f0;color:#64748b;font-size:0.8rem;}' +
            '@media print{body{padding:0;}section{break-inside:avoid;}h2{break-after:avoid;}}';

        var head = '<h1>' + esc(name) + '</h1>' +
            '<p class="sub">' +
            (sp.gstin ? 'GSTIN ' + esc(sp.gstin) + ' · ' : '') +
            esc(pack.fy.label) + ' · ' + dmy(pack.fy.from) + ' to ' + dmy(pack.fy.to) +
            '<br>Prepared ' + dmy(todayLocal()) + ' from Billware' +
            '</p>';

        return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>' + esc(title) + '</title><style>' + css + '</style></head><body><div class="wrap">' +
            head +
            warningsHtml(pack) +
            pnlHtml(pack.pnl) +
            staffHtml(pack.staff) +
            cashHtml(pack.pnl) +
            positionHtml(pack.position) +
            supplierLedgerHtml(pack.suppliers) +
            customerLedgerHtml(pack.customers) +
            assetsHtml(pack.assets) +
            loansHtml(pack.loans) +
            gstHtml(pack) +
            attachmentsHtml(pack) +
            '<footer>Every figure in this pack is produced by the same code that draws it on ' +
            'screen in the app — there is no second calculation here. Where a figure could not ' +
            'be produced it is named under “Read this first” rather than shown as zero.</footer>' +
            '</div></body></html>';
    }

    /* ── public ───────────────────────────────────────────────────────────── */

    function build(opts) {
        opts = opts || {};
        var fy = opts.from && opts.to
            ? { from: d10(opts.from), to: d10(opts.to),
                label: opts.label || (dmy(opts.from) + ' to ' + dmy(opts.to)) }
            : fyOf(opts.asOf || todayLocal());
        var sp = shopProfile();
        var pack = gather(fy, { gstin: opts.gstin || sp.gstin || '' });
        pack.html = render(pack);
        return pack;
    }

    window.mmYearEnd = {
        build: build,
        fyOf: fyOf,
        availableYears: availableYears,
        // exported so the harness can check the arithmetic without rebuilding it
        _inr: inr, _dmy: dmy, _render: render, _gather: gather
    };
})();
