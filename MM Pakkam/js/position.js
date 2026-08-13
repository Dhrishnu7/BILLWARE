/* ══════════════════════════════════════════════════════════════════════
   position.js  —  where the money in the business is sitting, right now
   ══════════════════════════════════════════════════════════════════════
   This is NOT a balance sheet, and it must never be presented as one.

   A balance sheet is Assets = Liabilities + Capital, and it only balances
   when every side is known. Billware knows what it sells, buys, owes and is
   owed — all of it computed from documents. It cannot compute the owner's
   capital, the drawings taken out of the till on a Friday, the fridge and the
   shelving and their depreciation, the bank balance, or the loan against the
   shop, because no bill or purchase ever records them.

   PHASE 2c CHANGED WHAT IS POSSIBLE, NOT WHAT IS CLAIMED.
   js/finance.js now holds those figures — but only the ones the shop has
   actually sat down and entered. So this file asks what is present and
   reports that, and everything still absent stays in the excludes list where
   the reader can see it. The list is built from the data, not hard-coded:
   it shrinks as the shop fills the gaps, and a shop that has entered nothing
   sees exactly what it saw before.

   That is the whole discipline here. A figure nobody entered is not guessed
   at and is not assumed to be zero. Producing a "balance sheet" by plugging
   the difference would look authoritative and be wrong, which is worse than
   no statement at all — so the moment every gap is closed is the moment a
   real balance sheet becomes possible, and not one day before.

   What it answers is the question a shop owner actually asks: how much of my
   money is tied up in this business today, and in what.

   ES5, like its siblings, so the same headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function num(n) { return Number(n) || 0; }
    function r2(n) { return Math.round(num(n) * 100) / 100; }
    function key(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
    function d10(s) { return String(s == null ? '' : s).slice(0, 10); }

    function readJson(k) {
        try { return JSON.parse(localStorage.getItem(k) || '[]') || []; }
        catch (e) { return []; }
    }
    /* Reads whichever key actually holds a store. See mmCacheGet in
       supabase.js — the scoped/unscoped split cost seven dead reads in v317
       and this file is not going to add an eighth. */
    function cache(name) {
        if (typeof mmCacheGet === 'function') return mmCacheGet(name) || [];
        return readJson('mm_' + name);
    }

    function monthOf(d) { return String(d || '').slice(0, 7); }
    function todayLocal() {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    /* ──────────────────────────────────────────────────────────────────
       WHAT SUPPLIERS ARE OWED

       Lifted out of khata.html so there is ONE formula. It was inline there,
       and a second copy here would be the same mistake that had bills shaped
       in two places for months (see _mmNormalizeBills) — the two drift, and
       the screen that disagrees is whichever one nobody is looking at.

       balance = OPENING + purchases (inclusive of GST) − purchase returns − payments.
       `payments` is passed in because khata.html merges its cloud copy before
       calling; anything else can pass the local cache.

       ── The opening, added v397 ──
       What the shop already owed a distributor before it started using
       Billware. It gets its own field on the supplier rather than being
       expressed as a document, because the two available documents both lie:
       a purchase would add stock that is not on the shelf and input tax
       credit that was never earned, and a payment would move money that never
       moved. Held apart, it changes this one figure and nothing else — it is
       read here and nowhere else in the app.
    ────────────────────────────────────────────────────────────────── */
    function suppliers(payments) {
        var purchases = readJson('mm_purchases');
        var adjustments = (typeof mmLsGet === 'function') ? (mmLsGet('stockAdjustments') || []) : [];
        var merges = {};
        try { merges = JSON.parse(localStorage.getItem('mm_supplier_merges') || '{}') || {}; } catch (e) {}
        var openings = {};
        try { openings = JSON.parse(localStorage.getItem('mm_supplier_openings') || '{}') || {}; } catch (e) {}

        var map = {}, rawSet = {};
        function slot(firm) {
            var raw = String(firm || '').trim();
            if (!raw) return null;
            rawSet[raw] = true;
            var mapped = merges[raw.toLowerCase()];
            if (mapped === '__HIDDEN__') return null;      // junk entry — skip
            var canonical = mapped || raw;                 // fold variants together
            var k = key(canonical);
            if (!map[k]) map[k] = { firm: canonical.trim(), opening: 0, purchased: 0, returned: 0, paid: 0 };
            return map[k];
        }

        /* Seeded FIRST, and this is why: a supplier the shop owes money to but
           has not yet bought from in Billware has no purchase, no return and no
           payment — so without this it would have no slot at all and the debt
           would simply not appear anywhere. That is the exact case a migrated
           shop is in on day one. */
        Object.keys(openings).forEach(function (nameKey) {
            var amt = num(openings[nameKey]);
            if (!amt) return;
            var s = slot(nameKey);
            if (s) s.opening += amt;
        });

        purchases.forEach(function (p) {
            var s = slot(p.firm || p.supplierName || '');
            if (!s) return;
            var qty = num(p.quantity), rate = num(p.rate), gst = num(p.gst);
            s.purchased += (qty * rate) * (1 + gst / 100);
        });
        adjustments.filter(function (a) { return a.reason === 'purchase_return'; }).forEach(function (a) {
            var n = {};
            try { n = JSON.parse(a.note || '{}'); } catch (e) {}
            var s = slot(n.party);
            if (s) s.returned += num(n.amount);
        });
        (payments || []).forEach(function (p) {
            var s = slot(p.firm);
            if (s) s.paid += num(p.amount);
        });

        var names = Object.keys(rawSet).sort(function (a, b) {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        });
        var data = Object.keys(map).map(function (k) {
            var s = map[k];
            return { firm: s.firm, opening: s.opening, purchased: s.purchased, returned: s.returned,
                     paid: s.paid, balance: s.opening + s.purchased - s.returned - s.paid };
        }).sort(function (a, b) { return b.balance - a.balance; });

        return { data: data, rawNames: names };
    }

    /* ──────────────────────────────────────────────────────────────────
       build() → the position as of today
    ────────────────────────────────────────────────────────────────── */
    function build(opts) {
        opts = opts || {};
        var asOf = String(opts.asOf || todayLocal()).slice(0, 10);

        /* Stock at COST, from the P&L's own valuation rather than a second
           one. Two different stock figures on two screens of the same app is
           a support call nobody can answer. */
        var stock = 0;
        if (window.mmPnl && typeof mmPnl.stockAsOf === 'function') {
            var s = mmPnl.stockAsOf(asOf);
            stock = num(s && s.value);
        }

        /* What customers owe. mmCustomerList unions BOTH local stores: the
           scoped one holds only customers touched by a settlement, and
           preferring it reported one account owing Rs 16 against a Khata page
           showing Rs 811.58. Same > 0 filter the Khata page paints from. */
        var custs = (typeof mmCustomerList === 'function') ? mmCustomerList() : cache('customers');
        var debtors = 0, debtorCount = 0;
        custs.forEach(function (c) {
            var b = num(c && c.balance);
            if (b > 0) { debtors += b; debtorCount++; }
        });

        /* What suppliers are owed. Payments are passed IN when the caller has
           merged the cloud copy — the local cache is only complete after the
           Khata page has been opened, and reading it blind reported a settled
           supplier as still owing the whole Rs 696.80. */
        var sup = suppliers(opts.supplierPayments || readJson('mm_supplier_payments'));
        var creditors = 0, creditorCount = 0;
        sup.data.forEach(function (x) {
            if (x.balance > 0.005) { creditors += x.balance; creditorCount++; }
        });

        /* GST on THIS MONTH's trading, not yet paid. Deliberately the current
           month only: tax for a month already filed has been paid and is no
           longer a liability, and this file has no way to know what has been
           filed. Labelled as such on screen — an unqualified "GST payable"
           would read as a total due. */
        var month = monthOf(asOf);
        var outTax = 0, inTax = 0;
        cache('sales').forEach(function (b) {
            if (!b || b.isReturn) return;
            if (monthOf(b.date) !== month) return;
            (b.medicines || []).forEach(function (m) {
                var rate = num(m.gst), total = num(m.total);
                if (!rate || !total) return;
                outTax += total - (total / (1 + rate / 100));   // line totals are tax-inclusive
            });
        });
        readJson('mm_purchases').forEach(function (p) {
            if (monthOf(p.date) !== month) return;
            inTax += num(p.quantity) * num(p.rate) * num(p.gst) / 100;  // purchase rates are exclusive
        });

        /* RETURNS. Without these the figure was wrong by exactly the tax on
           the month's notes: a credit note reduces the tax collected, a debit
           note reduces the credit claimable. Checked against the GSTR-3B
           worksheet, which does account for them — the panel read -198.15
           where the worksheet read -182.42, and the gap was precisely the
           debit note's 16.92 less the credit note's 1.20.

           mmReturns is the only place a note's tax is known, and it is the
           same source GSTR-3B uses, so the two cannot drift apart again. */
        var cnTax = 0, dnTax = 0;
        if (window.mmReturns && typeof mmReturns.load === 'function') {
            try {
                var rets = mmReturns.load({ from: month + '-01', to: month + '-31' });
                (rets.creditNotes || []).forEach(function (n) { if (n.usable) cnTax += num(n.tax); });
                (rets.debitNotes  || []).forEach(function (n) { if (n.usable) dnTax += num(n.tax); });
            } catch (e) { /* a missing returns module must not break the panel */ }
        }
        outTax -= cnTax;
        inTax  -= dnTax;

        var gstNet = outTax - inTax;

        /* If the GSTR-3B worksheet is on the page, take ITS figures instead of
           these. Not because the arithmetic above is wrong — it agrees to the
           paisa on the money — but because 3B rounds each tax head BEFORE
           adding them, and rounding once at the end lands a paisa away. Two
           screens of one app showing -182.42 and -182.43 makes a shop distrust
           both, and the one on the filing screen is the one to match.

           The same principle as everything else here: use the module that owns
           the figure rather than reproducing its arithmetic and hoping. */
        var gstFrom = 'computed here';
        if (window.mmGstr3b && typeof mmGstr3b.build === 'function') {
            try {
                var b3 = mmGstr3b.build({ period: month });
                if (b3 && b3.outward && b3.itc) {
                    outTax = num(b3.outputTax !== undefined ? b3.outputTax
                                 : (num(b3.outward.cgst) + num(b3.outward.sgst) + num(b3.outward.igst)));
                    inTax  = num(b3.itc.total);
                    gstNet = outTax - inTax;
                    gstFrom = 'GSTR-3B worksheet';
                }
            } catch (e) { /* fall back to the figures above */ }
        }

        /* ──────────────────────────────────────────────────────────────
           PHASE 2c — the right-hand side, when the shop has entered it.

           Everything above this point is computed from documents. Everything
           below comes from js/finance.js, which holds the things no bill or
           purchase ever records. The rule that governs the whole block: a
           figure the shop has NOT entered is not guessed at, is not assumed
           to be zero, and stays in the excludes list where the reader can see
           it. That is the same reason this file has always refused to call
           itself a balance sheet, and it does not change just because there
           is more data now — it changes only for the parts actually filled in.
        ────────────────────────────────────────────────────────────────── */
        var fin = null;
        if (window.mmFinance && typeof mmFinance.summary === 'function') {
            try { fin = mmFinance.summary({ asOf: asOf }); } catch (e) { fin = null; }
        }
        var has = {};
        var cash = 0, bank = 0, assets = 0, assetCost = 0, assetDep = 0,
            loans = 0, deposits = 0, capital = 0;
        if (fin) {
            (fin.accounts || []).forEach(function (a) { has[a.kind] = true; });
            cash      = num(fin.cash);
            bank      = num(fin.bank);
            assets    = num(fin.assetWdv);
            assetCost = num(fin.assetCost);
            assetDep  = num(fin.assetDep);
            loans     = num(fin.loans);
            deposits  = num(fin.deposits);
            capital   = num(fin.capital);
        }

        /* OPENING DEBTORS AND CREDITORS. Applied only when dated on or before
           the date being reported, exactly as mmPnl treats opening stock — an
           opening figure must never leak backwards into a period that ended
           before it was struck. Reported as its own number rather than folded
           in silently, because a shop that ALSO typed those old balances into
           the Khata by hand would otherwise be counted twice with nothing on
           screen to reveal it. */
        var op = (fin && fin.openings) ? fin.openings
               : { debtors: 0, creditors: 0, date: '' };
        var openApplies = !!(op.date && d10(op.date) <= asOf);
        var openDebtors   = openApplies ? num(op.debtors)   : 0;
        var openCreditors = openApplies ? num(op.creditors) : 0;
        debtors   += openDebtors;
        creditors += openCreditors;

        /* Net worth, not "working capital" — with fixed assets and loans in
           it, the old name would have been wrong.

           EVERY TERM IS ROUNDED BEFORE IT IS ADDED, because every term is
           PRINTED rounded. Summing the full-precision figures and rounding at
           the end lands up to a paisa away from what the rows on screen
           actually add up to — and a statement whose own visible lines do not
           foot is exactly what the arithmetic checks above exist to prevent.
           The reader must be able to add the column up by hand and agree.
           Same principle as taking GST from the GSTR-3B worksheet rather than
           re-deriving it: match the figure that is shown. */
        var assetSide     = r2(stock) + r2(debtors) + r2(cash) + r2(bank) + r2(assets) + r2(deposits);
        var liabilitySide = r2(creditors) + Math.max(0, r2(gstNet)) + r2(loans);
        var working = r2(assetSide) - r2(liabilitySide);

        /* WHAT IS STILL MISSING. Built from what the shop has actually
           entered, so the list shrinks as the gaps are filled and a shop that
           has entered nothing sees exactly what it saw before. A static list
           would either lie about data that is now present, or stop warning
           about data that is still absent. */
        var excludes = [];
        if (!has.cash && !has.bank) excludes.push('Cash in the till and money in the bank');
        else if (!has.cash)         excludes.push('Cash in the till (no cash account set up)');
        else if (!has.bank)         excludes.push('Money in the bank (no bank account set up)');
        if (!has.capital) excludes.push('What the owner put in, and what they have taken out');
        if (!has.asset)   excludes.push('Shop fittings, fridge, computer — and depreciation on them');
        if (!has.loan && !has.deposit) excludes.push('Loans, rent deposits and advances');
        else if (!has.loan)            excludes.push('Loans');
        else if (!has.deposit)         excludes.push('Rent deposits and advances');
        if (!openApplies) excludes.push('Anything owed or owned before this shop started using Billware');

        return {
            asOf: asOf,
            month: month,
            stock: r2(stock),
            debtors: r2(debtors), debtorCount: debtorCount,
            creditors: r2(creditors), creditorCount: creditorCount,
            outputTax: r2(outTax), inputTax: r2(inTax), gstNet: r2(gstNet),
            creditNoteTax: r2(cnTax), debitNoteTax: r2(dnTax),
            gstSource: gstFrom,

            /* Phase 2c */
            cash: r2(cash), bank: r2(bank),
            cashFromDocuments: r2(fin ? fin.cashFromDocuments : 0),
            cashSource: fin ? fin.cashSource : '',
            assets: r2(assets), assetCost: r2(assetCost), assetDep: r2(assetDep),
            loans: r2(loans), deposits: r2(deposits), capital: r2(capital),
            openDebtors: r2(openDebtors), openCreditors: r2(openCreditors),
            openDate: openApplies ? d10(op.date) : '',
            has: has,
            hasFinance: !!(fin && fin.hasData),

            assetSide: r2(assetSide), liabilitySide: r2(liabilitySide),
            working: r2(working),

            /* The gap between what the business is worth and what the owner
               put in is, roughly, profit left in the business. Roughly — it is
               only exact once every figure above is complete, which is why it
               is offered as a reading and not as a line of the statement. */
            retained: has.capital ? r2(working - capital) : null,

            excludes: excludes
        };
    }

    window.mmPosition = { build: build, suppliers: suppliers };
})();
