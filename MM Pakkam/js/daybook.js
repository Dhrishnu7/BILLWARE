/* ══════════════════════════════════════════════════════════════════════
   daybook.js — every transaction of a day, in the order it happened

   WHAT IT IS
   The list a shop tallies the till against at closing, and the one the
   accountant asks for when a figure looks odd. Sales, purchases, expenses,
   customer receipts, supplier payments and returns, merged into a single
   chronological run with a running cash movement beside it.

   ONE HONEST LIMITATION, STATED IN THE UI
   The app has no cash-in-hand ledger — nobody tells it what was in the
   drawer this morning. So the running figure is a MOVEMENT from zero, not a
   balance. Calling it "closing cash" would be inventing an opening balance,
   and a number that looks authoritative and is not is worse than no number.

   WHAT COUNTS AS CASH
   A credit sale is not cash: it moves to the khata and shows here with a
   dash. Money arrives later as a customer payment, which is its own row.
   A purchase is not cash either — it becomes cash when a supplier payment
   is recorded (the Purchase screen's "Paid now" writes one).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function num(n) { return Number(n) || 0; }
    function r2(n)  { return Math.round(num(n) * 100) / 100; }
    function key(s) { return String(s || '').trim().toLowerCase(); }
    function d10(s) { return String(s || '').slice(0, 10); }

    function readJson(k) {
        try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { return []; }
    }

    function inRange(d, from, to) {
        var s = d10(d);
        if (!s) return false;
        if (from && s < from) return false;
        if (to   && s > to)   return false;
        return true;
    }

    /* Bills carry a savedAt timestamp; most other records carry only a date.
       Sorting by date then by whatever time exists keeps a day's real order
       where it is known and is stable where it is not.

       savedAt is stored in UTC (new Date().toISOString()). Slicing the string
       would print a bill taken at 2:44 pm as 09:14 — five and a half hours
       adrift, and wrong in a way that looks perfectly plausible on a day book.
       It is converted to the machine's own clock instead. */
    function timeOf(dateStr, savedAt) {
        var t = String(savedAt || '');
        if (t.length < 10 || t.indexOf('T') < 0) return '';
        var dt = new Date(t);
        if (isNaN(dt.getTime())) return t.length >= 19 ? t.slice(11, 19) : '';
        var h = dt.getHours(), m = dt.getMinutes(), s = dt.getSeconds();
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function isCashMode(mode) {
        var m = key(mode);
        return m === 'cash' || m === 'upi' || m === 'card' || m === '';
    }

    /* ──────────────────────────────────────────────────────────────────
       load({ from, to }) → { rows, totals, days }
    ────────────────────────────────────────────────────────────────── */
    function load(opts) {
        opts = opts || {};
        var from = d10(opts.from), to = d10(opts.to);
        var rows = [];

        /* ── Sales ── */
        readJson('mm_sales').forEach(function (b) {
            if (b.isReturn) return;                 // handled via returns below
            if (!inRange(b.date, from, to)) return;
            var lineSum = 0;
            (b.medicines || []).forEach(function (m) { lineSum += num(m.total); });
            var amt  = num(b.grandTotal || b.total) || lineSum;
            var mode = key(b.paymentMode) || 'cash';
            rows.push({
                date: d10(b.date), time: timeOf(b.date, b.savedAt),
                kind: 'Sale', ref: String(b.billNo || '—'),
                party: String(b.customerName || '').trim() || 'Walk-in',
                mode: mode === 'credit' ? 'Credit' : (mode.toUpperCase() === 'UPI' ? 'UPI' : cap(mode)),
                amount: r2(amt),
                cash: mode === 'credit' ? 0 : r2(amt),
                note: mode === 'credit' ? 'To khata' : '',
                items: (b.medicines || []).length
            });
        });

        /* ── Purchases. Grouped to one row per supplier invoice: the app
             stores one record per product line, and a day book listing the
             same invoice eleven times is not a day book. ── */
        var pGroups = {};
        readJson('mm_purchases').forEach(function (p) {
            if (!inRange(p.date, from, to)) return;
            var taxable = num(p.quantity) * num(p.rate);
            var gross   = taxable * (1 + num(p.gst) / 100);
            var firm    = String(p.firm || '').trim() || 'Supplier';
            var no      = String(p.billNo || p.bill_no || '').trim();
            var gk      = d10(p.date) + '|' + key(firm) + '|' + key(no);
            if (!pGroups[gk]) {
                pGroups[gk] = {
                    date: d10(p.date), time: timeOf(p.date, p.savedAt),
                    kind: 'Purchase', ref: no || '—', party: firm,
                    mode: '—', amount: 0, cash: 0, note: 'On account', items: 0
                };
            }
            pGroups[gk].amount += gross;
            pGroups[gk].items++;
        });
        Object.keys(pGroups).forEach(function (k) {
            var g = pGroups[k];
            g.amount = r2(g.amount);
            rows.push(g);
        });

        /* ── Expenses ── */
        readJson('mm_expenses').forEach(function (e) {
            if (!inRange(e.date, from, to)) return;
            rows.push({
                date: d10(e.date), time: timeOf(e.date, e.savedAt),
                kind: 'Expense', ref: '—',
                party: String(e.category || 'Other'),
                mode: cap(e.paymentMode || 'Cash'),
                amount: r2(num(e.amount)),
                cash: -r2(num(e.amount)),
                note: String(e.note || ''), items: 0
            });
        });

        /* ── Customer receipts (khata settlements) ── */
        readJson('mm_customer_payments').forEach(function (p) {
            if (!inRange(p.date, from, to)) return;
            rows.push({
                date: d10(p.date), time: timeOf(p.date, p.savedAt),
                kind: 'Receipt', ref: '—',
                party: String(p.name || '').trim() || 'Customer',
                mode: '—', amount: r2(num(p.amount)), cash: r2(num(p.amount)),
                note: String(p.note || 'Against khata'), items: 0
            });
        });

        /* ── Supplier payments ── */
        readJson('mm_supplier_payments').forEach(function (p) {
            if (!inRange(p.date, from, to)) return;
            rows.push({
                date: d10(p.date), time: timeOf(p.date, p.savedAt),
                kind: 'Payment', ref: '—',
                party: String(p.firm || '').trim() || 'Supplier',
                mode: '—', amount: r2(num(p.amount)), cash: -r2(num(p.amount)),
                note: String(p.note || ''), items: 0
            });
        });

        /* ── Returns. The money is real whether or not the tax could be
             recovered, so a note that the P&L had to exclude still appears
             here — flagged, so the two reports never look contradictory. ── */
        if (window.mmReturns && typeof window.mmReturns.load === 'function') {
            try {
                var rets = window.mmReturns.load({ from: from, to: to });
                rets.creditNotes.forEach(function (n) {
                    var cashOut = isCashMode(n.mode) ? -r2(n.gross) : 0;
                    rows.push({
                        date: d10(n.date), time: '',
                        kind: 'Credit Note', ref: String(n.no || '—'),
                        party: String(n.customerName || n.party || '').trim() || 'Walk-in',
                        mode: n.mode ? cap(n.mode) : '—',
                        amount: r2(n.gross), cash: cashOut,
                        note: (n.ref ? 'Against ' + n.ref : '') + (n.usable ? '' : ' · tax not readable'),
                        flag: !n.usable, items: (n.lines || []).length
                    });
                });
                rets.debitNotes.forEach(function (n) {
                    rows.push({
                        date: d10(n.date), time: '',
                        kind: 'Debit Note', ref: String(n.no || '—'),
                        party: String(n.party || '').trim() || 'Supplier',
                        mode: '—', amount: r2(n.gross), cash: 0,
                        note: 'Returned to supplier' + (n.usable ? '' : ' · tax not readable'),
                        flag: !n.usable, items: (n.lines || []).length
                    });
                });
            } catch (e) {}
        }

        /* Chronological, with a stable tie-break so the same data always
           renders in the same order. */
        var order = { 'Sale': 1, 'Credit Note': 2, 'Receipt': 3, 'Purchase': 4, 'Debit Note': 5, 'Payment': 6, 'Expense': 7 };
        rows.sort(function (a, b) {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.time !== b.time) return String(a.time).localeCompare(String(b.time));
            if (order[a.kind] !== order[b.kind]) return (order[a.kind] || 9) - (order[b.kind] || 9);
            return String(a.ref).localeCompare(String(b.ref));
        });

        var running = 0, totals = { in: 0, out: 0, sales: 0, purchases: 0, count: rows.length };
        var days = {};
        rows.forEach(function (r) {
            running += r.cash;
            r.running = r2(running);
            if (r.cash > 0) totals.in  += r.cash;
            if (r.cash < 0) totals.out += -r.cash;
            if (r.kind === 'Sale')     totals.sales     += r.amount;
            if (r.kind === 'Purchase') totals.purchases += r.amount;
            if (!days[r.date]) days[r.date] = { date: r.date, count: 0, cash: 0 };
            days[r.date].count++;
            days[r.date].cash += r.cash;
        });

        return {
            rows: rows,
            totals: {
                in: r2(totals.in), out: r2(totals.out), net: r2(totals.in - totals.out),
                sales: r2(totals.sales), purchases: r2(totals.purchases), count: totals.count
            },
            days: Object.keys(days).sort().map(function (d) {
                return { date: d, count: days[d].count, cash: r2(days[d].cash) };
            })
        };
    }

    function cap(s) {
        var t = String(s || '');
        if (!t) return '';
        if (t.toLowerCase() === 'upi') return 'UPI';
        return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }

    window.mmDayBook = { load: load };
})();
