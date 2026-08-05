/* ══════════════════════════════════════════════════════════════════════
   returns-data.js — credit notes and debit notes, with their tax recovered

   WHY THIS EXISTS
   The Returns feature stores a return as a stock adjustment: one row per
   product line, tagged sales_return / purchase_return, with the money detail
   as JSON in the note. That is right for stock — every stock view stays
   correct — but it means a return carries an AMOUNT and no tax at all.
   Without a GST rate a credit note cannot be filed, and until this existed
   neither the GSTR-1 return nor the Tally export included returns. A shop
   that refunded a customer was still reporting the original sale, and paying
   GST on money it had given back.

   HOW THE TAX IS RECOVERED
   Every return records `ref` — the bill it reverses. A credit note legally
   inherits the tax treatment of the invoice it cancels, so the rate and HSN
   are read from the matching line of the original document. That is the rule,
   not a workaround. When the original cannot be found the return is reported
   as a problem and NEVER guessed: an invented rate is how an unfilable return
   gets built.

   THE ONE ASYMMETRY THAT MATTERS
     sales returns     amount is tax-INCLUSIVE  (bill line total ÷ qty sold)
     purchase returns  amount is tax-EXCLUSIVE  (purchase rate ÷ pack)
   They are computed from different sources on the Returns screen. Treating
   them the same silently misstates one of them by the GST rate.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function num(n) { return Number(n) || 0; }
    function r2(n) { return Math.round(num(n) * 100) / 100; }
    function key(s) { return String(s || '').trim().toLowerCase(); }

    /* Stock adjustments are written through the scoped helper, so they live
       under mm_<user>_stockAdjustments and cannot be read with a bare key. */
    function adjustments() {
        if (typeof mmLsGet === 'function') {
            var a = mmLsGet('stockAdjustments');
            if (a && a.length) return a;
        }
        return [];
    }

    function parseNote(n) {
        if (!n) return {};
        if (typeof n === 'object') return n;
        try { return JSON.parse(n) || {}; } catch (e) { return {}; }
    }

    function inRange(d, from, to) {
        var s = String(d || '').slice(0, 10);
        if (!s) return false;
        if (from && s < from) return false;
        if (to   && s > to)   return false;
        return true;
    }

    function readJson(k) {
        try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { return []; }
    }

    /* Original documents, indexed by the number the return refers to. */
    function billIndex() {
        var by = {};
        readJson('mm_sales').forEach(function (b) {
            if (b.billNo) by[key(b.billNo)] = b;
        });
        return by;
    }
    function purchaseIndex() {
        var by = {};
        readJson('mm_purchases').forEach(function (p) {
            // snake_case from the cloud, camelCase if saved locally first.
            var k = key(p.billNo || p.bill_no);
            if (!k) return;
            if (!by[k]) by[k] = [];
            by[k].push(p);
        });
        return by;
    }

    /* Match a returned product back to its line on the original bill. Batch
       first, because the same medicine can appear twice on one bill from two
       batches at different prices; name-only is the fallback for lines saved
       before batches were captured. */
    function findBillLine(bill, product, batch) {
        var items = (bill && bill.medicines) || [];
        var p = key(product), b = key(batch);
        var exact = null, loose = null;
        for (var i = 0; i < items.length; i++) {
            if (key(items[i].product) !== p) continue;
            if (!loose) loose = items[i];
            if (key(items[i].batch) === b) { exact = items[i]; break; }
        }
        return exact || loose;
    }

    function findPurchaseLine(rows, product, batch) {
        var p = key(product), b = key(batch);
        var exact = null, loose = null;
        (rows || []).forEach(function (r) {
            var nm = key(r.productName || r.product_name || r.product);
            if (nm !== p) return;
            if (!loose) loose = r;
            if (key(r.batchNo || r.batch_no) === b) exact = exact || r;
        });
        return exact || loose;
    }

    /* ──────────────────────────────────────────────────────────────────
       load({ from, to })
       Groups the per-line adjustments back into the notes they were issued
       as — every line of one return shares its CN/DN number — and attaches
       the tax recovered from the original document.
    ────────────────────────────────────────────────────────────────── */
    function load(opts) {
        opts = opts || {};
        var bills = billIndex();
        var purch = purchaseIndex();
        // Flat list for the product+batch fallback below, where a debit note
        // has no usable bill number to index by.
        var allPurchases = readJson('mm_purchases');
        var notes = {};       // 'C'|'D' + number -> note

        adjustments().forEach(function (a) {
            var reason = a.reason || a.adjustment_reason || '';
            if (reason !== 'sales_return' && reason !== 'purchase_return') return;

            var note = parseNote(a.note);
            var isSale = reason === 'sales_return';
            var date = String(note.date || a.created_at || '').slice(0, 10);
            if (!inRange(date, opts.from, opts.to)) return;

            var no = String((isSale ? note.cn : note.dn) || '').trim();
            if (!no) no = (isSale ? 'CN-' : 'DN-') + (note.ref || '?') + '-' + date;
            var gk = (isSale ? 'C' : 'D') + no;

            if (!notes[gk]) {
                notes[gk] = {
                    type: isSale ? 'credit' : 'debit',
                    no: no,
                    date: date,
                    ref: String(note.ref || '').trim(),
                    party: String(note.party || '').trim(),
                    mode: note.mode || '',
                    reason: note.reason || '',
                    lines: [],
                    problems: [],
                    /* Who the note is against. Declared here so the shape is
                       explicit — customerId is what makes a CDNR entry survive
                       a rename, customerName is the fallback. */
                    customerName: null,
                    customerId: null,
                    /* Set when the buyer could only be matched by NAME: no id
                       on the note and no original bill left to read one from.
                       Deliberately NOT a `problem` — problems make a note
                       unusable and drop it from the return entirely, which
                       would be far worse than filing it against a name. */
                    buyerFromNameOnly: false,
                    taxable: 0, tax: 0, gross: 0
                };
            }
            var n = notes[gk];

            var product = a.product_name || a.productName || '';
            var batch   = a.batch_no || a.batchNo || '';
            // Sales returns add stock back (+), purchase returns remove it (−).
            // The document is about the magnitude either way.
            var qty     = Math.abs(num(a.qty_delta !== undefined ? a.qty_delta : a.qtyDelta));
            var amount  = num(note.amount);

            var rate = null, hsn = '';

            /* Best source: the rate the return itself recorded. Returns taken
               from v253 onward carry it, so nothing has to be looked up and a
               later edit to the original document cannot change a note that
               was already issued. */
            if (note.gst !== undefined && note.gst !== null && note.gst !== '') {
                rate = num(note.gst);
                hsn  = String(note.hsn || '').trim();
            }

            if (isSale) {
                /* WHO the note is against decides whether it files as a CDNR
                   entry against a registered buyer or simply reduces counter
                   sales. Three sources, in falling order of trust:

                   1. the id stamped on the NOTE (v319 onward) — survives the
                      original bill being deleted AND the customer being renamed
                   2. the original bill, for notes issued before that
                   3. the party name recorded on the note

                   The bill used to be the ONLY source, so deleting it dropped a
                   registered buyer to name-matching without saying so. Name
                   matching is what customer ids exist to avoid. */
                if (note.custId !== undefined && note.custId !== null && note.custId !== '') {
                    n.customerId = note.custId;
                }
                var bill = bills[key(n.ref)];
                if (bill) {
                    var bl = findBillLine(bill, product, batch);
                    if (rate === null) {
                        if (!bl) n.problems.push('"' + product + '" is not on bill ' + n.ref + ' any more');
                        else { rate = num(bl.gst); hsn = String(bl.hsn || '').trim(); }
                    }
                    if (n.customerName == null) n.customerName = bill.customerName || bill.customer_name || n.party;
                    if (n.customerId == null) {
                        n.customerId = (bill.customerId != null) ? bill.customerId
                                     : (bill.customer_id != null ? bill.customer_id : null);
                    }
                    n.origDate = String(bill.date || '').slice(0, 10);
                } else {
                    if (rate === null) {
                        n.problems.push('original bill ' + (n.ref || '(none recorded)') + ' no longer exists, so its GST rate cannot be read');
                    }
                    /* The bill is gone. Keep the buyer the note itself recorded
                       rather than losing them: a B2B credit note that quietly
                       becomes a counter-sales reduction understates CDNR and
                       leaves the buyer's own 2B short of a credit they are
                       owed. Flagged, never blocked. */
                    if (n.customerName == null) n.customerName = n.party || null;
                    if (n.customerId == null && n.customerName
                        && !/^walk[\s-]?in$/i.test(String(n.customerName))) {
                        n.buyerFromNameOnly = true;
                    }
                }
            } else if (rate === null) {
                /* Purchases in this app carry no bill number — every Tally
                   purchase voucher comes out as "-" — so matching on `ref`
                   alone could never work for a debit note taken before the
                   rate was recorded on the return. Fall back to the goods
                   themselves: a product+batch identifies the lot, and the GST
                   rate is a property of the goods, not of the paperwork. */
                var pl = findPurchaseLine(purch[key(n.ref)], product, batch)
                      || findPurchaseLine(allPurchases, product, batch);
                if (!pl) n.problems.push('no purchase of "' + product + '"'
                        + (batch ? ' (batch ' + batch + ')' : '')
                        + ' can be found, so its GST rate cannot be read');
                else { rate = num(pl.gst); hsn = String(pl.hsn || '').trim(); }
            }

            /* The asymmetry. A sales return's amount already contains the tax;
               a purchase return's does not. */
            var taxable, tax;
            if (rate === null) { taxable = 0; tax = 0; }
            else if (isSale)   { taxable = amount / (1 + rate / 100); tax = amount - taxable; }
            else               { taxable = amount; tax = amount * rate / 100; }

            n.lines.push({
                product: product, batch: batch, qty: qty,
                amount: r2(amount), rate: rate, hsn: hsn,
                taxable: taxable, tax: tax,
                known: rate !== null
            });
            n.taxable += taxable;
            n.tax     += tax;
            n.gross   += isSale ? amount : (amount + tax);
        });

        var all = Object.keys(notes).map(function (k) {
            var n = notes[k];
            /* Round the two authoritative figures, then DERIVE the third.
               Rounding all three independently let them disagree by a paisa,
               and a Tally voucher whose sides differ by one paisa is rejected
               outright. The gross is what actually changed hands, so the tax
               is defined as the remainder. */
            n.taxable = r2(n.taxable);
            n.gross   = r2(n.gross);
            n.tax     = r2(n.gross - n.taxable);
            // One unreadable line poisons the whole note: a partly-taxed credit
            // note is not filable, and half a document is worse than none.
            n.usable = n.problems.length === 0 && n.lines.length > 0
                       && n.lines.every(function (l) { return l.known; });
            return n;
        }).sort(function (a, b) { return (a.date + a.no).localeCompare(b.date + b.no); });

        return {
            creditNotes: all.filter(function (n) { return n.type === 'credit'; }),
            debitNotes:  all.filter(function (n) { return n.type === 'debit'; }),
            problems:    all.filter(function (n) { return !n.usable; })
                            .map(function (n) { return n.no + ': ' + (n.problems[0] || 'a line has no GST rate'); }),
            /* Filable, but worth a look. Kept apart from `problems` on purpose:
               anything in there makes a note unusable and drops it out of the
               return, which is the wrong answer for a note that is merely
               matched by name. */
            notices:     all.filter(function (n) { return n.buyerFromNameOnly; })
                            .map(function (n) {
                                return n.no + ': original bill ' + (n.ref || '(none recorded)')
                                     + ' is gone, so this note is matched to "' + (n.customerName || '?')
                                     + '" by name alone';
                            })
        };
    }

    window.mmReturns = { load: load };
})();
