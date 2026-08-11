/* ═══════════════════════════════════════════════════════════════════════
   BANK RECONCILIATION — pairing a statement against the books.

   Two people wrote down the same money: the shop, and the bank. This pairs
   what agrees and isolates what does not, so the shop reads four odd lines
   instead of four hundred ordinary ones.

   MATCHED ON AMOUNT AND DATE, NEVER ON WORDING. The bank writes
   "NEFT DR-HDFC0001234-SUN PHARMA MUMBAI" where the shop wrote "Sun Pharma";
   text matching would be confidently wrong, which is worse than leaving a
   line for a human. Amount is exact to the paisa; the date is allowed to
   drift, because money is slow — a cheque written on Monday leaves the bank
   on Thursday, and that is normal rather than an error.

   NOTHING HERE CHANGES A BOOK. It reports. An app that quietly restates the
   accounts to agree with a file someone just uploaded is an app whose
   numbers mean nothing.

   ES5, matching the other engines.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function num(n) { return Number(n) || 0; }
    function r2(n)  { return Math.round(num(n) * 100) / 100; }
    function d10(s) { return String(s == null ? '' : s).slice(0, 10); }

    /* Whole days between two YYYY-MM-DD strings. Built from date PARTS via
       Date.UTC, never `new Date(str)` — a bare date string is parsed as UTC
       midnight and reads as the previous day in IST, which is the bug that
       put every bill at 5:30 am. */
    function dayGap(a, b) {
        var x = String(a || '').split('-'), y = String(b || '').split('-');
        if (x.length !== 3 || y.length !== 3) return 9999;
        var ax = Date.UTC(+x[0], +x[1] - 1, +x[2]);
        var by = Date.UTC(+y[0], +y[1] - 1, +y[2]);
        if (isNaN(ax) || isNaN(by)) return 9999;
        return Math.round(Math.abs(ax - by) / 86400000);
    }

    /* A cent-safe key. 12500 and 12500.004 must not share a bucket, and
       floating point must not split 0.1+0.2 away from 0.3. */
    function amtKey(n) { return String(Math.round(num(n) * 100)); }

    /* ──────────────────────────────────────────────────────────────────
       reconcile({ statement, book, window })

       statement : [{ date, amount, desc, balance }]  from mmBankImport
       book      : [{ date, amount, label, id }]      amount SIGNED, in = +
       window    : days of drift allowed (default 5)

       → { matched, bankOnly, bookOnly, summary }
    ────────────────────────────────────────────────────────────────── */
    function reconcile(opts) {
        opts = opts || {};
        var stmt = (opts.statement || []).map(function (l, i) {
            return { i: i, date: d10(l.date), amount: r2(l.amount), desc: l.desc || '',
                     balance: (l.balance == null ? null : num(l.balance)), used: false, src: l };
        });
        var book = (opts.book || []).map(function (e, i) {
            return { i: i, date: d10(e.date), amount: r2(e.amount), label: e.label || '',
                     id: e.id || '', used: false, src: e };
        });
        var win = (opts.window == null) ? 5 : Math.max(0, opts.window);

        // Bucket the book by amount so each statement line looks at a handful
        // of candidates rather than the whole ledger.
        var buckets = {};
        book.forEach(function (e) {
            var k = amtKey(e.amount);
            (buckets[k] || (buckets[k] = [])).push(e);
        });

        var matched = [];

        /* TWO PASSES, and the order matters.

           Pass 1 takes only same-day pairs. Without it, two ₹500 payments a
           week apart could cross-match: the earlier statement line would grab
           the later book row simply because it was first in the list, and
           both pairs would then look like they drifted. Settling the certain
           pairs first leaves the genuinely ambiguous ones to pass 2. */
        function pass(maxGap) {
            stmt.forEach(function (s) {
                if (s.used) return;
                var cands = buckets[amtKey(s.amount)];
                if (!cands || !cands.length) return;
                var best = null, bestGap = 1e9;
                for (var j = 0; j < cands.length; j++) {
                    var e = cands[j];
                    if (e.used) continue;
                    var g = dayGap(s.date, e.date);
                    if (g > maxGap) continue;
                    // Ties break toward the EARLIER book row: the shop records
                    // a payment when it makes it, so the bank's copy comes
                    // after, not before.
                    if (g < bestGap || (g === bestGap && best && e.date < best.date)) { best = e; bestGap = g; }
                }
                if (best) {
                    s.used = true; best.used = true;
                    matched.push({ line: s.src, entry: best.src, dayGap: bestGap,
                                   amount: s.amount, date: s.date });
                }
            });
        }
        pass(0);
        if (win > 0) pass(win);

        var bankOnly = stmt.filter(function (s) { return !s.used; })
                           .map(function (s) { return s.src; });
        var bookOnly = book.filter(function (e) { return !e.used; })
                           .map(function (e) { return e.src; });

        var sum = function (list) {
            return r2((list || []).reduce(function (t, x) { return t + num(x.amount); }, 0));
        };
        var bankOnlyTotal = sum(bankOnly), bookOnlyTotal = sum(bookOnly);

        /* THE IDENTITY THIS REPORT LIVES OR DIES BY.

              books = statement + (in books, not yet at the bank)
                                − (at the bank, not yet in the books)

           A payment recorded but not yet cleared has already reduced the
           books and not the statement; a bank charge nobody entered has
           reduced the statement and not the books. If this does not hold, the
           pairing is wrong or the statement was read wrong, and the whole
           report is worthless — so it is computed and reported rather than
           assumed, the same discipline as the P&L's cross-checks. */
        var statementClosing = null;
        for (var k = stmt.length - 1; k >= 0; k--) {
            if (stmt[k].balance !== null) { statementClosing = r2(stmt[k].balance); break; }
        }
        var expectedBook = (statementClosing === null) ? null
                         : r2(statementClosing + bookOnlyTotal - bankOnlyTotal);

        var bookBalance = (opts.bookBalance == null) ? null : r2(opts.bookBalance);
        var difference  = (expectedBook === null || bookBalance === null) ? null
                        : r2(bookBalance - expectedBook);

        return {
            matched: matched,
            bankOnly: bankOnly,
            bookOnly: bookOnly,
            summary: {
                statementLines: stmt.length,
                bookEntries: book.length,
                matchedCount: matched.length,
                exactDateCount: matched.filter(function (m) { return m.dayGap === 0; }).length,
                bankOnlyCount: bankOnly.length, bookOnlyCount: bookOnly.length,
                bankOnlyTotal: bankOnlyTotal, bookOnlyTotal: bookOnlyTotal,
                statementClosing: statementClosing,
                expectedBook: expectedBook,
                bookBalance: bookBalance,
                difference: difference,
                /* Everything is explained when the books land exactly where
                   the statement plus the unexplained items say they should. */
                reconciles: (difference !== null) && Math.abs(difference) < 0.02,
                window: win
            }
        };
    }

    /* Turn mmFinance.statement() rows into the shape reconcile() wants.
       Kept here rather than in finance.js so the reconciler owns its own
       input contract, and one signing rule exists in one place: money INTO
       the account is positive, out is negative — the same convention as the
       Day Book's `cash` and the bank importer's `amount`. */
    function fromFinanceStatement(st) {
        if (!st || !st.rows) return [];
        var out = [];
        st.rows.forEach(function (r) {
            var amt = r2(num(r.inAmt) - num(r.outAmt));
            if (!amt) return;
            out.push({
                date: d10(r.date),
                amount: amt,
                label: (r.particulars || 'Entry') + (r.note ? ' · ' + r.note : ''),
                id: r.id || '',
                source: r.source || ''
            });
        });
        return out;
    }

    window.mmBankMatch = {
        reconcile: reconcile,
        fromFinanceStatement: fromFinanceStatement,
        dayGap: dayGap
    };
})();
