/* ══════════════════════════════════════════════════════════════════════
   gstr1-export.js — build the monthly GSTR-1 return as a portal JSON

   WHY THIS EXISTS
   The app already exports GST data as Excel, but the GST portal does not
   accept Excel. Someone still has to re-key the figures into the offline
   utility every month. This writes the JSON the portal's own tool imports,
   so filing becomes: download, upload, check, submit.

   WHAT IT FILLS IN
     b2cs       Retail counter sales, aggregated per GST rate. This is where
                nearly all of a pharmacy's turnover belongs: unregistered
                buyers, intra-state, under the B2CL threshold.
     hsn        HSN-wise summary. Mandatory, and the app already captures
                HSN on every line, so it comes out of the bills directly.
     doc_issue  The invoice-number series actually issued in the month.

   WHAT IT DELIBERATELY DOES NOT FILL IN
     b2b        Sales to a buyer holding a GSTIN (a clinic, a nursing home)
                must be filed invoice-wise so the buyer can claim input
                credit. The customer record has no GSTIN field yet, so this
                export CANNOT tell such a sale apart from a counter sale and
                would file it as B2C — which quietly denies the buyer their
                credit. Rather than guess, the UI says so plainly. Adding a
                GSTIN to customers is the fix, and is its own change.

   Figures are derived from each line's tax-inclusive total rather than
   qty × rate, because a discounted line makes those two disagree and the
   total is what the customer actually paid.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    // Every GSTIN starts with its state code; the place of supply for a
    // counter sale is the shop's own state.
    function posOf(gstin) {
        var g = String(gstin || '').trim();
        return /^\d{2}/.test(g) ? g.slice(0, 2) : '';
    }

    function monthOf(d) { return String(d || '').slice(0, 7); }        // YYYY-MM
    function fpOf(ym) {                                                 // -> MMYYYY
        var p = String(ym || '').split('-');
        return p.length === 2 ? p[1] + p[0] : '';
    }

    /* Build the return for one month.
       opts: { month:'YYYY-MM', gstin }  */
    function build(opts) {
        var month = opts.month || monthOf(new Date().toISOString());
        var gstin = String(opts.gstin || '').trim().toUpperCase();
        var pos   = posOf(gstin);

        var bills = [];
        try { bills = JSON.parse(localStorage.getItem('mm_sales') || '[]'); } catch (e) {}
        bills = bills.filter(function (b) { return monthOf(b.date) === month; });

        var b2csMap = {};     // rate -> totals
        var hsnMap  = {};     // hsn|rate -> totals
        var invNos  = [];
        var grand   = 0;
        var lineCount = 0;
        var missingHsn = 0;

        bills.forEach(function (bill) {
            if (bill.billNo) invNos.push(String(bill.billNo));
            (bill.medicines || []).forEach(function (m) {
                var rate  = Number(m.gst) || 0;
                var total = Number(m.total) || 0;
                if (!total) return;
                // Back out the tax from the inclusive line total.
                var txval = r2(total / (1 + rate / 100));
                var tax   = r2(total - txval);
                var half  = r2(tax / 2);
                lineCount++;
                grand += total;

                var rk = String(rate);
                if (!b2csMap[rk]) b2csMap[rk] = { rt: rate, txval: 0, camt: 0, samt: 0 };
                b2csMap[rk].txval += txval;
                b2csMap[rk].camt  += half;
                b2csMap[rk].samt  += half;

                var hsn = String(m.hsn || '').trim();
                if (!hsn) missingHsn++;
                var hk = (hsn || 'UNSPECIFIED') + '|' + rate;
                if (!hsnMap[hk]) {
                    hsnMap[hk] = { hsn_sc: hsn, desc: String(m.product || '').slice(0, 30),
                                   rt: rate, qty: 0, txval: 0, camt: 0, samt: 0 };
                }
                hsnMap[hk].qty   += Number(m.qty) || 0;
                hsnMap[hk].txval += txval;
                hsnMap[hk].camt  += half;
                hsnMap[hk].samt  += half;
            });
        });

        var b2cs = Object.keys(b2csMap).map(function (k) {
            var v = b2csMap[k];
            return {
                sply_ty: 'INTRA', typ: 'OE', pos: pos, rt: v.rt,
                txval: r2(v.txval), camt: r2(v.camt), samt: r2(v.samt), csamt: 0
            };
        }).sort(function (a, b) { return a.rt - b.rt; });

        var hsn = Object.keys(hsnMap).map(function (k, i) {
            var v = hsnMap[k];
            return {
                num: i + 1, hsn_sc: v.hsn_sc, desc: v.desc, uqc: 'NOS',
                qty: r2(v.qty), rt: v.rt, txval: r2(v.txval),
                iamt: 0, camt: r2(v.camt), samt: r2(v.samt), csamt: 0
            };
        }).sort(function (a, b) { return String(a.hsn_sc).localeCompare(String(b.hsn_sc)); })
          .map(function (h, i) { h.num = i + 1; return h; });

        // Invoice series. Sorted as text because bill numbers carry prefixes.
        var docs = [];
        if (invNos.length) {
            var sorted = invNos.slice().sort();
            docs = [{
                doc_num: 1,        // 1 = invoices for outward supply
                docs: [{
                    num: 1, from: sorted[0], to: sorted[sorted.length - 1],
                    totnum: sorted.length, cancel: 0, net_issue: sorted.length
                }]
            }];
        }

        var json = {
            gstin: gstin,
            fp: fpOf(month),
            version: 'GST3.2',
            hash: 'hash',
            b2cs: b2cs,
            hsn: { data: hsn },
            doc_issue: { doc_det: docs }
        };

        return {
            json: json,
            month: month,
            summary: {
                bills: bills.length,
                lines: lineCount,
                grandTotal: r2(grand),
                taxable: r2(b2cs.reduce(function (s, x) { return s + x.txval; }, 0)),
                tax:     r2(b2cs.reduce(function (s, x) { return s + x.camt + x.samt; }, 0)),
                rates:   b2cs.length,
                hsnRows: hsn.length,
                missingHsn: missingHsn,
                firstInv: docs.length ? docs[0].docs[0].from : '',
                lastInv:  docs.length ? docs[0].docs[0].to   : ''
            },
            b2cs: b2cs,
            hsn: hsn
        };
    }

    window.mmGstr1 = { build: build, posOf: posOf };
})();
