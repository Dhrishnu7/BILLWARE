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
       THE TILL, AND THE DOCUMENTS THAT MOVE IT

       Extracted so that summary() and statement() cannot disagree about what
       is in the drawer. They previously would have: the summary added the Day
       Book's net movement while a statement built from entries alone would
       have shown a different closing figure, and a cash book that does not
       foot to the cash balance on the next screen is worse than no cash book.
       One definition, two readers — the same rule as mmPosition.suppliers.
    ────────────────────────────────────────────────────────────────── */
    function primaryCashAccount() {
        var best = null;
        accounts().forEach(function (a) {
            if (!a || a.kind !== 'cash' || a.active === false) return;
            if (a.meta && a.meta.primary) { best = a; return; }
            if (!best) { best = a; return; }
            if (best.meta && best.meta.primary) return;      // an explicit choice wins
            if (d10(a.openingDate) < d10(best.openingDate)) best = a;
        });
        return best;
    }

    /* Net cash the DOCUMENTS have moved through this account up to asOf,
       from its opening date — everything earlier is inside the opening figure.

       This used to hand the WHOLE day book to the primary till, because the
       day book called cash, UPI and card alike "cash". A UPI sale therefore
       increased the drawer, which is why the till count came up short by the
       day's UPI and card takings every day, and why a bank account could only
       ever hold hand-typed entries.

       Now each account collects what was ROUTED to it. The till still gets
       everything unrouted (byAccount['']), so a shop that has configured
       nothing sees exactly the figure it saw before — the fix is opt-in by
       construction rather than by a flag someone has to remember. */
    function documentCashTo(acct, asOf) {
        if (!acct || (acct.kind !== 'cash' && acct.kind !== 'bank')) return 0;
        if (!window.mmDayBook || typeof mmDayBook.load !== 'function') return 0;
        var from = d10(acct.openingDate) || '2000-01-01';
        var to = d10(asOf);
        if (!to || to < from) return 0;
        try {
            var db = mmDayBook.load({ from: from, to: to });
            var by = (db && db.totals && db.totals.byAccount) || null;
            /* An older day book without byAccount: fall back to the previous
               behaviour rather than silently reporting zero cash. */
            if (!by) {
                var p0 = primaryCashAccount();
                if (acct.kind === 'cash' && p0 && p0.id === acct.id) {
                    return r2(num(db && db.totals && db.totals.net));
                }
                return 0;
            }
            var own = num(by[acct.id]);
            var p = primaryCashAccount();
            if (acct.kind === 'cash' && p && p.id === acct.id) own += num(by['']);
            return r2(own);
        } catch (e) { return 0; }
    }

    /* What the account is actually worth on a date, documents included. This
       is the figure every screen should quote. */
    function fullBalanceAsOf(account, asOf) {
        var a = (typeof account === 'string') ? byId(accounts(), account) : account;
        if (!a) return 0;
        var t = d10(asOf || todayLocal());
        return r2(balanceAsOf(a, t) + documentCashTo(a, t));
    }

    /* ──────────────────────────────────────────────────────────────────
       STATEMENT — the cash book / bank book / any account's own ledger.

       Opening balance, every movement in date order with a running balance,
       closing balance. For the till the Day Book's own rows are merged in,
       because most of what moves a pharmacy's drawer is sales and supplier
       payments, not anything typed on the Cash & Capital tab. A statement
       showing only the typed entries would foot to a number that appears
       nowhere else in the app.

       `foots` is carried on the result rather than assumed: opening plus
       everything in minus everything out must equal the closing balance
       computed independently. Same discipline as the P&L's checks.
    ────────────────────────────────────────────────────────────────── */
    function statement(accountId, opts) {
        opts = opts || {};
        var a = (typeof accountId === 'string') ? byId(accounts(), accountId) : accountId;
        if (!a) return null;

        var opened = d10(a.openingDate);
        var to = d10(opts.to || todayLocal());
        var from = d10(opts.from || opened || '2000-01-01');
        if (opened && from < opened) from = opened;          // nothing exists before it opened
        if (to < from) to = from;

        var rows = [];
        entries().forEach(function (e) {
            if (!e || e.accountId !== a.id) return;
            var d = d10(e.date);
            if (d < from || d > to) return;
            var amt = Math.abs(num(e.amount));
            rows.push({
                date: d,
                particulars: _movementLabel(a.kind, e.kind),
                note: e.note || '',
                inAmt: e.direction === -1 ? 0 : amt,
                outAmt: e.direction === -1 ? amt : 0,
                interest: Math.abs(num(e.interest)),
                source: 'manual',
                id: e.id, ref: e.ref || ''
            });
        });

        /* The documents, for whichever account they were ROUTED to — the Day
           Book already decides what counts as cash (a credit sale does not, a
           supplier payment does) and now also where it landed.

           This must use the same rule as documentCashTo() above, or the
           statement and the balance quoted beside it disagree and `foots`
           goes false. The till still collects everything unrouted. */
        var p = primaryCashAccount();
        var isTill = !!(p && p.id === a.id);
        var takesDocs = isTill || a.kind === 'bank' || a.kind === 'cash';
        var docRows = 0;
        if (takesDocs && window.mmDayBook && typeof mmDayBook.load === 'function') {
            try {
                var db = mmDayBook.load({ from: from, to: to });
                (db.rows || []).forEach(function (r) {
                    var c = num(r.cash);
                    if (!c) return;                          // not a cash movement
                    var dest = r.acct || '';
                    var mine = (dest === a.id) || (isTill && dest === '');
                    if (!mine) return;
                    docRows++;
                    rows.push({
                        date: d10(r.date),
                        particulars: r.kind || 'Entry',
                        note: r.note || '',
                        inAmt: c > 0 ? r2(c) : 0,
                        outAmt: c < 0 ? r2(-c) : 0,
                        interest: 0,
                        source: 'document',
                        id: '', ref: ''
                    });
                });
            } catch (e) { /* a missing Day Book must not empty the statement */ }
        }

        rows.sort(function (x, y) {
            if (x.date !== y.date) return x.date < y.date ? -1 : 1;
            /* Documents before manual entries on the same day: a shop records
               the day's takings before it moves money out of the drawer, and a
               stable order keeps the running balance reproducible. */
            return (x.source === y.source) ? 0 : (x.source === 'document' ? -1 : 1);
        });

        /* BALANCE BROUGHT FORWARD.

           balanceAsOf deliberately returns 0 for any date before the account
           exists, so asking it for "the day before the opening date" gives
           nothing — and a statement that starts on the day the account was
           opened would show no brought-forward figure, no row for the opening
           amount either, and would fail to foot by exactly that amount. When
           the statement starts at the beginning, the opening figure IS the
           balance brought forward. */
        var opening = (!opened || from > opened)
            ? fullBalanceAsOf(a, dayBefore(from))
            : r2(num(a.opening));
        var running = opening, totalIn = 0, totalOut = 0;
        rows.forEach(function (r) {
            running = r2(running + r.inAmt - r.outAmt);
            r.balance = running;
            totalIn += r.inAmt; totalOut += r.outAmt;
        });

        var closing = fullBalanceAsOf(a, to);
        /* An asset is written down by depreciation, which is not a movement
           and so never appears as a row. Its statement therefore cannot foot
           to the carrying value, and says so rather than appearing broken. */
        var dep = (a.kind === 'asset') ? r2(accumTo(a, to) - accumTo(a, dayBefore(from))) : 0;
        var expected = r2(running - dep);

        return {
            account: { id: a.id, kind: a.kind, name: a.name,
                       opening: num(a.opening), openingDate: opened },
            from: from, to: to,
            opening: r2(opening),
            rows: rows,
            totalIn: r2(totalIn), totalOut: r2(totalOut),
            depreciation: dep,
            closing: r2(closing),
            isTill: isTill,
            /* Whether THIS statement actually absorbed document rows. Since
               routing, that is no longer the same question as "is it the
               till" — a bank account taking the UPI takings has documents in
               it too, and the note explaining where those rows came from
               belongs on any account that has them. */
            hasDocs: docRows > 0,
            foots: Math.abs(expected - r2(closing)) < 0.02
        };
    }

    /* Human wording for a movement, per account kind. The stored `kind` is a
       key ('emi', 'drawing'); this is what a person reads on a printed page. */
    function _movementLabel(acctKind, moveKind) {
        var m = {
            deposit: 'Received', withdrawal: 'Paid out', transfer: 'Transfer',
            charge: 'Bank charges', takings: 'Takings',
            introduce: 'Capital introduced', drawing: 'Drawings',
            emi: 'EMI paid', repay: 'Repayment', borrow: 'Borrowed',
            purchase: 'Purchased', sale: 'Sold', improve: 'Improvement',
            paid: 'Paid', refunded: 'Refunded'
        };
        return m[moveKind] || (String(moveKind || 'Entry').charAt(0).toUpperCase() + String(moveKind || '').slice(1));
    }

    /* ──────────────────────────────────────────────────────────────────
       FIXED ASSET REGISTER — the schedule a CA asks for at year end.

       Per asset: cost, written-down value brought forward, anything added in
       the period, depreciation charged, and the value carried forward. Every
       figure comes from accumTo(), so the register and the P&L's depreciation
       line cannot differ — they are the same function.

       Each row foots on its own (b/f + additions − depreciation = c/f) and the
       failures are counted, so a broken row is named instead of quietly
       sitting in a total.
    ────────────────────────────────────────────────────────────────── */
    function assetSchedule(opts) {
        opts = opts || {};
        var to = d10(opts.to || todayLocal());
        var from = d10(opts.from || (fyEndOf(to).slice(0, 4) - 1) + '-04-01');
        var before = dayBefore(from);

        var out = { from: from, to: to, rows: [],
                    cost: 0, openingWdv: 0, additions: 0, depreciation: 0, closingWdv: 0,
                    failures: 0 };

        accounts().forEach(function (a) {
            if (!a || a.kind !== 'asset' || a.active === false) return;
            var bought = d10(a.openingDate);
            if (bought && bought > to) return;                 // not owned yet

            var costToDate = r2(num(a.opening) + movementsFor(a.id, to));
            var additions  = r2(movementsFor(a.id, to) - movementsFor(a.id, before));
            /* An asset bought DURING the period has no value brought forward —
               its cost is an addition, not an opening balance. */
            var openedInPeriod = bought >= from;
            var openingWdv = openedInPeriod ? 0 : r2(balanceAsOf(a, before));
            if (openedInPeriod) additions = r2(additions + num(a.opening));

            var dep = r2(accumTo(a, to) - accumTo(a, before));
            var closing = r2(balanceAsOf(a, to));
            var foots = Math.abs(r2(openingWdv + additions - dep) - closing) < 0.02;
            if (!foots) out.failures++;

            out.rows.push({
                id: a.id, name: a.name,
                method: String((a.meta && a.meta.method) || 'wdv').toUpperCase(),
                rate: num(a.meta && a.meta.rate),
                salvage: num(a.meta && a.meta.salvage),
                bought: bought, cost: costToDate,
                openingWdv: openingWdv, additions: additions,
                depreciation: dep, closingWdv: closing,
                foots: foots
            });
            out.cost += costToDate; out.openingWdv += openingWdv;
            out.additions += additions; out.depreciation += dep; out.closingWdv += closing;
        });

        ['cost', 'openingWdv', 'additions', 'depreciation', 'closingWdv']
            .forEach(function (k) { out[k] = r2(out[k]); });
        out.rows.sort(function (x, y) { return y.closingWdv - x.closingWdv; });
        out.foots = Math.abs(r2(out.openingWdv + out.additions - out.depreciation) - out.closingWdv) < 0.02;
        return out;
    }

    /* ──────────────────────────────────────────────────────────────────
       LOAN SCHEDULE — what was owed, what was paid, what it cost.

       The split matters and is the whole reason this table exists: interest
       is a cost of the period and principal is not. A shop looking only at
       total EMIs paid cannot tell how much of the year's money actually went
       on borrowing.
    ────────────────────────────────────────────────────────────────── */
    function loanSchedule(opts) {
        opts = opts || {};
        var to = d10(opts.to || todayLocal());
        var from = d10(opts.from || (fyEndOf(to).slice(0, 4) - 1) + '-04-01');
        var before = dayBefore(from);

        var out = { from: from, to: to, rows: [],
                    opening: 0, borrowed: 0, repaid: 0, interest: 0, closing: 0, failures: 0 };

        accounts().forEach(function (a) {
            if (!a || a.kind !== 'loan' || a.active === false) return;
            var started = d10(a.openingDate);
            if (started && started > to) return;

            var startedInPeriod = started >= from;
            var opening = startedInPeriod ? 0 : r2(balanceAsOf(a, before));
            var borrowed = 0, repaid = 0, interest = 0;
            entries().forEach(function (e) {
                if (!e || e.accountId !== a.id) return;
                var d = d10(e.date);
                if (d < from || d > to) return;
                var amt = Math.abs(num(e.amount));
                if (e.direction === -1) repaid += amt; else borrowed += amt;
                interest += Math.abs(num(e.interest));
            });
            if (startedInPeriod) borrowed = r2(borrowed + num(a.opening));

            var closing = r2(balanceAsOf(a, to));
            var foots = Math.abs(r2(opening + borrowed - repaid) - closing) < 0.02;
            if (!foots) out.failures++;

            out.rows.push({
                id: a.id, name: a.name,
                lender: (a.meta && a.meta.lender) || '',
                emi: num(a.meta && a.meta.emi),
                opening: opening, borrowed: r2(borrowed), repaid: r2(repaid),
                interest: r2(interest), closing: closing, foots: foots
            });
            out.opening += opening; out.borrowed += borrowed;
            out.repaid += repaid; out.interest += interest; out.closing += closing;
        });

        ['opening', 'borrowed', 'repaid', 'interest', 'closing']
            .forEach(function (k) { out[k] = r2(out[k]); });
        out.rows.sort(function (x, y) { return y.closing - x.closing; });
        out.foots = Math.abs(r2(out.opening + out.borrowed - out.repaid) - out.closing) < 0.02;
        return out;
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

        var primaryCash = primaryCashAccount();
        all.forEach(function (a) {
            /* fullBalanceAsOf, so the figure on a card matches the figure on
               that account's own statement. balanceAsOf alone would leave the
               till short by everything the Day Book knows about. */
            var bal = fullBalanceAsOf(a, asOf);
            out.accounts.push({ id: a.id, kind: a.kind, name: a.name, balance: bal,
                                opening: num(a.opening), openingDate: d10(a.openingDate) });
            if (a.kind === 'cash') {
                out.cash += bal;
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

        /* RULE 2 lives in documentCashTo() now, and fullBalanceAsOf above has
           already applied it. All that is left here is to REPORT how much of
           the till came from documents, so the screen can explain itself. */
        if (primaryCash) {
            out.cashFromDocuments = documentCashTo(primaryCash, asOf);
            out.cashSource = (window.mmDayBook && typeof mmDayBook.load === 'function')
                ? 'till float + sales and payments since ' + (d10(primaryCash.openingDate) || '2000-01-01')
                : 'manual entries only';
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
        /* The one every SCREEN should call — includes the documents that move
           the till. balanceAsOf is the raw one and is kept public only because
           the schedules need the movement-only figure. */
        fullBalanceAsOf: fullBalanceAsOf,
        primaryCashAccount: primaryCashAccount,
        statement: statement,
        assetSchedule: assetSchedule,
        loanSchedule: loanSchedule,
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
