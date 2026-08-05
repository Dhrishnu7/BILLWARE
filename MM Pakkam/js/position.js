/* ══════════════════════════════════════════════════════════════════════
   position.js  —  where the money in the business is sitting, right now
   ══════════════════════════════════════════════════════════════════════
   This is NOT a balance sheet, and it must never be presented as one.

   A balance sheet is Assets = Liabilities + Capital, and it only balances
   when every side is known. Billware knows what it sells, buys, owes and is
   owed. It has no idea about the owner's capital, the drawings taken out of
   the till on a Friday, the fridge and the shelving and their depreciation,
   the bank balance, or the loan against the shop. Those are not small
   omissions — they are most of the right-hand side.

   Producing a "balance sheet" from what is here would need a plug figure to
   make it foot, and a statement that looks authoritative while being wrong is
   worse than no statement at all. So this reports the part that IS known, says
   so plainly, and lists what it leaves out.

   What it answers is the question a shop owner actually asks: how much of my
   money is tied up in this business today, and in what.

   ES5, like its siblings, so the same headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function num(n) { return Number(n) || 0; }
    function r2(n) { return Math.round(num(n) * 100) / 100; }
    function key(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

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

       balance = purchases (inclusive of GST) − purchase returns − payments.
       `payments` is passed in because khata.html merges its cloud copy before
       calling; anything else can pass the local cache.
    ────────────────────────────────────────────────────────────────── */
    function suppliers(payments) {
        var purchases = readJson('mm_purchases');
        var adjustments = (typeof mmLsGet === 'function') ? (mmLsGet('stockAdjustments') || []) : [];
        var merges = {};
        try { merges = JSON.parse(localStorage.getItem('mm_supplier_merges') || '{}') || {}; } catch (e) {}

        var map = {}, rawSet = {};
        function slot(firm) {
            var raw = String(firm || '').trim();
            if (!raw) return null;
            rawSet[raw] = true;
            var mapped = merges[raw.toLowerCase()];
            if (mapped === '__HIDDEN__') return null;      // junk entry — skip
            var canonical = mapped || raw;                 // fold variants together
            var k = key(canonical);
            if (!map[k]) map[k] = { firm: canonical.trim(), purchased: 0, returned: 0, paid: 0 };
            return map[k];
        }

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
            return { firm: s.firm, purchased: s.purchased, returned: s.returned,
                     paid: s.paid, balance: s.purchased - s.returned - s.paid };
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

        // What customers owe. Same > 0 filter the Khata page paints from.
        var debtors = 0, debtorCount = 0;
        cache('customers').forEach(function (c) {
            var b = num(c && c.balance);
            if (b > 0) { debtors += b; debtorCount++; }
        });

        // What suppliers are owed. Negative balances (an overpaid supplier)
        // are NOT netted off — that is money out, not a reduction of what is
        // owed to somebody else.
        var sup = suppliers(readJson('mm_supplier_payments'));
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
        var gstNet = outTax - inTax;

        var working = stock + debtors - creditors - Math.max(0, gstNet);

        return {
            asOf: asOf,
            month: month,
            stock: r2(stock),
            debtors: r2(debtors), debtorCount: debtorCount,
            creditors: r2(creditors), creditorCount: creditorCount,
            outputTax: r2(outTax), inputTax: r2(inTax), gstNet: r2(gstNet),
            working: r2(working),
            /* Stated, not implied. Every one of these is a real part of the
               shop's finances that this app does not hold, and the reader has
               to know that before they trust the figure above. */
            excludes: [
                'Cash in the till and money in the bank',
                'What the owner put in, and what they have taken out',
                'Shop fittings, fridge, computer — and depreciation on them',
                'Loans, rent deposits and advances',
                'Anything owed or owned before this shop started using Billware'
            ]
        };
    }

    window.mmPosition = { build: build, suppliers: suppliers };
})();
