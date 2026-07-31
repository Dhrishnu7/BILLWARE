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
            shopRows);

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
            'An invoice with no lines cannot be filed or exported.', noLines);
        add(blocks, 'dupNo', 'Repeated bill numbers',
            'An invoice number must be unique for the financial year.', dupNo);
        add(blocks, 'badNo', 'Bill numbers the portal will not accept',
            'Rule 46: at most 16 characters, letters, digits, "/" and "-" only.', badNo);
        add(blocks, 'mismatch', 'Bills whose total does not match their lines',
            'Every export foots the lines against the total. These would be refused, ' +
            'and one of the two numbers is wrong in your books.', mismatch);

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
            }));

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
                badBuyer.push({ label: str(cu.name) + ' — ' + g2, detail: gr.reason, id: cu.id, name: str(cu.name) });
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
                    }));
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
            'These do not affect your GSTR-1, but input credit is claimed against them.', badSup);

        var posRows = [];
        if (!str(shop.city))    posRows.push({ label: 'Town / city not saved', detail: 'Needed only for e-invoice and e-way bills.' });
        if (!str(shop.pincode)) posRows.push({ label: 'PIN code not saved',    detail: 'Needed only for e-invoice and e-way bills.' });
        add(warns, 'shopPos', 'Shop town / PIN not recorded',
            'GSTR-1 and Tally do not need these. e-Invoice and e-way bills cannot be built without them.',
            posRows);

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

    window.mmPreFile = { run: run };
})();
