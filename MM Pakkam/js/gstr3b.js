/* ══════════════════════════════════════════════════════════════════════
   gstr3b.js  —  the summary return where the money actually moves
   ══════════════════════════════════════════════════════════════════════
   GSTR-1 says what was sold. GSTR-3B is where the tax is PAID, and a shop
   that files the first and skips the second has declared its sales and
   paid nothing — which is the one that attracts interest.

   Three decisions worth not re-litigating:

   1. **A worksheet, not a file.** GSTR-1 is hundreds of rows, so typing it
      is the pain and a JSON file is the answer. GSTR-3B is about fifteen
      numbers — typing them is trivial, KNOWING them is the whole problem.
      A worksheet also means every figure is read by a human before it
      moves money, which matters more here than anywhere else in the app.

   2. **Table 3.1 is taken from GSTR-1's own output**, not recomputed from
      the bills. The portal compares the two returns and flags any
      difference, so they must agree by construction rather than by luck.

   3. **Any date range**, not a fixed month. A monthly filer picks a month;
      a QRMP filer picks a quarter for the return and a single month for
      the PMT-06 payment. One engine, no setting for a shop to get wrong.

   What it CANNOT know is stated, never guessed: reverse charge, ITC
   reversals under rule 42/43 and section 17(5), and interest. Those are
   manual, and the screen says why.

   ⚠ The ITC figure is the shop's PURCHASE REGISTER, which is the most it
   might claim — not what it is allowed to claim. Since 2022 credit is
   restricted to what appears in GSTR-2B, i.e. what suppliers actually
   filed. This module must never present its ITC number as final.

   ES5, like its siblings, so the headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function num(n) { return Number(n) || 0; }
    function str(s) { return String(s == null ? '' : s).trim(); }

    function ls(k, dflt) {
        try { return JSON.parse(localStorage.getItem(k) || dflt); }
        catch (e) { return JSON.parse(dflt); }
    }

    function inRange(d, from, to) {
        var s = str(d).slice(0, 10);
        if (!s) return false;
        if (from && s < from) return false;
        if (to && s > to) return false;
        return true;
    }

    /* Every calendar month the range touches. GSTR-1 is built one month at
       a time, so a quarter is three calls and a sum — which is also exactly
       how the portal treats a QRMP quarter. */
    function monthsBetween(from, to) {
        var out = [];
        var y = Number(str(from).slice(0, 4)), m = Number(str(from).slice(5, 7));
        var ey = Number(str(to).slice(0, 4)), em = Number(str(to).slice(5, 7));
        if (!y || !m || !ey || !em) return out;
        var guard = 0;
        while ((y < ey || (y === ey && m <= em)) && guard++ < 60) {
            out.push(y + '-' + (m < 10 ? '0' + m : String(m)));
            m++; if (m > 12) { m = 1; y++; }
        }
        return out;
    }

    /* A range only IS those months if it starts on the 1st and ends on the
       last day. Anything else silently reports a different period from the
       one that would be filed, so it is refused rather than approximated. */
    function coversWholeMonths(from, to) {
        if (str(from).slice(8) !== '01') return false;
        var y = Number(str(to).slice(0, 4)), m = Number(str(to).slice(5, 7));
        var last = new Date(y, m, 0).getDate();
        return Number(str(to).slice(8)) === last;
    }

    var MANUAL_KEY = 'mm_gstr3b_manual';
    function loadManual(period) {
        var all = ls(MANUAL_KEY, '{}') || {};
        return all[period] || { rcTaxable: 0, rcCgst: 0, rcSgst: 0, rcIgst: 0,
                                itcRevCgst: 0, itcRevSgst: 0, itcRevIgst: 0,
                                b2Cgst: '', b2Sgst: '', b2Igst: '',
                                interest: 0, lateFee: 0 };
    }
    function saveManual(period, obj) {
        var all = ls(MANUAL_KEY, '{}') || {};
        all[period] = obj;
        try { localStorage.setItem(MANUAL_KEY, JSON.stringify(all)); } catch (e) {}
    }

    /* ──────────────────────────────────────────────────────────────────
       build({ from, to })
    ────────────────────────────────────────────────────────────────── */
    function build(opts) {
        opts = opts || {};
        var from = str(opts.from), to = str(opts.to);
        var shop = window.mmShopProfile || {};
        var signals = [];

        var months = monthsBetween(from, to);
        var whole  = months.length > 0 && coversWholeMonths(from, to);
        var period = months.length === 1 ? months[0]
                   : (months[0] || '') + '..' + (months[months.length - 1] || '');

        /* ── Outward (3.1) — straight from the GSTR-1 figures ─────────── */
        var out = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        var nilRated = 0;
        var gstr1Ran = false, gstr1Bills = 0, cnValue = 0;

        if (window.mmGstr1 && typeof window.mmGstr1.build === 'function') {
            if (!whole) {
                signals.push({ level: 'block', text:
                    'A return covers whole calendar months. Set the dates to a complete month ' +
                    '(or quarter) — a part-month worksheet would not match anything you can file.' });
            } else {
                gstr1Ran = true;
                for (var i = 0; i < months.length; i++) {
                    var g;
                    try {
                        g = window.mmGstr1.build({ month: months[i], gstin: str(shop.gstin) });
                    } catch (e) {
                        signals.push({ level: 'block', text: 'GSTR-1 for ' + months[i] +
                                       ' could not be built: ' + (e && e.message ? e.message : e) });
                        continue;
                    }
                    gstr1Bills += (g.summary && g.summary.bills) || 0;
                    cnValue    += (g.summary && g.summary.creditNoteValue) || 0;

                    /* The HSN summary covers B2B and B2CS alike and is already
                       net of credit notes, so it is the whole outward supply.
                       Rate 0 belongs in 3.1(c), never in 3.1(a). */
                    (g.hsn || []).forEach(function (h) {
                        if (num(h.rt) === 0) { nilRated += num(h.txval); return; }
                        out.taxable += num(h.txval);
                        out.cgst    += num(h.camt);
                        out.sgst    += num(h.samt);
                        out.igst    += num(h.iamt);        // present only if ever emitted
                    });

                    var s1 = g.summary || {};
                    if (s1.missingHsn)  signals.push({ level: 'block', text:
                        months[i] + ': ' + s1.missingHsn + ' line(s) have no HSN code — run "Check before filing" first.' });
                    if (s1.badRates && s1.badRates.length) signals.push({ level: 'block', text:
                        months[i] + ': GST rates that do not exist are in use — run "Check before filing" first.' });
                }
            }
        } else {
            signals.push({ level: 'block', text: 'The GSTR-1 module did not load, so outward supplies cannot be read.' });
        }

        /* This app books every sale as CGST+SGST; nothing produces IGST on
           the sales side yet. Saying so is better than a silent 0. */
        if (!out.igst) {
            signals.push({ level: 'info', text:
                'IGST on sales is shown as 0 — this app books every sale as CGST + SGST. ' +
                'If you sell to other states, that figure has to come from your own records.' });
        }

        /* ── Inward / ITC (4A5) — the shop's purchase register ────────── */
        var purch = ls('mm_purchases', '[]') || [];
        var itc = { cgst: 0, sgst: 0, igst: 0, total: 0 };
        var exemptInward = 0, purchLines = 0, badPurchRate = 0;
        var purchBills = {};

        purch.forEach(function (p) {
            if (!inRange(p.date, from, to)) return;
            purchLines++;
            if (str(p.billNo)) purchBills[str(p.billNo).toLowerCase() + '|' + str(p.firm).toLowerCase()] = 1;
            /* Purchases store a PRE-tax rate per pack and a pack quantity —
               the opposite of the sales side, where the line total already
               includes tax. Getting this backwards understates ITC by the
               whole GST rate. */
            var base = num(p.rate) * num(p.quantity);
            var rate = num(p.gst);
            if (rate === 0) { exemptInward += base; return; }
            if (window.mmGstValid && !mmGstValid.rate(rate)) badPurchRate++;
            var tax = base * rate / 100;
            var half = tax / 2;
            itc.cgst += half;
            itc.sgst += half;
        });

        /* A debit note returns goods to the supplier, so the credit taken on
           them has to come back out. Sales credit notes are already netted
           off the outward side by GSTR-1. */
        var dnTax = 0, dnCount = 0;
        if (window.mmReturns && typeof window.mmReturns.load === 'function') {
            try {
                var rets = window.mmReturns.load({ from: from, to: to });
                (rets.debitNotes || []).forEach(function (n) {
                    if (!n.usable) return;
                    dnCount++;
                    dnTax += num(n.tax);
                });
                if (rets.problems && rets.problems.length) {
                    signals.push({ level: 'warn', text:
                        rets.problems.length + ' return(s) could not be read, so they are not ' +
                        'reflected here — run "Check before filing".' });
                }
            } catch (e) { /* returns module absent; not fatal */ }
        }
        itc.cgst = itc.cgst - dnTax / 2;
        itc.sgst = itc.sgst - dnTax / 2;
        itc.total = itc.cgst + itc.sgst + itc.igst;

        /* ── Does the input to this worksheet look believable? ─────────
           The shop is the only one who knows if its purchase entry is
           complete. The software cannot know — but it can notice when the
           numbers do not look like a working pharmacy. */
        var outTax = out.cgst + out.sgst + out.igst;
        if (!purchLines) {
            signals.push({ level: 'block', text:
                'No purchases are recorded in this period, so the input credit below is zero. ' +
                'If you bought stock, enter those bills first — filing this would overpay.' });
        } else if (outTax > 0 && itc.total < outTax * 0.15) {
            signals.push({ level: 'warn', text:
                'Input credit is under 15% of the tax you collected. For a pharmacy that usually ' +
                'means purchase bills are missing for this period. Worth checking before you pay.' });
        }
        if (badPurchRate) {
            signals.push({ level: 'warn', text:
                badPurchRate + ' purchase line(s) use a GST rate that does not exist — the credit on them is wrong.' });
        }

        /* The single most important caveat in this file. */
        signals.push({ level: 'itc', text:
            'This input credit is your PURCHASE REGISTER — the most you might claim. ' +
            'Since 2022 you may only claim what appears in GSTR-2B, i.e. what your suppliers ' +
            'actually filed. Compare the two on the portal before you file.' });

        var manual = loadManual(period);

        return {
            from: from, to: to, months: months, period: period,
            wholeMonths: whole,
            gstr1Ran: gstr1Ran,
            counts: { bills: gstr1Bills, purchaseLines: purchLines,
                      purchaseBills: Object.keys(purchBills).length,
                      debitNotes: dnCount },
            outward: { taxable: r2(out.taxable), cgst: r2(out.cgst),
                       sgst: r2(out.sgst), igst: r2(out.igst) },
            nilRated: r2(nilRated),
            creditNoteValue: r2(cnValue),
            itc: { cgst: r2(itc.cgst), sgst: r2(itc.sgst), igst: r2(itc.igst), total: r2(itc.total) },
            exemptInward: r2(exemptInward),
            debitNoteTax: r2(dnTax),
            outputTax: r2(outTax),
            manual: manual,
            signals: signals
        };
    }

    /* Net cash payable, given the boxes only the shop can fill.
       Kept separate from build() so typing in a manual box re-totals without
       rebuilding three months of GSTR-1. */
    function settle(res, manual) {
        var m = manual || res.manual || {};
        var rc = num(m.rcCgst) + num(m.rcSgst) + num(m.rcIgst);
        var rev = num(m.itcRevCgst) + num(m.itcRevSgst) + num(m.itcRevIgst);

        /* If the shop has entered the real GSTR-2B figures, those are what
           may actually be claimed — our register total is only a ceiling. */
        var b2Given = str(m.b2Cgst) !== '' || str(m.b2Sgst) !== '' || str(m.b2Igst) !== '';
        var itcGross = b2Given
            ? num(m.b2Cgst) + num(m.b2Sgst) + num(m.b2Igst)
            : res.itc.total;

        var netItc = itcGross - rev;
        var liability = res.outputTax + rc;
        var payable = liability - netItc;

        return {
            usedB2: b2Given,
            itcGross: r2(itcGross),
            itcReversed: r2(rev),
            netItc: r2(netItc),
            reverseCharge: r2(rc),
            liability: r2(liability),
            /* A negative figure is not a refund — it carries forward in the
               credit ledger. Showing it as money back would be wrong. */
            payable: r2(Math.max(0, payable)),
            carryForward: r2(Math.max(0, -payable)),
            interest: r2(num(m.interest) + num(m.lateFee))
        };
    }

    window.mmGstr3b = {
        build: build,
        settle: settle,
        loadManual: loadManual,
        saveManual: saveManual,
        monthsBetween: monthsBetween,
        coversWholeMonths: coversWholeMonths
    };
})();
