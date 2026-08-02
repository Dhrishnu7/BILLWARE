/* ══════════════════════════════════════════════════════════════════════
   prefile-check.js  —  run the portal's objections before the portal does
   ══════════════════════════════════════════════════════════════════════
   The GST portal, Tally and the IRP all validate what you send them and
   reject the whole file over one bad row. They do it days or weeks after
   the sale, in a language that names the rule and not the bill. This runs
   the same rules over a chosen period, on demand, and names the BILL.

   Two rules about what belongs in here:

   1. Every check must correspond to something a real system rejects. A
      house-style preference dressed up as an error teaches the shop to
      ignore the whole screen.
   2. Nothing is auto-corrected. Every finding names the document so a
      human can go and look at the paper. Silently "fixing" a total is how
      you file a return that no longer matches your own books.

   BLOCK = this will be rejected.  WARN = this is probably wrong, but it
   will file. The distinction is the point; a list where everything is red
   is a list nobody reads.

   ES5, same as its siblings, so the MSHTML harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function num(n) { return Number(n) || 0; }
    function str(s) { return String(s == null ? '' : s).trim(); }
    function key(s) { return str(s).toLowerCase(); }

    function ls(k, dflt) {
        try { return JSON.parse(localStorage.getItem(k) || dflt); }
        catch (e) { return JSON.parse(dflt); }
    }

    /* The validators are shared with the entry-time checks on purpose. If
       the two ever disagreed, a shop could type something the Directory
       accepted and this screen rejected, with no way to satisfy both. */
    function V() {
        return window.mmGstValid || null;
    }

    function inPeriod(d, from, to) {
        var s = str(d).slice(0, 10);
        if (!s) return false;
        if (from && s < from) return false;
        if (to && s > to) return false;
        return true;
    }

    /* ──────────────────────────────────────────────────────────────────
       run({ from, to })
       Returns { blocks:[], warns:[], counts:{}, ok:bool }
       Each finding: { id, title, why, rows:[{label, detail}], fix }
       `fix` names a repair the Report page already knows how to open.
    ────────────────────────────────────────────────────────────────── */
    function run(opts) {
        opts = opts || {};
        var from = str(opts.from), to = str(opts.to);
        var v = V();

        var bills = ls('mm_sales', '[]') || [];
        var custs = ls('mm_customers', '[]') || [];
        var sups  = ls('mm_suppliers', '[]') || [];
        var shop  = window.mmShopProfile || {};

        bills = bills.filter(function (b) { return inPeriod(b.date, from, to); });

        var blocks = [], warns = [];
        function add(list, id, title, why, rows, fix) {
            if (!rows.length) return;
            list.push({ id: id, title: title, why: why, rows: rows, fix: fix || null });
        }

        /* ── 1. The shop itself ─────────────────────────────────────────
           Checked first because every one of these poisons every document
           in the file, not one row of it. */
        var shopRows = [];
        var sg = str(shop.gstin);
        if (!sg) {
            shopRows.push({ label: 'GSTIN missing',
                detail: 'Every return is filed under it. Set it in Shop Setup.' });
        } else if (v) {
            var sgr = v.gstin(sg);
            if (!sgr.ok) shopRows.push({ label: 'GSTIN "' + sg + '"', detail: sgr.reason });
        }
        if (!str(shop.shop_name)) shopRows.push({ label: 'Shop name missing', detail: 'Required on every invoice.' });
        if (!str(shop.address_line1)) shopRows.push({ label: 'Address missing', detail: 'Required on every invoice.' });
        add(blocks, 'shop', 'Your own shop details',
            'These appear on every document. One problem here stops the whole file.',
            shopRows, 'shop');

        /* ── 2. Bill-level structure ────────────────────────────────── */
        var noLines = [], badNo = [], dupNo = [], mismatch = [];
        var seen = {};
        for (var i = 0; i < bills.length; i++) {
            var b = bills[i];
            var no = str(b.billNo);
            var date = str(b.date).slice(0, 10);
            var meds = b.medicines || [];

            if (!meds.length) {
                noLines.push({ label: no || '(no number)', detail: date + ' — this bill has no items on it.' });
                continue;
            }

            if (v) {
                var dn = v.docNo(no);
                if (!dn.ok) badNo.push({ label: no || '(blank)', detail: date + ' — ' + dn.reason });
            }

            var k = key(no);
            if (k) {
                if (seen[k]) {
                    dupNo.push({ label: no,
                        detail: 'used on ' + seen[k] + ' and again on ' + date +
                                '. The portal rejects a repeated invoice number.' });
                } else { seen[k] = date; }
            }

            /* The invariant every downstream system enforces, and the one
               that produced the v252 Tally failure: what the bill says it
               came to must equal what its lines come to. A round-off of
               under a rupee is the till doing its job; more is a
               disagreement the shop needs to look at. */
            var lineSum = 0;
            for (var m = 0; m < meds.length; m++) lineSum += num(meds[m].total);
            var gt = num(b.grandTotal);
            if (gt && Math.abs(r2(gt - lineSum)) > 1) {
                mismatch.push({ label: no || '(no number)',
                    detail: date + ' — bill total ' + r2(gt).toFixed(2) +
                            ' but its lines add up to ' + r2(lineSum).toFixed(2) +
                            ' (out by ' + Math.abs(r2(gt - lineSum)).toFixed(2) + ')' });
            }
        }
        add(blocks, 'noLines', 'Bills with no items',
            'An invoice with no lines cannot be filed or exported.', noLines, 'bills');
        add(blocks, 'dupNo', 'Repeated bill numbers',
            'An invoice number must be unique for the financial year.', dupNo, 'bills');
        add(blocks, 'badNo', 'Bill numbers the portal will not accept',
            'Rule 46: at most 16 characters, letters, digits, "/" and "-" only.', badNo, 'bills');
        add(blocks, 'mismatch', 'Bills whose total does not match their lines',
            'Every export foots the lines against the total. These would be refused, ' +
            'and one of the two numbers is wrong in your books.', mismatch, 'bills');

        /* ── 3. Line-level tax data ─────────────────────────────────── */
        var noHsn = {}, badHsn = {}, badRate = {};
        for (var i2 = 0; i2 < bills.length; i2++) {
            var b2 = bills[i2], meds2 = b2.medicines || [];
            for (var m2 = 0; m2 < meds2.length; m2++) {
                var line = meds2[m2];
                var prod = str(line.product) || '(unnamed item)';
                var h = str(line.hsn);
                if (!h) { noHsn[prod] = (noHsn[prod] || 0) + 1; }
                else if (v && !v.hsn(h).ok) {
                    badHsn[prod + ' → ' + h] = (badHsn[prod + ' → ' + h] || 0) + 1;
                }
                var rt = num(line.gst);
                if (v && !v.rate(rt)) {
                    var rk = String(rt);
                    if (!badRate[rk]) badRate[rk] = { n: 0, eg: [] };
                    badRate[rk].n++;
                    if (badRate[rk].eg.length < 4) badRate[rk].eg.push(str(b2.billNo) + '/' + prod);
                }
            }
        }
        add(blocks, 'noHsn', 'Items with no HSN code',
            'The HSN summary is a mandatory table in GSTR-1.',
            Object.keys(noHsn).map(function (p) {
                return { label: p, detail: noHsn[p] + ' line(s)' };
            }), 'hsn');
        add(blocks, 'badHsn', 'HSN codes that are not the right shape',
            'An HSN code is 4, 6 or 8 digits.',
            Object.keys(badHsn).map(function (p) {
                return { label: p, detail: badHsn[p] + ' line(s)' };
            }), 'hsn');
        add(blocks, 'badRate', 'GST rates that do not exist',
            'The legal slabs are 0, 0.25, 3, 5, 12, 18 and 28 per cent. Anything else is refused.',
            Object.keys(badRate).map(function (r) {
                return { label: r + '%',
                         detail: badRate[r].n + ' line(s) — e.g. ' + badRate[r].eg.join(', ') };
            }), 'rate');

        /* ── 4. Buyers ──────────────────────────────────────────────────
           Only customers who actually appear on a bill in this period. A
           dormant record with a bad GSTIN is not this month's problem, and
           listing it trains the shop to scroll past the ones that are. */
        var used = {};
        for (var i3 = 0; i3 < bills.length; i3++) {
            var nm = key(bills[i3].customerName || bills[i3].customer_name);
            var cid = bills[i3].customerId || bills[i3].customer_id;
            if (nm) used[nm] = true;
            if (cid) used['#' + cid] = true;
        }
        var badBuyer = [];
        for (var c = 0; c < custs.length; c++) {
            var cu = custs[c];
            var g2 = str(cu.gstin);
            if (!g2) continue;                                   // counter customer, fine
            if (!used[key(cu.name)] && !used['#' + cu.id]) continue;
            if (!v) continue;
            var gr = v.gstin(g2);
            if (!gr.ok) {
                /* `gstin` is carried so the fixer can PRE-FILL the offending
                   value. Correcting a typo means seeing it next to the
                   letterhead; an empty box asks the shop to retype 15
                   characters they already have. */
                badBuyer.push({ label: str(cu.name) + ' — ' + g2, detail: gr.reason,
                                id: cu.id, name: str(cu.name), gstin: g2 });
            }
        }
        add(blocks, 'badBuyer', 'Customer GSTINs that cannot be right',
            'A B2B invoice is filed against the buyer\'s GSTIN. If it is wrong the row is ' +
            'rejected — and the buyer never gets the credit.',
            badBuyer, 'gstin');

        /* ── 5. Credit notes without their original ─────────────────────
           A credit note takes its tax treatment from the invoice it
           cancels; with the original gone there is nothing to inherit, and
           both exports already refuse. Surfaced here so it is not a
           surprise at download time. */
        if (window.mmReturns && typeof window.mmReturns.load === 'function') {
            try {
                var rets = window.mmReturns.load({ from: from, to: to });
                var orphan = (rets && rets.problems) || [];
                add(blocks, 'orphanNotes', 'Returns whose original document is missing',
                    'A credit or debit note copies the tax treatment of the document it reverses. ' +
                    'Without it nothing can be filed for these, and they are never estimated.',
                    /* mmReturns reports these as "CN-004: why" strings, not
                       objects — split so the note number reads as the label. */
                    orphan.map(function (p) {
                        var s = str(p), at = s.indexOf(':');
                        return at > 0
                            ? { label: s.slice(0, at), detail: s.slice(at + 1).replace(/^\s+/, '') }
                            : { label: 'return', detail: s };
                    }), 'returns');
            } catch (e) { /* returns module absent or mid-upgrade; not fatal here */ }
        }

        /* ── 6. Warnings ────────────────────────────────────────────────
           Real, but they file. Kept apart so the block list stays credible. */
        var badSup = [];
        for (var s2 = 0; s2 < sups.length; s2++) {
            var su = sups[s2], g3 = str(su.gstin);
            if (!g3 || !v) continue;
            var sr = v.gstin(g3);
            if (!sr.ok) badSup.push({ label: str(su.name) + ' — ' + g3, detail: sr.reason });
        }
        add(warns, 'badSupplier', 'Supplier GSTINs that cannot be right',
            'These do not affect your GSTR-1, but input credit is claimed against them.', badSup, 'suppliers');

        var posRows = [];
        if (!str(shop.city))    posRows.push({ label: 'Town / city not saved', detail: 'Needed only for e-invoice and e-way bills.' });
        if (!str(shop.pincode)) posRows.push({ label: 'PIN code not saved',    detail: 'Needed only for e-invoice and e-way bills.' });
        add(warns, 'shopPos', 'Shop town / PIN not recorded',
            'GSTR-1 and Tally do not need these. e-Invoice and e-way bills cannot be built without them.',
            posRows, 'shoppos');

        var counts = {
            bills: bills.length,
            blockFindings: blocks.length,
            warnFindings: warns.length,
            blockRows: blocks.reduce(function (n, f) { return n + f.rows.length; }, 0),
            warnRows: warns.reduce(function (n, f) { return n + f.rows.length; }, 0)
        };

        return {
            from: from, to: to,
            blocks: blocks, warns: warns, counts: counts,
            ok: blocks.length === 0,
            /* Never let a clean result read as "the portal will accept this". */
            cannotCheck: v ? v.notOnlineChecked() : []
        };
    }

    /* ══════════════════════════════════════════════════════════════════
       reconcile({ from, to })
       ══════════════════════════════════════════════════════════════════
       run() above checks the SHOP's data. This checks OURS.

       Every export re-derives taxable, tax and totals from the same bills
       by a different route, and twice now one of those routes has been
       quietly wrong in a way that looked perfect in the file: v252 (Tally
       vouchers that did not balance, because taxable was computed before
       discount) and v255 (e-way bills whose total excluded the till's
       round-off). Both were found by summing columns by hand, days later.

       So: rebuild each export and compare it, DOCUMENT BY DOCUMENT, with
       the bill it came from. A per-document check names the bill; an
       aggregate one only says the month is wrong somewhere. GSTR-1 is the
       exception — it is a summary return, so it is checked in total.

       A finding here is a bug in this app, not in the shop's data. The UI
       says so, because "there is a problem with bill SS-041" would send
       them looking at paperwork that is perfectly fine.
    ══════════════════════════════════════════════════════════════════ */
    function reconcile(opts) {
        opts = opts || {};
        var from = str(opts.from), to = str(opts.to);
        var TOL = 1;                       // same "more than a rupee is a disagreement" rule
        var checks = [], notes = [];

        var bills = (ls('mm_sales', '[]') || []).filter(function (b) {
            return inPeriod(b.date, from, to);
        });
        var byNo = {};
        bills.forEach(function (b) { byNo[key(b.billNo)] = b; });

        function billGross(b) { return r2(num(b && b.grandTotal)); }

        /* ── Tally: every sales voucher against its bill ───────────────── */
        if (window.mmTally && typeof window.mmTally.build === 'function') {
            try {
                var t = window.mmTally.build({ from: from, to: to,
                                               sales: true, purch: false, exp: false, ret: true });
                var tRows = [];
                (t.rows || []).forEach(function (row) {
                    if (row.kind !== 'Sales') return;
                    var b = byNo[key(row.num)];
                    if (!b) return;                       // a voucher with no bill is run()'s business
                    var d = r2(num(row.total) - billGross(b));
                    if (Math.abs(d) > TOL) {
                        tRows.push({ label: str(row.num),
                            detail: 'Tally voucher ' + r2(num(row.total)).toFixed(2) +
                                    ' vs bill ' + billGross(b).toFixed(2) +
                                    ' (out by ' + Math.abs(d).toFixed(2) + ')' });
                    }
                });
                /* The export's own footing guard, surfaced here so it is seen
                   before the download refuses. */
                (t.unbalanced || []).forEach(function (u) {
                    tRows.push({ label: str(u.num || u), detail: 'voucher debits do not equal credits' });
                });
                checks.push({ id: 'tally', title: 'Tally vouchers match their bills',
                              ran: true, rows: tRows,
                              summary: (t.counts ? t.counts.sales : 0) + ' sales voucher(s) checked' });
            } catch (e) {
                notes.push('Tally export could not be rebuilt: ' + (e && e.message ? e.message : e));
            }
        }

        /* ── e-Invoice: every invoice total against its bill ───────────── */
        if (window.mmEinvoice && typeof window.mmEinvoice.build === 'function') {
            try {
                var ei = window.mmEinvoice.build({ from: from, to: to });
                var eRows = [];
                (ei.einvoices || []).forEach(function (inv) {
                    var b2 = byNo[key(inv.DocDtls && inv.DocDtls.No)];
                    if (!b2) return;
                    var tot = r2(num(inv.ValDtls && inv.ValDtls.TotInvVal));
                    var d2 = r2(tot - billGross(b2));
                    if (Math.abs(d2) > TOL) {
                        eRows.push({ label: str(inv.DocDtls.No),
                            detail: 'e-invoice ' + tot.toFixed(2) + ' vs bill ' +
                                    billGross(b2).toFixed(2) +
                                    ' (out by ' + Math.abs(d2).toFixed(2) + ')' });
                    }
                    /* The invariant the IRP enforces per line, and the one the
                       e-way bill got wrong: the parts must foot to the total. */
                    var v2 = inv.ValDtls || {};
                    var foot = r2(num(v2.AssVal) + num(v2.CgstVal) + num(v2.SgstVal) +
                                  num(v2.IgstVal) + num(v2.RndOffAmt) - num(v2.TotInvVal));
                    if (Math.abs(foot) > 0.02) {
                        eRows.push({ label: str(inv.DocDtls.No),
                            detail: 'value + tax + round-off does not equal the invoice total (out by ' +
                                    Math.abs(foot).toFixed(2) + ')' });
                    }
                });
                /* Same footing rule on the e-way side. otherValue is where the
                   round-off lives there — the field that was hard-coded to 0
                   until v255. */
                (ei.ewbs || []).forEach(function (w) {
                    var f2 = r2(num(w.totalValue) + num(w.cgstValue) + num(w.sgstValue) +
                                num(w.igstValue) + num(w.cessValue) + num(w.cessNonAdvolValue) +
                                num(w.otherValue) - num(w.totInvValue));
                    if (Math.abs(f2) > 0.02) {
                        eRows.push({ label: str(w.docNo),
                            detail: 'e-way bill value + tax + other does not equal the invoice total (out by ' +
                                    Math.abs(f2).toFixed(2) + ')' });
                    }
                });
                checks.push({ id: 'einvoice', title: 'e-Invoice and e-way totals foot correctly',
                              ran: true, rows: eRows,
                              summary: (ei.einvoices || []).length + ' e-invoice(s), ' +
                                       (ei.ewbs || []).length + ' e-way bill(s) checked' });
            } catch (e) {
                notes.push('e-Invoice export could not be rebuilt: ' + (e && e.message ? e.message : e));
            }
        }

        /* ── GSTR-1: totals, not documents ─────────────────────────────
           A summary return has no per-document figure to compare, and it
           is built per CALENDAR MONTH — comparing it against an arbitrary
           date range would report a difference that is only the dates. */
        var m1 = str(from).slice(0, 7), m2 = str(to).slice(0, 7);
        var wholeMonth = m1 && m1 === m2 &&
                         str(from).slice(8) === '01' &&
                         Number(str(to).slice(8)) >= 28;
        if (window.mmGstr1 && typeof window.mmGstr1.build === 'function') {
            if (!wholeMonth) {
                notes.push('GSTR-1 is filed one calendar month at a time, so it was not ' +
                           'compared — set the dates to a whole month to include it.');
            } else {
                try {
                    var shop = window.mmShopProfile || {};
                    var g = window.mmGstr1.build({ month: m1, gstin: str(shop.gstin) });
                    var gRows = [];

                    /* Books, derived the way every export derives them: back out
                       of the tax-INCLUSIVE line total. */
                    var bookTax = 0, bookTaxable = 0;
                    bills.forEach(function (b3) {
                        (b3.medicines || []).forEach(function (m3) {
                            var tot3 = num(m3.total), rt3 = num(m3.gst);
                            var txv = tot3 / (1 + rt3 / 100);
                            bookTaxable += txv;
                            bookTax += tot3 - txv;
                        });
                    });
                    /* Credit notes are subtracted from the return, so they must
                       be subtracted from the books before comparing. */
                    if (window.mmReturns && typeof window.mmReturns.load === 'function') {
                        var rr = window.mmReturns.load({ from: from, to: to });
                        (rr.creditNotes || []).forEach(function (n) {
                            if (!n.usable) return;
                            bookTaxable -= num(n.taxable);
                            bookTax     -= num(n.tax);
                        });
                    }
                    var gs = g.summary || {};
                    var dTaxable = r2(num(gs.taxable) - bookTaxable);
                    var dTax     = r2(num(gs.tax) - bookTax);
                    if (Math.abs(dTaxable) > TOL) {
                        gRows.push({ label: 'Taxable value',
                            detail: 'GSTR-1 ' + r2(num(gs.taxable)).toFixed(2) + ' vs your books ' +
                                    r2(bookTaxable).toFixed(2) + ' (out by ' + Math.abs(dTaxable).toFixed(2) + ')' });
                    }
                    if (Math.abs(dTax) > TOL) {
                        gRows.push({ label: 'Tax',
                            detail: 'GSTR-1 ' + r2(num(gs.tax)).toFixed(2) + ' vs your books ' +
                                    r2(bookTax).toFixed(2) + ' (out by ' + Math.abs(dTax).toFixed(2) + ')' });
                    }
                    checks.push({ id: 'gstr1', title: 'GSTR-1 totals match your books',
                                  ran: true, rows: gRows,
                                  summary: 'taxable ' + r2(bookTaxable).toFixed(2) +
                                           ', tax ' + r2(bookTax).toFixed(2) + ' for ' + m1 });
                } catch (e) {
                    notes.push('GSTR-1 could not be rebuilt: ' + (e && e.message ? e.message : e));
                }
            }
        }

        var bad = 0;
        checks.forEach(function (c) { bad += c.rows.length; });
        return { checks: checks, notes: notes, problems: bad, ok: bad === 0, bills: bills.length };
    }

    window.mmPreFile = { run: run, reconcile: reconcile };
})();
