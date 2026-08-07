/* ══════════════════════════════════════════════════════════════════════
   finance.js — cash, bank, capital, loans, fixed assets and deposits.
                The parts of the shop's finances that no bill or purchase
                ever records.

   WHY THIS EXISTS
   js/daybook.js opens by admitting the gap: "The app has no cash-in-hand
   ledger — nobody tells it what was in the till this morning, so this is a
   movement, not a balance." js/position.js ends with a list of five things it
   cannot include for the same reason. Both were honest and both were the
   same missing table. This is that table's module.

   WHAT IT IS NOT
   Not double entry. Nothing here posts a sale or a purchase — those are
   already documents, and js/pnl.js already reads them. A posted second copy
   would give the app two answers to "what did we sell", and the wrong one
   would be whichever screen nobody was looking at. Same rule as
   _mmNormalizeBills, mmTaxHead and mmPosition.suppliers: one owner per
   number, everything else derives.

   THE THREE RULES THIS MODULE ENFORCES

   1. DEPRECIATION IS DERIVED, NEVER STORED. A stored yearly depreciation
      entry is re-postable, and v300 is the standing proof that an insert is
      not idempotent — a duplicate would quietly overstate the charge and
      understate the profit, in a plausible-looking way nobody would catch.
      accumTo(asset, date) is a pure function of cost, date, method and rate,
      so it cannot drift and cannot double-apply.

   2. CASH IS OPENING + DOCUMENTS + MANUAL MOVEMENTS, in that order, and the
      middle term belongs to mmDayBook. The till balance is not the sum of
      what somebody remembered to type — most of it is sales and supplier
      payments the app already knows about. Documents are counted only from
      the cash account's opening_date onward, because anything before it is
      already inside the opening figure. Counting it twice is the single
      easiest way to make this whole feature wrong.

   3. AN EMI IS TWO DIFFERENT THINGS. The principal repays the loan (balance
      sheet); the interest is an expense (P&L). They are split at entry and
      stored apart, so neither is ever inferred from a rate. The bank's own
      figure beats an amortisation formula, every time.

   ES5 and DOM-free, like pnl/daybook/position, so the same headless harness
   drives it.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function num(n) { return Number(n) || 0; }
    function r2(n)  { return Math.round(num(n) * 100) / 100; }
    function d10(s) { return String(s == null ? '' : s).slice(0, 10); }

    function readJson(k) {
        try { return JSON.parse(localStorage.getItem(k) || '[]') || []; }
        catch (e) { return []; }
    }
    /* mmCacheGet knows about the scoped/unscoped split that cost seven dead
       reads in v317. Use it when it is there and never hand-roll the fallback. */
    function cache(name) {
        if (typeof mmCacheGet === 'function') return mmCacheGet(name) || [];
        return readJson('mm_' + name);
    }

    function todayLocal() {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    /* Dates are compared as YYYY-MM-DD STRINGS throughout, never as Date
       objects. A date is not a time (v315): '2026-08-05' parses as UTC
       midnight and reads as the 5th at 5:30 am in IST, which is how every
       bill in this app once claimed to have been taken before dawn. String
       comparison on a fixed-width format is exact and timezone-free. */
    function dayNum(s) {                     // days since epoch, for arithmetic only
        var p = d10(s).split('-');
        if (p.length !== 3) return NaN;
        return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
    }
    function fromDayNum(n) {
        var d = new Date(n * 86400000), p = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }
    function dayBefore(s) { var n = dayNum(s); return isNaN(n) ? s : fromDayNum(n - 1); }

    /* Indian financial year: 1 April to 31 March. Depreciation is charged per
       financial year with a pro-rata for the year of purchase, which is what
       every Indian CA expects to see and what the Companies Act schedule
       assumes. A calendar year here would silently disagree with the books. */
    function fyEndOf(dateStr) {
        var p = d10(dateStr).split('-');
        var y = +p[0], m = +p[1];
        return (m >= 4 ? y + 1 : y) + '-03-31';
    }
    function daysInFyEnding(fyEnd) {
        var end = dayNum(fyEnd);
        var startY = +d10(fyEnd).slice(0, 4) - 1;
        return end - dayNum(startY + '-04-01') + 1;      // 365, or 366 in a leap FY
    }

    function accounts() { return cache('finance_accounts') || []; }
    function entries()  { return cache('finance_entries')  || []; }

    function byId(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
        return null;
    }

    /* ──────────────────────────────────────────────────────────────────
       DEPRECIATION

       accumTo(asset, asOf) — total depreciation charged from the day the
       asset was bought up to and including asOf. A window charge is then
       accumTo(to) − accumTo(day before from), which composes exactly and
       needs no separate code path.

       Both methods are supported because both are in use: WDV (written-down
       value, the Income Tax Act default and what most pharmacies file on) and
       SLM (straight line, the Companies Act presentation).

       The charge is capped so accumulated depreciation can never exceed
       cost − salvage. An asset written down past its own value is a fault
       every CA notices immediately.
    ────────────────────────────────────────────────────────────────── */
    function accumTo(asset, asOf) {
        if (!asset || asset.kind !== 'asset') return 0;
        var cost = num(asset.opening);
        var bought = d10(asset.openingDate);
        var end = d10(asOf);
        if (!cost || !bought || !end || end < bought) return 0;

        var meta = asset.meta || {};
        var rate = num(meta.rate);
        if (rate <= 0) return 0;                       // no rate entered = no charge
        var slm = String(meta.method || 'wdv').toLowerCase() === 'slm';
        var salvage = Math.max(0, num(meta.salvage));
        var ceiling = Math.max(0, cost - salvage);
        if (!ceiling) return 0;

        var total = 0, cursor = bought, guard = 0;
        while (cursor <= end && guard++ < 400) {        // 400 FYs is not a real shop
            var fyEnd = fyEndOf(cursor);
            var segEnd = (fyEnd < end) ? fyEnd : end;
            var held = dayNum(segEnd) - dayNum(cursor) + 1;
            if (held > 0) {
                /* WDV reduces on the balance carried into THIS year, so the
                   base is recomputed each pass. SLM always charges on the
                   original depreciable amount. */
                var yearCharge = slm ? (ceiling * rate / 100)
                                     : ((cost - total) * rate / 100);
                var charge = yearCharge * held / daysInFyEnding(fyEnd);
                if (charge > ceiling - total) charge = ceiling - total;
                if (charge > 0) total += charge;
            }
            if (segEnd >= end) break;
            cursor = fromDayNum(dayNum(fyEnd) + 1);
        }
        return r2(total);
    }

    function depreciationBetween(from, to) {
        var f = d10(from), t = d10(to), out = { total: 0, items: [] };
        accounts().forEach(function (a) {
            if (!a || a.kind !== 'asset' || a.active === false) return;
            var charge = accumTo(a, t) - (f ? accumTo(a, dayBefore(f)) : 0);
            charge = r2(charge);
            if (Math.abs(charge) < 0.005) return;
            out.total += charge;
            out.items.push({ id: a.id, name: a.name, amount: charge,
                             method: (a.meta && a.meta.method) || 'wdv',
                             rate: num(a.meta && a.meta.rate) });
        });
        out.total = r2(out.total);
        out.items.sort(function (x, y) { return y.amount - x.amount; });
        return out;
    }

    /* ──────────────────────────────────────────────────────────────────
       BALANCES

       Pure: opening plus the manual movements recorded against the account.
       Document-driven cash is added in summary() and NOT here, because it
       belongs to one nominated till and adding it per-account would count it
       once for every cash account the shop happens to have created.
    ────────────────────────────────────────────────────────────────── */
    function movementsFor(accountId, asOf) {
        var t = d10(asOf), sum = 0;
        entries().forEach(function (e) {
            if (!e || e.accountId !== accountId) return;
            if (t && d10(e.date) > t) return;
            sum += num(e.direction === -1 ? -1 : 1) * Math.abs(num(e.amount));
        });
        return r2(sum);
    }

    function balanceAsOf(account, asOf) {
        var a = (typeof account === 'string') ? byId(accounts(), account) : account;
        if (!a) return 0;
        var t = d10(asOf || todayLocal());
        /* An account that does not exist yet on the asked-for date has no
           balance. Without this an opening figure dated April would appear in
           a February statement, which is the same "leaked backwards" fault
           mmPnl guards against with its opening-stock date. */
        if (a.openingDate && t < d10(a.openingDate)) return 0;

        var base = num(a.opening) + movementsFor(a.id, t);
        if (a.kind === 'asset') base -= accumTo(a, t);      // carrying value
        return r2(base);
    }

    /* Interest and bank charges — expenses that live on an entry rather than
       in the expenses table, because they arrive as part of a payment rather
       than as a bill of their own. */
    function chargesBetween(from, to) {
        var f = d10(from), t = d10(to);
        var interest = 0, bank = 0;
        entries().forEach(function (e) {
            if (!e) return;
            var d = d10(e.date);
            if (f && d < f) return;
            if (t && d > t) return;
            interest += Math.abs(num(e.interest));
            if (e.kind === 'charge') bank += Math.abs(num(e.amount));
        });
        return { interest: r2(interest), bankCharges: r2(bank) };
    }

    /* ──────────────────────────────────────────────────────────────────
       OPENING DEBTORS / CREDITORS
       Not accounts — single figures on the shop profile, for the same reason
       opening stock is: a shop that started mid-life was already owed money,
       and no document here ever saw it.
    ────────────────────────────────────────────────────────────────── */
    function openings() {
        var v = { debtors: 0, creditors: 0, date: '' };
        try {
            v.debtors   = num(localStorage.getItem('mm_opening_debtors'));
            v.creditors = num(localStorage.getItem('mm_opening_creditors'));
            v.date      = localStorage.getItem('mm_opening_balances_date') || '';
        } catch (e) {}
        return v;
    }

    /* ──────────────────────────────────────────────────────────────────
       SUMMARY — everything position.js needs, in one pass.
    ────────────────────────────────────────────────────────────────── */
    function summary(opts) {
        opts = opts || {};
        var asOf = d10(opts.asOf || todayLocal());
        var all = accounts().filter(function (a) { return a && a.active !== false; });

        var out = {
            asOf: asOf,
            cash: 0, bank: 0, capital: 0, loans: 0, deposits: 0,
            assetCost: 0, assetDep: 0, assetWdv: 0,
            cashFromDocuments: 0, cashSource: 'no cash account',
            accounts: [], hasData: all.length > 0
        };

        var primaryCash = null;
        all.forEach(function (a) {
            var bal = balanceAsOf(a, asOf);
            out.accounts.push({ id: a.id, kind: a.kind, name: a.name, balance: bal,
                                opening: num(a.opening), openingDate: d10(a.openingDate) });
            if (a.kind === 'cash') {
                out.cash += bal;
                /* The nominated till. meta.primary wins; otherwise the
                   earliest-opened cash account, which for the overwhelmingly
                   common one-till shop is simply "the one". */
                if (!primaryCash || (a.meta && a.meta.primary)) {
                    if (!primaryCash || (a.meta && a.meta.primary) ||
                        d10(a.openingDate) < d10(primaryCash.openingDate)) primaryCash = a;
                }
            } else if (a.kind === 'bank')    out.bank     += bal;
            else if (a.kind === 'capital')   out.capital  += bal;
            else if (a.kind === 'loan')      out.loans    += bal;
            else if (a.kind === 'deposit')   out.deposits += bal;
            else if (a.kind === 'asset') {
                out.assetCost += num(a.opening) + movementsFor(a.id, asOf);
                out.assetDep  += accumTo(a, asOf);
                out.assetWdv  += bal;
            }
        });

        /* RULE 2. Sales, supplier payments and cash expenses already move the
           till, and mmDayBook is the module that owns that figure. Counted
           from the till's opening_date forward only — anything earlier is
           inside the opening balance already, and counting it twice would
           overstate the cash by roughly the shop's entire history. */
        if (primaryCash && window.mmDayBook && typeof mmDayBook.load === 'function') {
            try {
                var from = d10(primaryCash.openingDate) || '2000-01-01';
                var db = mmDayBook.load({ from: from, to: asOf });
                var net = num(db && db.totals && db.totals.net);
                out.cashFromDocuments = r2(net);
                out.cash = r2(out.cash + net);
                out.cashSource = 'till float + sales and payments since ' + from;
            } catch (e) {
                out.cashSource = 'manual entries only — the Day Book could not be read';
            }
        } else if (primaryCash) {
            out.cashSource = 'manual entries only';
        }

        ['cash', 'bank', 'capital', 'loans', 'deposits',
         'assetCost', 'assetDep', 'assetWdv'].forEach(function (k) { out[k] = r2(out[k]); });

        out.openings = openings();
        return out;
    }

    window.mmFinance = {
        accounts: accounts,
        entries: entries,
        balanceAsOf: balanceAsOf,
        accumTo: accumTo,
        depreciationBetween: depreciationBetween,
        chargesBetween: chargesBetween,
        openings: openings,
        summary: summary,
        /* exported for the harness, which has to be able to check the FY
           arithmetic without reconstructing it */
        _fyEndOf: fyEndOf,
        _daysInFyEnding: daysInFyEnding
    };
})();
