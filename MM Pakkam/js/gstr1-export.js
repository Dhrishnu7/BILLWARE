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

     b2b        Sales to a buyer holding a GSTIN (a clinic, a nursing home,
                another chemist), filed invoice by invoice so that buyer can
                claim the input credit. A bill counts as B2B only when its
                customer has a GSTIN recorded in the Directory; everything
                else stays B2C, which is the safe default for a pharmacy.

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
    function idt(d) {                                                   // -> DD-MM-YYYY
        var s = String(d || '').slice(0, 10).split('-');
        return s.length === 3 ? s[2] + '-' + s[1] + '-' + s[0] : '';
    }
    function key(s) { return String(s || '').trim().toLowerCase(); }

    /* Which customers are registered buyers. Only these turn a bill into B2B;
       a blank GSTIN — which is nearly all of them — stays B2C. */
    function gstinMap() {
        var byName = {}, byId = {};
        try {
            (JSON.parse(localStorage.getItem('mm_customers') || '[]') || []).forEach(function (c) {
                var g = String(c.gstin || '').trim().toUpperCase();
                if (g.length !== 15) return;
                if (c.name) byName[key(c.name)] = g;
                if (c.id != null) byId[String(c.id)] = g;      // survives typos and renames
            });
        } catch (e) {}
        return { byName: byName, byId: byId };
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

        /* GST slabs that actually exist. A pharmacy uses 0/5/12/18; the rest are
           here so a shop selling non-medicine items is not wrongly flagged.
           Anything outside this set (7.5%, 2%, 1.5% typed by hand) is rejected
           by the portal, so it is worth catching before the file is built. */
        var MM_GST_SLABS_SET = { 0: 1, 0.25: 1, 3: 1, 5: 1, 12: 1, 18: 1, 28: 1 };
        var validRates = {}, badRates = {};

        var reg = gstinMap();
        var noHsnProducts = [];
        /* The offending lines themselves, not just a count. "2 lines are at
           7.5%" tells a shopkeeper nothing about WHICH bills to open, and
           until this existed there was no way to correct one anyway. */
        var badRateLines = [];
        var b2csMap = {};     // rate -> totals            (counter sales)
        var b2bMap  = {};     // ctin -> { inv: [...] }    (registered buyers)
        var hsnMap  = {};     // hsn|rate -> totals        (all sales, both kinds)
        var invNos  = [];
        var grand   = 0;
        var lineCount = 0;
        var missingHsn = 0;
        var b2bInvCount = 0;
        var b2bValue = 0;

        bills.forEach(function (bill) {
            if (bill.billNo) invNos.push(String(bill.billNo));
            /* Prefer the customer id: it cannot be broken by a typo at the till
               or by a later rename. Bills raised before that link existed carry
               no id, so fall back to the name for those. */
            var cid = (bill.customerId != null) ? String(bill.customerId)
                    : (bill.customer_id != null ? String(bill.customer_id) : '');
            var ctin = (cid && reg.byId[cid])
                    || reg.byName[key(bill.customerName || bill.customer_name || '')]
                    || '';
            var invRates = {};     // rate -> totals, for this one B2B invoice
            var invVal = 0;

            (bill.medicines || []).forEach(function (m) {
                var rate  = Number(m.gst) || 0;
                var total = Number(m.total) || 0;
                if (!total) return;
                /* Back the tax out of the inclusive line total, and carry FULL
                   precision into the running totals — rounding each line to
                   paise first and then summing drifts by a rupee or two over a
                   busy month, and the portal checks these figures against each
                   other. Rounding happens once, on output. */
                var txval = total / (1 + rate / 100);
                var tax   = total - txval;
                var half  = tax / 2;
                lineCount++;
                grand += total;
                if (!validRates[rate] && !MM_GST_SLABS_SET[rate]) {
                    badRates[rate] = (badRates[rate] || 0) + 1;
                    if (badRateLines.length < 60) {
                        badRateLines.push({
                            billNo: String(bill.billNo || ''), date: String(bill.date || '').slice(0, 10),
                            product: String(m.product || ''), rate: rate, total: r2(total)
                        });
                    }
                }

                var rk = String(rate);
                if (ctin) {
                    // Registered buyer: this invoice is reported on its own.
                    if (!invRates[rk]) invRates[rk] = { rt: rate, txval: 0, camt: 0, samt: 0 };
                    invRates[rk].txval += txval;
                    invRates[rk].camt  += half;
                    invRates[rk].samt  += half;
                    invVal += total;
                } else {
                    if (!b2csMap[rk]) b2csMap[rk] = { rt: rate, txval: 0, camt: 0, samt: 0 };
                    b2csMap[rk].txval += txval;
                    b2csMap[rk].camt  += half;
                    b2csMap[rk].samt  += half;
                }

                var hsn = String(m.hsn || '').trim();
                if (!hsn) {
                    missingHsn++;
                    // Name the products, not just a count — "5 lines are missing
                    // HSN" tells the shop nothing about which bills to go fix.
                    var pn = String(m.product || '(unnamed)').trim();
                    if (noHsnProducts.indexOf(pn) < 0 && noHsnProducts.length < 25) noHsnProducts.push(pn);
                }
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

            // Close off this bill as a B2B invoice if the buyer is registered.
            if (ctin && invVal > 0) {
                if (!b2bMap[ctin]) b2bMap[ctin] = [];
                b2bMap[ctin].push({
                    inum: String(bill.billNo || ''),
                    idt: idt(bill.date),
                    val: r2(invVal),
                    pos: pos,
                    rchrg: 'N',
                    inv_typ: 'R',
                    itms: Object.keys(invRates).map(function (rk, i) {
                        var v = invRates[rk];
                        return { num: i + 1, itm_det: {
                            rt: v.rt, txval: r2(v.txval),
                            camt: r2(v.camt), samt: r2(v.samt), csamt: 0
                        } };
                    })
                });
                b2bInvCount++;
                b2bValue += invVal;
            }
        });

        /* ── Credit notes ──────────────────────────────────────────────
           Until this existed the return reported the original sale and
           ignored the refund, so the shop paid GST on money it had given
           back. A credit note to a REGISTERED buyer is filed in its own
           right (CDNR); one to an ordinary customer is netted off the B2CS
           figures, which is how the portal expects a retail refund.

           The original invoice number is deliberately NOT sent: credit notes
           were de-linked from their invoice in 2019 and the current return
           does not carry it. The app still keeps the link for the shop's own
           reconciliation. */
        var cdnrMap = {};        // ctin -> [note]
        var cnCount = 0, cnValue = 0, cnProblems = [];
        if (window.mmReturns) {
            var rets = mmReturns.load({ from: month + '-01', to: month + '-31' });
            cnProblems = rets.problems;
            rets.creditNotes.forEach(function (n) {
                if (!n.usable) return;                  // never guess a rate
                var ctin2 = (n.customerId != null && reg.byId[String(n.customerId)])
                         || reg.byName[key(n.customerName || n.party)] || '';
                var noteRates = {};

                n.lines.forEach(function (l) {
                    var rate = Number(l.rate) || 0;
                    var rk = String(rate);
                    var half = l.tax / 2;
                    if (!MM_GST_SLABS_SET[rate]) badRates[rate] = (badRates[rate] || 0) + 1;

                    if (ctin2) {
                        if (!noteRates[rk]) noteRates[rk] = { rt: rate, txval: 0, camt: 0, samt: 0 };
                        noteRates[rk].txval += l.taxable;
                        noteRates[rk].camt  += half;
                        noteRates[rk].samt  += half;
                    } else {
                        // Reduce the counter-sale totals for that rate.
                        if (!b2csMap[rk]) b2csMap[rk] = { rt: rate, txval: 0, camt: 0, samt: 0 };
                        b2csMap[rk].txval -= l.taxable;
                        b2csMap[rk].camt  -= half;
                        b2csMap[rk].samt  -= half;
                    }

                    // The HSN summary covers the month's NET outward supply,
                    // so a refunded item must come out of it too.
                    var hsn2 = String(l.hsn || '').trim();
                    var hk2 = (hsn2 || 'UNSPECIFIED') + '|' + rate;
                    if (!hsnMap[hk2]) {
                        hsnMap[hk2] = { hsn_sc: hsn2, desc: String(l.product || '').slice(0, 30),
                                        rt: rate, qty: 0, txval: 0, camt: 0, samt: 0 };
                    }
                    hsnMap[hk2].qty   -= Number(l.qty) || 0;
                    hsnMap[hk2].txval -= l.taxable;
                    hsnMap[hk2].camt  -= half;
                    hsnMap[hk2].samt  -= half;
                });

                cnCount++;
                cnValue += n.gross;

                if (ctin2) {
                    if (!cdnrMap[ctin2]) cdnrMap[ctin2] = [];
                    cdnrMap[ctin2].push({
                        ntty: 'C',                       // C = credit note
                        nt_num: n.no,
                        nt_dt: idt(n.date),
                        pos: pos,
                        rchrg: 'N',
                        inv_typ: 'R',
                        val: r2(n.gross),
                        itms: Object.keys(noteRates).map(function (rk, i) {
                            var v = noteRates[rk];
                            return { num: i + 1, itm_det: {
                                rt: v.rt, txval: r2(v.txval),
                                camt: r2(v.camt), samt: r2(v.samt), csamt: 0
                            } };
                        })
                    });
                }
            });
        }

        var cdnr = Object.keys(cdnrMap).map(function (ctin) {
            return { ctin: ctin, nt: cdnrMap[ctin] };
        });

        var b2b = Object.keys(b2bMap).map(function (ctin) {
            return { ctin: ctin, inv: b2bMap[ctin] };
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
            hsn: { data: hsn },
            doc_issue: { doc_det: docs }
        };
        // Omit empty sections rather than sending [] — a shop with no
        // registered buyers should not file an empty B2B block.
        if (b2b.length)  json.b2b  = b2b;
        if (b2cs.length) json.b2cs = b2cs;
        if (cdnr.length) json.cdnr = cdnr;

        return {
            json: json,
            month: month,
            summary: {
                bills: bills.length,
                lines: lineCount,
                grandTotal: r2(grand),
                // Totals come from the HSN summary, which covers B2B and B2CS
                // alike — the two together are the month's whole outward supply.
                taxable: r2(hsn.reduce(function (s, x) { return s + x.txval; }, 0)),
                tax:     r2(hsn.reduce(function (s, x) { return s + x.camt + x.samt; }, 0)),
                rates:   b2cs.length,
                hsnRows: hsn.length,
                missingHsn: missingHsn,
                noHsnProducts: noHsnProducts,
                badRates: Object.keys(badRates).map(function (r) { return { rt: Number(r), lines: badRates[r] }; }),
                badRateLines: badRateLines,
                b2bBuyers: b2b.length,
                b2bInvoices: b2bInvCount,
                b2bValue: r2(b2bValue),
                b2csValue: r2(grand - b2bValue),
                firstInv: docs.length ? docs[0].docs[0].from : '',
                lastInv:  docs.length ? docs[0].docs[0].to   : '',
                creditNotes: cnCount,
                creditNoteValue: r2(cnValue),
                cdnrBuyers: cdnr.length,
                creditNoteProblems: cnProblems,
                /* A rate whose refunds exceed its sales for the month. Legal
                   and occasionally real, but the portal treats a negative
                   B2CS line harshly, so it is surfaced rather than hidden. */
                negativeRates: b2cs.filter(function (r) { return r.txval < 0; })
                                   .map(function (r) { return r.rt; })
            },
            b2cs: b2cs,
            b2b: b2b,
            cdnr: cdnr,
            hsn: hsn
        };
    }

    window.mmGstr1 = { build: build, posOf: posOf };
})();
