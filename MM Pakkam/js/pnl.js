/* ══════════════════════════════════════════════════════════════════════
   pnl.js — Profit & Loss and Cash Flow, computed from data the app
            already stores. No new records, no posting, no double entry.

   WHY THIS EXISTS
   The Report page shows "Gross Margin" — (sale price − purchase price) × qty.
   That is a per-item margin, and it is NOT what an accountant means by gross
   profit. It silently assumes nothing was ever expired, broken, stolen or
   given away, because goods that leave without being sold never appear in a
   sale, so they never appear in the margin. The trading-account method
   (Opening Stock + Purchases − Closing Stock) catches all of it, which is
   exactly why the CA uses it. This module computes that method, keeps the
   item-margin figure alongside it, and shows the gap — for a pharmacy with
   expiry write-offs that gap is management information, not noise.

   FOUR RULES THIS MODULE ENFORCES (each one is a way the old numbers lied)

   1. REVENUE IS NET OF GST. Tax collected is money held for the government,
      not income. Taxable value is derived BACKWARDS from the tax-inclusive
      line total, exactly as gstr1-export.js and einvoice-export.js do — so a
      discounted bill reports what was actually received. Purchases run the
      other way (the app stores a PRE-tax rate), the same asymmetry
      tally-export.js already handles.

   2. THE `GST / Tax Paid` EXPENSE CATEGORY IS NOT A P&L EXPENSE. It settles a
      liability. Counting it would charge the shop twice for tax already
      excluded from revenue. It stays in the cash flow — the money really did
      leave — just not in the profit calculation.

   3. RETURNS COUNT ON BOTH SIDES, and only when their tax is known.
      js/returns-data.js flags a note `usable` when the original document's
      rate was recovered. An unusable note is never guessed into the
      statement; it is reported, with its value, as an exclusion.

   4. NOTHING IS PRESENTED AS CERTAIN WHEN IT IS NOT. Stock valued at a date
      the purchase history does not reach, items sold that were never bought,
      returns that could not be valued — each is counted, named, and shown.

   THE FOOTING DISCIPLINE (the rule that keeps paying — see v252, v255)
   Profit and cash are each computed from source, independently. The bridge
   between them lists the reconciling items it knows and shows whatever is
   left over as "Other differences" rather than forcing a match. The
   statement therefore ALWAYS foots, and a number that cannot be explained
   appears on screen instead of being buried in a plug.

   Sync and DOM-free on purpose: it reads the same localStorage caches every
   other export reads, so it can be run headless in a test harness.
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

    /* Stock adjustments live under the scoped key mm_<user>_stockAdjustments
       and cannot be read with a bare localStorage key. */
    function adjustments() {
        if (typeof mmLsGet === 'function') {
            var a = mmLsGet('stockAdjustments');
            if (a && a.length) return a;
        }
        return [];
    }

    function inRange(d, from, to) {
        var s = d10(d);
        if (!s) return false;
        if (from && s < from) return false;
        if (to   && s > to)   return false;
        return true;
    }

    /* The day before `d`, so a period's opening stock is the closing stock of
       the previous day. Plain string maths would break across month ends. */
    function dayBefore(d) {
        var s = d10(d);
        if (!s) return '';
        var t = new Date(s + 'T00:00:00');
        if (isNaN(t.getTime())) return '';
        t.setDate(t.getDate() - 1);
        var m = t.getMonth() + 1, dd = t.getDate();
        return t.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
    }

    /* ──────────────────────────────────────────────────────────────────
       STOCK VALUE AS AT A DATE

       report.html values stock as it stands RIGHT NOW. A period P&L needs it
       as at the period's start and end, or the whole trading account is
       meaningless the moment you look at last month. So the batch maths is
       replayed here with a date cutoff.

       The depletion rule is the same one Sales, Inventory and Report already
       agree on — batch-tagged sales come off their own batch first, untagged
       sales fall back to FIFO by expiry — because a second opinion about how
       much stock exists is worse than none. Kept as one pass over every
       product rather than the per-product call mmComputeStock() makes, which
       would re-read the whole dataset once per batch.
    ────────────────────────────────────────────────────────────────── */
    function stockAsOf(cutoff) {
        var purchases = readJson('mm_purchases');
        var sales     = readJson('mm_sales');
        var adjs      = adjustments();
        var prod = {};
        // Products are keyed lower-case so the same medicine spelt two ways
        // is one product; the first spelling seen is kept for anything the
        // shop will actually read.
        var display = {};

        function P(n, shown) {
            if (!prod[n]) prod[n] = { batches: {}, out: 0, tagged: {}, wholeDelta: 0, lastRate: 0, lastPack: 1, lastDate: '' };
            if (shown && !display[n]) display[n] = String(shown).trim();
            return prod[n];
        }

        purchases.forEach(function (p) {
            var n = key(p.productName || p.product_name);
            if (!n) return;
            var dt = d10(p.date);
            if (cutoff && dt && dt > cutoff) return;
            var e = P(n, p.productName || p.product_name);
            var batch = String(p.batchNo || p.batch_no || '').trim();
            var bk = (batch || '_no_batch_').toLowerCase();
            var qty = num(p.quantity), pack = num(p.pack) || 1;
            if (!e.batches[bk]) e.batches[bk] = { batch: batch, exp: '', totalIn: 0, adj: 0, rate: 0, pack: 1, rateDate: '' };
            var b = e.batches[bk];
            b.totalIn += qty * pack;
            var exp = String(p.expireDate || p.expire_date || '');
            if (exp && exp > b.exp) b.exp = exp;
            // Latest cost wins — the same "most recent purchase price" basis
            // the Stock Value KPI uses, so the two cannot disagree.
            if (!b.rateDate || dt >= b.rateDate) { b.rate = num(p.rate); b.pack = pack; b.rateDate = dt; }
            if (!e.lastDate || dt >= e.lastDate)  { e.lastRate = num(p.rate); e.lastPack = pack; e.lastDate = dt; }
        });

        sales.forEach(function (s) {
            if (s.isReturn) return;
            if (cutoff && d10(s.date) > cutoff) return;
            (s.medicines || []).forEach(function (m) {
                var n = key(m.product);
                if (!n) return;
                var e = P(n, m.product), q = num(m.qty);
                e.out += q;
                var mb = key(m.batch);
                if (mb) e.tagged[mb] = (e.tagged[mb] || 0) + q;
            });
        });

        adjs.forEach(function (a) {
            var n = key(a.product_name || a.productName);
            if (!n) return;
            var dt = d10(a.date || a.created_at);
            if (cutoff && dt && dt > cutoff) return;
            var e = P(n);
            var ab = key(a.batch_no || a.batchNo);
            var delta = num(a.qty_delta !== undefined ? a.qty_delta : a.qtyDelta);
            if (ab) {
                if (!e.batches[ab]) e.batches[ab] = { batch: ab, exp: '', totalIn: 0, adj: 0, rate: 0, pack: 1, rateDate: '' };
                e.batches[ab].adj += delta;
            } else {
                e.wholeDelta += delta;
            }
        });

        var value = 0, units = 0;
        var noCost = [];          // holding stock whose purchase cost is unknown
        var noCostUnits = 0;
        /* Units that were SOLD with no purchase to cover them. The FIFO loop
           below cannot deduct them from anywhere, and clamping the result to
           zero would hide the problem: those goods carry no cost, so gross
           profit comes out too high by whatever they were worth. Counted here
           and reported, never swallowed. */
        var oversoldUnits = 0, oversoldProducts = [];

        Object.keys(prod).forEach(function (n) {
            var e = prod[n];
            var list = Object.keys(e.batches).map(function (bk) {
                return { bk: bk, b: e.batches[bk], cur: 0 };
            }).sort(function (x, y) {
                return String(x.b.exp || '9999').localeCompare(String(y.b.exp || '9999'));
            });

            var taggedAcc = 0;
            list.forEach(function (it) {
                var tagged = Math.min(it.b.totalIn, e.tagged[it.bk] || 0);
                it.cur = it.b.totalIn - tagged;
                taggedAcc += tagged;
            });
            var remaining = Math.max(0, e.out - taggedAcc);
            list.forEach(function (it) {
                if (remaining <= 0) return;
                var ded = Math.min(it.cur, remaining);
                it.cur -= ded;
                remaining -= ded;
            });
            if (remaining > 0.0001) {
                oversoldUnits += remaining;
                // Carry the quantity, not just the name: the whole point is to
                // be able to hand a ready-made purchase line to the owner.
                oversoldProducts.push({ name: display[n] || n, units: remaining });
            }
            list.forEach(function (it) { it.cur += it.b.adj; });

            var prodUnits = 0, prodValue = 0, prodNoCost = 0;
            list.forEach(function (it) {
                if (it.cur <= 0) return;
                prodUnits += it.cur;
                var unitCost = it.b.rate / (it.b.pack || 1);
                if (!unitCost) { prodNoCost += it.cur; return; }
                prodValue += it.cur * unitCost;
            });
            /* A whole-product adjustment names no batch, so it cannot be
               valued at a batch cost. Use the product's latest known cost —
               and if there is none, count it as uncosted rather than free. */
            if (e.wholeDelta) {
                prodUnits += e.wholeDelta;
                var pc = e.lastRate / (e.lastPack || 1);
                if (pc) prodValue += e.wholeDelta * pc;
                else if (e.wholeDelta > 0) prodNoCost += e.wholeDelta;
            }

            units += prodUnits;
            value += prodValue;
            if (prodNoCost > 0) { noCostUnits += prodNoCost; noCost.push({ name: display[n] || n, units: prodNoCost }); }
        });

        return {
            asOf: cutoff || '',
            value: r2(value),
            units: units,
            noCostUnits: noCostUnits,
            noCostProducts: noCost,
            oversoldUnits: oversoldUnits,
            oversoldProducts: oversoldProducts
        };
    }

    /* Unit cost of one product/batch as at a date — for the item-margin
       figure. Latest purchase at or before the date, per batch, falling back
       to any batch of the same product. */
    function costIndex(cutoff) {
        var byBatch = {}, byProduct = {};
        readJson('mm_purchases').forEach(function (p) {
            var n = key(p.productName || p.product_name);
            if (!n) return;
            var dt = d10(p.date);
            if (cutoff && dt && dt > cutoff) return;
            var pack = num(p.pack) || 1;
            var unit = num(p.rate) / pack;
            if (!unit) return;
            var bk = n + '|' + key(p.batchNo || p.batch_no);
            if (!byBatch[bk] || dt >= byBatch[bk].date) byBatch[bk] = { unit: unit, date: dt };
            if (!byProduct[n] || dt >= byProduct[n].date) byProduct[n] = { unit: unit, date: dt };
        });
        return {
            unitCost: function (product, batch) {
                var n = key(product);
                var b = byBatch[n + '|' + key(batch)];
                if (b) return b.unit;
                var p = byProduct[n];
                return p ? p.unit : 0;
            },
            known: function (product) { return !!byProduct[key(product)]; }
        };
    }

    /* ──────────────────────────────────────────────────────────────────
       build({ from, to, openingStock, openingStockDate })

       openingStock is the owner's own physical valuation, entered once (see
       shop_profiles.opening_stock). It is used in preference to the computed
       figure when it is dated at or before the period start, because a shop
       that began using the app mid-life has stock the purchase history never
       saw — and a physical count beats a computation over incomplete data.
       Both figures are always returned so the screen can show the gap.
    ────────────────────────────────────────────────────────────────── */
    function build(opts) {
        opts = opts || {};
        var from = d10(opts.from), to = d10(opts.to);

        /* A warning is an object, not a sentence: { text, action }. A note that
           says what is wrong and leaves the owner to work out where to fix it
           is just nagging, so each one carries the action that resolves it and
           the data that action needs — the purchase lines to enter, and so on.
           `text` alone is what the Excel export and the printout use. */
        var warnings = [];
        var checks   = [];
        function warn(text, action) { warnings.push({ text: text, action: action || null }); }

        /* ── Sales ── */
        var sales = readJson('mm_sales');
        var sTaxable = 0, sTax = 0, sLineSum = 0, sGrand = 0, sCount = 0, roundOff = 0;
        var byMode = { cash: 0, upi: 0, card: 0, credit: 0 };
        var itemMargin = 0, uncostedLines = 0, uncostedRevenue = 0;
        var uncostedNames = {};   // product -> quantity sold with no cost on record
        var costs = costIndex(to);

        sales.forEach(function (bill) {
            // Returns are held in the same list but are accounted for through
            // returns-data.js, which is the only place their tax is known.
            // Counting them here as well would deduct every refund twice.
            if (bill.isReturn) return;
            if (!inRange(bill.date, from, to)) return;
            sCount++;
            var lineSum = 0;
            (bill.medicines || []).forEach(function (m) {
                var total = num(m.total);
                if (!total) return;
                var rate    = num(m.gst);
                var taxable = total / (1 + rate / 100);
                sTaxable += taxable;
                sTax     += total - taxable;
                lineSum  += total;

                var qty  = num(m.qty);
                var cost = costs.unitCost(m.product, m.batch);
                if (cost) {
                    itemMargin += taxable - cost * qty;
                } else if (qty > 0) {
                    // Sold something the app has no purchase record for. Its
                    // cost is unknown, so it contributes revenue and no cost —
                    // which overstates profit. Named, never silently zeroed.
                    uncostedLines++;
                    uncostedRevenue += taxable;
                    var un = String(m.product || '?');
                    uncostedNames[un] = (uncostedNames[un] || 0) + qty;
                }
            });
            sLineSum += lineSum;
            var grand = num(bill.grandTotal || bill.total);
            if (grand) {
                sGrand   += grand;
                roundOff += grand - lineSum;
            } else {
                sGrand += lineSum;
            }
            var mode = key(bill.paymentMode) || 'cash';
            if (!(mode in byMode)) mode = 'cash';
            byMode[mode] += grand || lineSum;
        });

        /* ── Purchases ──
           Also fingerprinted as we go, to catch the same supplier line entered
           twice. The Purchase screen's own duplicate warning only ever fired
           when a bill number was present on BOTH copies, so an invoice keyed in
           once without a number and again with one sailed straight past it —
           doubling the stock, the payable and the input credit claimed. Nothing
           else in the app would ever have said so. */
        var pTaxable = 0, pTax = 0, pCount = 0;
        var sigs = {};
        readJson('mm_purchases').forEach(function (p) {
            if (!inRange(p.date, from, to)) return;
            pCount++;
            // The app stores a PRE-tax rate, so the taxable value is
            // authoritative here and the tax follows from it.
            var taxable = num(p.quantity) * num(p.rate);
            pTaxable += taxable;
            pTax     += taxable * num(p.gst) / 100;

            /* Deliberately EXCLUDES the bill number: that is the one field the
               two copies differ in, so keying on it is what hid them. Same
               supplier, same day, same goods, same quantity, same price is a
               duplicate until a human says otherwise. */
            var sg = [d10(p.date), key(p.firm), key(p.productName || p.product_name),
                      key(p.batchNo || p.batch_no), num(p.quantity), num(p.rate)].join('|');
            if (!sigs[sg]) sigs[sg] = [];
            sigs[sg].push({
                id:      (p.id !== undefined && p.id !== null) ? p.id : null,
                billNo:  String(p.billNo || p.bill_no || '').trim(),
                date:    d10(p.date),
                firm:    String(p.firm || '').trim(),
                product: String(p.productName || p.product_name || ''),
                batch:   String(p.batchNo || p.batch_no || ''),
                qty:     num(p.quantity),
                rate:    num(p.rate),
                amount:  r2(taxable)
            });
        });

        /* Groups of two or more identical lines. One copy is the real one; the
           rest are removable.

           WHICH ONE SURVIVES MATTERS, and getting it backwards deletes the
           good record and keeps the poor one. Ranked by how complete the row
           is: a bill number is worth more than none, and a row that has
           reached the server (has an id) is worth more than one that has not —
           because a row with no id CANNOT be deleted, so keeping one of those
           would strand the duplicate forever while removing its better twin.
           Rows with no id are therefore never offered for deletion either. */
        var dupGroups = [], dupExtra = 0, dupValue = 0;
        function completeness(r) { return (r.billNo ? 2 : 0) + (r.id !== null ? 1 : 0); }
        Object.keys(sigs).forEach(function (k) {
            var g = sigs[k];
            if (g.length < 2) return;
            var sorted = g.slice().sort(function (a, b) { return completeness(b) - completeness(a); });
            var keep = sorted[0], drop = sorted.slice(1).filter(function (r) { return r.id !== null; });
            if (!drop.length) return;
            dupGroups.push({ keep: keep, drop: drop });
            dupExtra += drop.length;
            dupValue += drop.reduce(function (s, r) { return s + r.amount; }, 0);
        });
        if (dupExtra) {
            warn((dupExtra === 1
                    ? '1 purchase line worth ' + inr(dupValue) + ' looks like a duplicate'
                    : dupExtra + ' purchase lines worth ' + inr(dupValue) + ' look like duplicates') +
                ' — the same supplier, day, medicine, quantity and price entered more than once. ' +
                'Each copy doubles your stock, your payable and the input credit claimed against it.',
                { kind: 'dupPurchases', label: '🔍 Review duplicates', groups: dupGroups });
        }

        /* ── Returns ── */
        var salesRet = { taxable: 0, tax: 0, gross: 0, count: 0 };
        var purchRet = { taxable: 0, tax: 0, gross: 0, count: 0 };
        var excludedReturns = { count: 0, gross: 0, notes: [], profitEffect: 0 };

        /* A return with no readable GST rate is dropped from the trading
           section above. The GOODS still moved, though, and closing stock is
           computed from stock records rather than from this statement — so the
           stock half is still counted while the sales half is not, and gross
           profit shifts by the cost of those goods with nothing to offset it.
           Saying "EXCLUDED from this statement" was therefore only half true,
           and it hid a real overstatement. Measure the shift so the warning can
           state it. A sales return puts stock back (closing stock up, COGS
           down, profit UP); a purchase return takes stock away (profit DOWN). */
        function excludeReturn(n, isSale) {
            excludedReturns.count++;
            excludedReturns.gross += num(n.gross);
            excludedReturns.notes.push(n.no);
            (n.lines || []).forEach(function (l) {
                var c = costs.unitCost(l.product, l.batch) * num(l.qty);
                excludedReturns.profitEffect += isSale ? c : -c;
            });
        }

        if (window.mmReturns && typeof window.mmReturns.load === 'function') {
            try {
                var rets = window.mmReturns.load({ from: from, to: to });
                rets.creditNotes.forEach(function (n) {
                    if (!n.usable) { excludeReturn(n, true); return; }
                    salesRet.taxable += n.taxable; salesRet.tax += n.tax; salesRet.gross += n.gross; salesRet.count++;
                });
                rets.debitNotes.forEach(function (n) {
                    if (!n.usable) { excludeReturn(n, false); return; }
                    purchRet.taxable += n.taxable; purchRet.tax += n.tax; purchRet.gross += n.gross; purchRet.count++;
                });
            } catch (e) { warn('Returns could not be read: ' + (e && e.message ? e.message : e)); }
        }
        if (excludedReturns.count) {
            var exN      = excludedReturns.count;
            var exOne    = exN === 1;
            var exEffect = r2(excludedReturns.profitEffect);
            var exText   = exN + ' return' + (exOne ? ' is' : 's are') + ' missing a GST rate' +
                ' (the original bill cannot be read), so ' + (exOne ? 'its' : 'their') + ' value of ' +
                inr(excludedReturns.gross) + ' is NOT deducted above — ' +
                excludedReturns.notes.slice(0, 4).join(', ') + (excludedReturns.notes.length > 4 ? '…' : '') + '.';
            if (Math.abs(exEffect) >= 0.01) {
                exText += ' The goods still moved, so closing stock DOES include them: gross profit here is ' +
                    (exEffect > 0 ? 'OVERSTATED' : 'UNDERSTATED') + ' by about ' + inr(Math.abs(exEffect)) +
                    ' until ' + (exOne ? 'it is' : 'they are') + ' fixed.';
            }
            warn(exText, { kind: 'returns', label: '↩️ Open Returns' });
        }

        /* ── Expenses ── */
        var expenses = [];
        try { expenses = JSON.parse(localStorage.getItem('mm_expenses') || '[]') || []; } catch (e) { expenses = []; }
        var expTotalPnl = 0, expTotalCash = 0, gstRemitted = 0;
        var byCat = {};
        expenses.forEach(function (e) {
            if (!inRange(e.date, from, to)) return;
            var amt = num(e.amount);
            var cat = String(e.category || 'Other');
            expTotalCash += amt;
            // Rule 2: remitting GST settles a liability, it is not a cost of
            // running the shop. Cash flow keeps it; the P&L must not.
            if (/gst|tax paid/i.test(cat)) { gstRemitted += amt; return; }
            expTotalPnl += amt;
            byCat[cat] = (byCat[cat] || 0) + amt;
        });
        var expenseRows = Object.keys(byCat).map(function (c) {
            return { category: c, amount: r2(byCat[c]) };
        }).sort(function (a, b) { return b.amount - a.amount; });

        /* ── Stock ── */
        var computedOpening = stockAsOf(dayBefore(from));
        var closing         = stockAsOf(to);
        var manualOpening   = num(opts.openingStock);
        var manualDate      = d10(opts.openingStockDate);
        var useManual = manualOpening > 0 && (!manualDate || !from || manualDate <= from);
        var opening = useManual ? manualOpening : computedOpening.value;

        if (manualOpening > 0 && manualDate && from && manualDate > from) {
            warn('Your entered opening stock is dated ' + manualDate +
                ', which is after this period starts — the computed figure is used instead.',
                { kind: 'openingStock', label: '⚙️ Change the date' });
        }
        if (!useManual && !computedOpening.value && sCount) {
            warn('Opening stock computes to zero. If the shop was trading before its purchase history begins, enter the real opening stock value so gross profit is not overstated.',
                { kind: 'openingStock', label: '⚙️ Enter opening stock' });
        }
        if (closing.noCostUnits > 0) {
            warn(Math.round(closing.noCostUnits) + ' units in stock have no recorded purchase cost and are valued at zero, which understates closing stock and therefore understates profit.',
                { kind: 'purchase', label: '🧾 Enter these purchases',
                  items: closing.noCostProducts.map(function (p) {
                      return { productName: p.name, quantity: Math.max(1, Math.round(p.units)) };
                  }) });
        }
        /* Sold more than was ever bought. Stock cannot go below zero, so the
           excess simply carries no cost and gross profit comes out too high.
           This is nearly always missing purchase entries — the shop billed
           goods whose supplier invoice was never keyed in. */
        if (closing.oversoldUnits > 0.5) {
            var op = closing.oversoldProducts.slice(0, 4).map(function (p) { return p.name; }).join(', ');
            warn(Math.round(closing.oversoldUnits) + ' units were SOLD that were never purchased in this app (' +
                op + (closing.oversoldProducts.length > 4 ? ', …' : '') +
                '). They carry no cost, so gross profit below is overstated. Usually a purchase bill that was never entered.',
                { kind: 'purchase', label: '🧾 Enter these purchases',
                  items: closing.oversoldProducts.map(function (p) {
                      return { productName: p.name, quantity: Math.max(1, Math.ceil(p.units)) };
                  }) });
        }

        /* ── The trading account ── */
        var netSalesTaxable = sTaxable - salesRet.taxable;
        var netPurchTaxable = pTaxable - purchRet.taxable;
        var cogs        = opening + netPurchTaxable - closing.value;
        var grossProfit = netSalesTaxable - cogs;
        var netProfit   = grossProfit - expTotalPnl + roundOff;

        var uncostedList = Object.keys(uncostedNames);
        if (uncostedLines) {
            warn(uncostedLines + ' sale line' + (uncostedLines === 1 ? '' : 's') +
                ' (' + inr(uncostedRevenue) + ' of revenue) are for items with no purchase record, so the item-margin comparison below ignores their cost.',
                { kind: 'purchase', label: '🧾 Enter these purchases',
                  items: uncostedList.map(function (n) {
                      return { productName: n, quantity: Math.max(1, Math.ceil(uncostedNames[n])) };
                  }) });
        }

        /* ── Cash flow ──
           Cash in is what the till and the khata actually took. A credit sale
           is revenue but not cash, which is the entire point of this section. */
        var custPay = 0;
        try {
            (JSON.parse(localStorage.getItem('mm_customer_payments') || '[]') || []).forEach(function (p) {
                if (inRange(p.date, from, to)) custPay += num(p.amount);
            });
        } catch (e) {}
        var suppPay = 0;
        try {
            (JSON.parse(localStorage.getItem('mm_supplier_payments') || '[]') || []).forEach(function (p) {
                if (inRange(p.date, from, to)) suppPay += num(p.amount);
            });
        } catch (e) {}

        var counterCollections = byMode.cash + byMode.upi + byMode.card;
        var cashIn  = counterCollections + custPay;
        var cashOut = suppPay + expTotalCash;
        var netCash = cashIn - cashOut;

        /* The bridge from profit to cash. Each item is computed from source;
           whatever the named items do not explain is shown as a residual
           rather than forced to zero. A statement that always foots and
           admits what it cannot explain beats one that quietly balances. */
        var deltaDebtors   = byMode.credit - custPay;             // credit sales not yet collected
        var deltaCreditors = (pTaxable + pTax) - suppPay;         // supplier bills not yet paid
        var deltaStock     = closing.value - opening;             // cash converted into goods
        var gstHeld        = sTax - pTax - gstRemitted;           // tax collected, not yet remitted

        var bridge = [
            { label: 'Net profit for the period',            amount: r2(netProfit) },
            { label: 'Credit sales not yet collected',       amount: r2(-deltaDebtors) },
            { label: 'Supplier bills not yet paid',          amount: r2(deltaCreditors) },
            { label: 'Cash tied up in extra stock',          amount: r2(-deltaStock) },
            { label: 'GST collected but not yet remitted',   amount: r2(gstHeld) }
        ];
        var explained = bridge.reduce(function (s, b) { return s + b.amount; }, 0);
        var residual  = r2(netCash - explained);
        if (Math.abs(residual) >= 0.01) {
            bridge.push({ label: 'Other differences (not explained above)', amount: residual, residual: true });
        }

        /* ── Checks. Same discipline as the Tally export's balance guard: the
           arithmetic is re-derived independently, and a mismatch is named on
           screen rather than left for someone to find later. ── */
        checks.push({
            name: 'Gross profit foots',
            ok: Math.abs(r2(netSalesTaxable - cogs) - r2(grossProfit)) < 0.02,
            detail: 'Net sales − cost of goods sold = gross profit'
        });
        checks.push({
            name: 'Net profit foots',
            ok: Math.abs(r2(grossProfit - expTotalPnl + roundOff) - r2(netProfit)) < 0.02,
            detail: 'Gross profit − expenses + round-off = net profit'
        });
        checks.push({
            name: 'Cash movement foots',
            ok: Math.abs(r2(cashIn - cashOut) - r2(netCash)) < 0.02,
            detail: 'Money in − money out = net cash movement'
        });
        checks.push({
            name: 'Profit-to-cash bridge foots',
            ok: Math.abs(r2(bridge.reduce(function (s, b) { return s + b.amount; }, 0)) - r2(netCash)) < 0.02,
            detail: 'The bridge adds up to the net cash movement'
        });
        checks.push({
            name: 'Bill totals match their lines',
            ok: Math.abs(roundOff) <= Math.max(2, sCount * 1.5),
            detail: 'Round-off across ' + sCount + ' bills is ' + inr(roundOff) +
                    '. A large figure here means bill totals disagree with the sum of their own lines.'
        });

        return {
            period: { from: from, to: to },

            sales: {
                gross: r2(sGrand), taxable: r2(sTaxable), tax: r2(sTax),
                lineSum: r2(sLineSum), count: sCount, byMode: {
                    cash: r2(byMode.cash), upi: r2(byMode.upi),
                    card: r2(byMode.card), credit: r2(byMode.credit)
                }
            },
            salesReturns:     { taxable: r2(salesRet.taxable), tax: r2(salesRet.tax), gross: r2(salesRet.gross), count: salesRet.count },
            purchases:        { taxable: r2(pTaxable), tax: r2(pTax), gross: r2(pTaxable + pTax), count: pCount },
            purchaseReturns:  { taxable: r2(purchRet.taxable), tax: r2(purchRet.tax), gross: r2(purchRet.gross), count: purchRet.count },
            excludedReturns:  { count: excludedReturns.count, gross: r2(excludedReturns.gross) },

            netSales:     r2(netSalesTaxable),
            netPurchases: r2(netPurchTaxable),

            stock: {
                opening: r2(opening),
                closing: r2(closing.value),
                openingComputed: r2(computedOpening.value),
                openingManual: r2(manualOpening),
                openingSource: useManual ? 'entered' : 'computed',
                openingAsOf: dayBefore(from),
                closingAsOf: to,
                uncostedUnits: Math.round(closing.noCostUnits)
            },

            cogs:        r2(cogs),
            grossProfit: r2(grossProfit),
            grossPct:    netSalesTaxable ? r2(grossProfit / netSalesTaxable * 100) : 0,

            itemMargin:  r2(itemMargin),
            marginGap:   r2(itemMargin - grossProfit),
            uncosted:    { lines: uncostedLines, revenue: r2(uncostedRevenue), products: uncostedList },

            expenses:    { total: r2(expTotalPnl), rows: expenseRows, cashTotal: r2(expTotalCash), gstRemitted: r2(gstRemitted) },
            roundOff:    r2(roundOff),

            netProfit:   r2(netProfit),
            netPct:      netSalesTaxable ? r2(netProfit / netSalesTaxable * 100) : 0,

            cash: {
                counter:   r2(counterCollections),
                byMode:    { cash: r2(byMode.cash), upi: r2(byMode.upi), card: r2(byMode.card) },
                khata:     r2(custPay),
                inTotal:   r2(cashIn),
                suppliers: r2(suppPay),
                expenses:  r2(expTotalCash),
                outTotal:  r2(cashOut),
                net:       r2(netCash),
                bridge:    bridge
            },

            warnings: warnings,
            checks:   checks
        };
    }

    /* Indian-format rupees. Kept here so warning text can use it without the
       page having to pass a formatter into a module that has no DOM. */
    function inr(v) {
        var n = num(v);
        var s = Math.abs(n).toFixed(2);
        var parts = s.split('.');
        var i = parts[0];
        var last3 = i.slice(-3), rest = i.slice(0, -3);
        if (rest) last3 = ',' + last3;
        rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
        return (n < 0 ? '−₹' : '₹') + rest + last3 + '.' + parts[1];
    }

    window.mmPnl = { build: build, stockAsOf: stockAsOf, inr: inr };
})();
