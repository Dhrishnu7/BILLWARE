/* ═══════════════════════════════════════════════════════════════════════
   BANK STATEMENT IMPORT — turning any bank's CSV into rows we can match.

   Every Indian bank exports a different shape. HDFC, SBI, ICICI, Axis and
   every co-operative bank disagree about column names, column order, date
   format, whether debits and credits are two columns or one signed one, and
   how many junk lines sit above the header. There is no format to hardcode,
   so nothing here is hardcoded to a bank: the file is INSPECTED, a mapping is
   proposed, and the shop confirms it.

   This file is deliberately pure — text in, rows out, no DOM and no storage.
   That is what lets the whole thing be tested without a browser, and it is
   the part most likely to meet a file shape I have never seen.

   ES5 on purpose, to match js/daybook.js and js/returns-data.js.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
    function low(s)  { return trim(s).toLowerCase(); }
    function r2(n)   { return Math.round((Number(n) || 0) * 100) / 100; }

    /* ──────────────────────────────────────────────────────────────────
       CSV — quote-aware. A description like "NEFT DR-HDFC0001234-SUN
       PHARMA, MUMBAI" contains a comma, and splitting on commas alone
       shifts every column after it by one, silently, for that row only.
    ────────────────────────────────────────────────────────────────── */
    function parseCsv(text) {
        var out = [], row = [], field = '', i = 0, inQ = false;
        var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
        function endField() { row.push(field); field = ''; }
        function endRow()   { endField(); out.push(row); row = []; }
        while (i < s.length) {
            var c = s.charAt(i);
            if (inQ) {
                if (c === '"') {
                    if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
                    inQ = false; i++; continue;
                }
                field += c; i++; continue;
            }
            if (c === '"') { inQ = true; i++; continue; }
            if (c === ',') { endField(); i++; continue; }
            if (c === '\t' && out.length === 0 && row.length === 0 && field === '') { i++; continue; }
            if (c === '\n') { endRow(); i++; continue; }
            field += c; i++;
        }
        if (field !== '' || row.length) endRow();
        // Drop entirely blank lines — statements are full of them.
        return out.filter(function (r) {
            return r.some(function (c) { return trim(c) !== ''; });
        });
    }

    /* ──────────────────────────────────────────────────────────────────
       AMOUNTS. Handles "1,234.56", "1234.56 Cr", "(1,234.56)" for negative,
       a bare "-", and the empty cell that means "this row is the other
       column". Returns null for "no value here", which is NOT the same as
       zero — a zero would make an empty debit cell look like a ₹0 debit.
    ────────────────────────────────────────────────────────────────── */
    function parseAmount(v) {
        var s = trim(v);
        if (!s || s === '-' || s === '—') return null;
        var neg = false;
        if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
        if (/\bdr\b|\bdebit\b/i.test(s)) neg = true;
        s = s.replace(/\b(cr|dr|credit|debit)\b/ig, '');
        s = s.replace(/[₹$\s,]/g, '');
        if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
        if (s === '' || !/^\d*\.?\d+$/.test(s)) return null;
        var n = parseFloat(s);
        if (isNaN(n)) return null;
        return neg ? -n : n;
    }

    var MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
                   jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

    /* One date cell → { y, m, d, ambiguous } or null.
       `ambiguous` is carried rather than resolved, because a single cell
       genuinely cannot tell 03/04 apart. The COLUMN decides — see
       detectDateOrder. Guessing per cell is how half a statement lands in
       the wrong month. */
    function parseDateParts(v) {
        var s = trim(v);
        if (!s) return null;
        s = s.split(' ')[0];                       // drop any time part
        var m;
        // YYYY-MM-DD / YYYY/MM/DD — unambiguous, year first
        m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
        if (m) return { y: +m[1], m: +m[2], d: +m[3], ambiguous: false };
        // DD-MMM-YY / DD MMM YYYY — unambiguous, month is named
        m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/);
        if (m) {
            var mm = MONTHS[low(m[2]).slice(0, 3)];
            if (!mm) return null;
            return { y: fullYear(+m[3]), m: mm, d: +m[1], ambiguous: false };
        }
        // dd/mm/yyyy or mm/dd/yyyy — the ambiguous one
        m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
        if (m) {
            var a = +m[1], b = +m[2], y = fullYear(+m[3]);
            if (a > 12 && b <= 12) return { y: y, m: b, d: a, ambiguous: false };
            if (b > 12 && a <= 12) return { y: y, m: a, d: b, ambiguous: false };
            if (a > 12 && b > 12) return null;
            return { y: y, m: b, d: a, ambiguous: true, alt: { y: y, m: a, d: b } };
        }
        return null;
    }

    function fullYear(y) { return y >= 100 ? y : (y >= 70 ? 1900 + y : 2000 + y); }

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function iso(p) { return p ? (p.y + '-' + pad(p.m) + '-' + pad(p.d)) : ''; }

    /* Decide DD/MM vs MM/DD for the WHOLE column, from evidence.
       If any single row has a first number above 12, the order is settled for
       every row — that one cell is proof. With no proof either way we return
       'dmy' (India) but say so, so the screen can tell the shop what it
       assumed instead of quietly being right or wrong. */
    function detectDateOrder(values) {
        var firstOver12 = false, secondOver12 = false, seen = 0;
        for (var i = 0; i < values.length; i++) {
            var s = trim(values[i]).split(' ')[0];
            var m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
            if (!m) continue;
            seen++;
            if (+m[1] > 12) firstOver12 = true;
            if (+m[2] > 12) secondOver12 = true;
        }
        if (firstOver12 && !secondOver12) return { order: 'dmy', proven: true, seen: seen };
        if (secondOver12 && !firstOver12) return { order: 'mdy', proven: true, seen: seen };
        return { order: 'dmy', proven: false, seen: seen };
    }

    function applyOrder(parts, order) {
        if (!parts) return null;
        if (!parts.ambiguous) return parts;
        return (order === 'mdy' && parts.alt) ? parts.alt : parts;
    }

    /* ──────────────────────────────────────────────────────────────────
       FINDING THE HEADER. Statements carry a preamble — account holder,
       address, period, blank lines — before the real header. The header is
       the first row that looks like column names AND is followed by a row
       that parses as data.
    ────────────────────────────────────────────────────────────────── */
    var HEAD_HINTS = {
        date:    [/^(txn|tran|transaction|value|book|post)?\s*[\-_ ]*date$/i, /^date$/i, /date/i],
        desc:    [/^(narration|description|particulars|remarks|details|transaction remarks)$/i, /narrat|descri|particul|remark|detail/i],
        debit:   [/^(debit|withdrawal|withdrawal amt\.?|dr|paid out|withdrawals)$/i, /debit|withdraw|paid out/i],
        credit:  [/^(credit|deposit|deposit amt\.?|cr|paid in|deposits)$/i, /credit|deposit|paid in/i],
        amount:  [/^(amount|amt|transaction amount)$/i, /amount/i],
        balance: [/^(balance|closing balance|running balance|bal)$/i, /balance/i]
    };

    function scoreHeader(cells) {
        var hits = 0;
        cells.forEach(function (c) {
            var t = low(c);
            if (!t) return;
            for (var k in HEAD_HINTS) {
                if (!HEAD_HINTS.hasOwnProperty(k)) continue;
                if (HEAD_HINTS[k][0].test(t)) { hits++; return; }
            }
        });
        return hits;
    }

    function findHeader(rows) {
        var best = -1, bestScore = 0;
        for (var i = 0; i < Math.min(rows.length, 40); i++) {
            var sc = scoreHeader(rows[i]);
            if (sc >= 2 && sc > bestScore) { bestScore = sc; best = i; }
        }
        return best;
    }

    /* Map header cells to roles. Exact patterns win over loose ones, so a
       "Closing Balance" column is not claimed by the /amount/ matcher. */
    function detectColumns(header) {
        var map = { date: -1, desc: -1, debit: -1, credit: -1, amount: -1, balance: -1 };
        var roles = ['date', 'desc', 'debit', 'credit', 'balance', 'amount'];
        for (var pass = 0; pass < 3; pass++) {
            roles.forEach(function (role) {
                if (map[role] >= 0) return;
                for (var c = 0; c < header.length; c++) {
                    if (usedBy(map, c)) continue;
                    var pat = HEAD_HINTS[role][pass];
                    if (pat && pat.test(low(header[c]))) { map[role] = c; return; }
                }
            });
        }
        return map;
    }

    function usedBy(map, col) {
        for (var k in map) { if (map.hasOwnProperty(k) && map[k] === col) return true; }
        return false;
    }

    /* ──────────────────────────────────────────────────────────────────
       parse(text, opts) → the whole job.

       Returns { lines, mapping, dateOrder, header, skipped, warnings }.
       A line is { date, desc, amount, balance, raw } where amount is SIGNED:
       money into the account is positive, out is negative — the same
       convention as the Day Book's `cash`, so the matcher never has to think
       about which way round a bank means "debit".
    ────────────────────────────────────────────────────────────────── */
    function parse(text, opts) {
        opts = opts || {};
        var rows = parseCsv(text);
        var warnings = [];
        if (!rows.length) return { lines: [], mapping: null, warnings: ['The file is empty.'], skipped: 0, header: [] };

        var hIdx = (opts.headerRow != null) ? opts.headerRow : findHeader(rows);
        if (hIdx < 0) {
            return { lines: [], mapping: null, header: [], skipped: rows.length,
                     warnings: ['Could not find a header row. Open the file and check it has column names like Date, Description, Debit, Credit.'] };
        }
        var header = rows[hIdx].map(trim);
        var mapping = opts.mapping || detectColumns(header);

        if (mapping.date < 0) warnings.push('No date column was recognised.');
        if (mapping.debit < 0 && mapping.credit < 0 && mapping.amount < 0)
            warnings.push('No amount column was recognised — expected Debit/Credit, or a single Amount.');

        var body = rows.slice(hIdx + 1);

        // The date order is decided from the whole column, not row by row.
        var dateOrder = opts.dateOrder
            ? { order: opts.dateOrder, proven: true, seen: 0 }
            : detectDateOrder(body.map(function (r) { return r[mapping.date]; }));

        var lines = [], skipped = 0;
        body.forEach(function (r) {
            var parts = applyOrder(parseDateParts(r[mapping.date]), dateOrder.order);
            var dIn  = mapping.debit  >= 0 ? parseAmount(r[mapping.debit])  : null;
            var cIn  = mapping.credit >= 0 ? parseAmount(r[mapping.credit]) : null;
            var aIn  = mapping.amount >= 0 ? parseAmount(r[mapping.amount]) : null;

            var amount = null;
            if (dIn !== null || cIn !== null) {
                /* Two columns. Both filled is a malformed row, not a net
                   movement — a statement never debits and credits one line. */
                if (dIn !== null && cIn !== null) { skipped++; return; }
                amount = (cIn !== null) ? Math.abs(cIn) : -Math.abs(dIn);
            } else if (aIn !== null) {
                amount = aIn;                    // already signed, or Dr/Cr tagged
            }

            // A row with no date or no money is a subtotal, a carried-forward
            // line or a footer. Counted, never guessed at.
            if (!parts || amount === null) { skipped++; return; }

            lines.push({
                date: iso(parts),
                desc: mapping.desc >= 0 ? trim(r[mapping.desc]) : '',
                amount: r2(amount),
                balance: mapping.balance >= 0 ? parseAmount(r[mapping.balance]) : null,
                raw: r
            });
        });

        if (!dateOrder.proven && dateOrder.seen > 0) {
            warnings.push('Dates like 03/04/2026 could be 3 April or 4 March. Read as DAY first (3 April) — the Indian format. Check one row against your bank before relying on this.');
        }
        if (lines.length && skipped > lines.length) {
            warnings.push('More rows were skipped (' + skipped + ') than read (' + lines.length + '). The column mapping is probably wrong.');
        }
        if (!lines.length) warnings.push('No usable rows were found.');

        return { lines: lines, mapping: mapping, dateOrder: dateOrder,
                 header: header, headerRow: hIdx, skipped: skipped, warnings: warnings };
    }

    /* Does the statement's own running balance agree with the movements?
       A bank statement is internally consistent by definition, so if this
       fails the file was read wrong — a column mis-mapped, or rows dropped.
       Cheap, and it catches a bad import before any of it is believed. */
    function checkRunning(lines) {
        var checked = 0, bad = 0, firstBad = null;
        for (var i = 1; i < lines.length; i++) {
            var prev = lines[i - 1].balance, cur = lines[i].balance;
            if (prev === null || cur === null) continue;
            checked++;
            if (Math.abs(r2(prev + lines[i].amount) - r2(cur)) > 0.02) {
                bad++;
                if (!firstBad) firstBad = lines[i];
            }
        }
        return { checked: checked, bad: bad, firstBad: firstBad, ok: checked > 0 && bad === 0 };
    }

    window.mmBankImport = {
        parse: parse,
        parseCsv: parseCsv,
        parseAmount: parseAmount,
        parseDateParts: parseDateParts,
        detectColumns: detectColumns,
        detectDateOrder: detectDateOrder,
        findHeader: findHeader,
        checkRunning: checkRunning
    };
})();
