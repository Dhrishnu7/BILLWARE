/* ══════════════════════════════════════════════════════════════════════
   ocr-numbers.js  —  put back the decimal points the scan dropped
   ══════════════════════════════════════════════════════════════════════
   A decimal point is one or two pixels. It is the first thing a phone
   photo loses and the last thing an adaptive threshold keeps, so a real
   scan of a real invoice reads 198.75 as 19875 and 151.91 as 15991. Those
   go straight into a purchase at a hundred times the true price, and
   nothing downstream complains: the stock is right, the maths is
   self-consistent, and the error only surfaces as an impossible input
   credit or a margin that makes no sense.

   The fix is not better thresholding. It is that an invoice line carries
   its own proof: AMOUNT = QTY x RATE. Two of those three are read far more
   reliably than the third — quantity is a short integer, and the amount is
   the longest number on the line and the one printed largest. So the rate
   can be checked, and when it disagrees, recovered.

   Verified against a real supplier invoice (Shreeji Medical Agencies,
   26/07/2026) where every line satisfied amount = qty x rate exactly.

   Two rules the callers depend on:

   1. NOTHING IS SILENTLY CHANGED. Every repair is reported, so the shop is
      told which cells the software rewrote and can look at those first.
   2. A REPAIR MUST BE JUSTIFIED BY ANOTHER FIGURE, never by what looks
      like a sensible price. There is no such thing as an implausible price
      for a medicine, and guessing one is how you turn a scanning error
      into a confident wrong answer.

   ES5, so the headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
        return isFinite(n) ? n : NaN;
    }
    function hasPoint(v) { return /\d\.\d/.test(String(v == null ? '' : v)); }
    function r2(n) { return Math.round(n * 100) / 100; }

    /* Where a decimal point could have been lost. Indian invoices print two
       decimal places, so /100 is the usual answer, but a point misread as a
       digit gives /10 and some suppliers print three. The original is kept
       first so an already-correct integer wins ties. */
    function variants(v) {
        var t = String(v == null ? '' : v).trim();
        if (!/^\d+$/.test(t)) return null;          // has a point already, or is not a number
        var n = Number(t);
        if (!isFinite(n) || n <= 0) return null;
        return [n, n / 10, n / 100, n / 1000];
    }

    function closest(list, target) {
        var best = null, bestD = Infinity;
        for (var i = 0; i < list.length; i++) {
            var d = Math.abs(list[i] - target);
            if (d < bestD) { bestD = d; best = list[i]; }
        }
        return { value: best, delta: bestD };
    }

    /* ──────────────────────────────────────────────────────────────────
       repairLine({ qty, rate, mrp, amount })
       All inputs are the raw OCR strings. Returns the same fields plus
       `fixes`, a list of { field, from, to, why } — never an empty
       silence.
    ────────────────────────────────────────────────────────────────── */
    function repairLine(cell) {
        cell = cell || {};
        var out = {
            qty: cell.qty, rate: cell.rate, mrp: cell.mrp, amount: cell.amount,
            fixes: [], derivedRate: false
        };

        var q    = num(cell.qty);
        var amt  = num(cell.amount);
        var rate = num(cell.rate);
        var mrp  = num(cell.mrp);

        /* ── Rate, checked against amount ÷ qty ─────────────────────── */
        var derived = (isFinite(q) && q > 0 && isFinite(amt) && amt > 0) ? amt / q : NaN;

        if (isFinite(derived)) {
            var cands = variants(cell.rate) || (isFinite(rate) ? [rate] : []);
            if (cands.length) {
                var c = closest(cands, derived);
                /* Within a whisker of amount÷qty: the two figures confirm each
                   other, so take the variant that agrees. */
                if (c.delta <= Math.max(0.02, derived * 0.02)) {
                    if (c.value !== rate) {
                        out.fixes.push({ field: 'rate', from: String(cell.rate), to: String(r2(c.value)),
                                         why: 'decimal point restored — matches amount ÷ qty' });
                    }
                    out.rate = String(r2(c.value));
                } else if (!hasPoint(cell.rate)) {
                    /* Nothing the scan offered agrees with the arithmetic, and
                       the rate came through with NO decimal point — which is
                       the very symptom being corrected. The amount is the
                       biggest, boldest number on the line and the quantity is a
                       short integer; the rate is the crowded one. Trust the
                       two, replace the one, and SAY SO. */
                    out.rate = String(r2(derived));
                    out.derivedRate = true;
                    out.fixes.push({ field: 'rate', from: String(cell.rate), to: String(r2(derived)),
                                     why: 'did not match amount ÷ qty — recalculated from them' });
                } else {
                    /* The rate was read WITH a decimal point and still does not
                       match. That is not the lost-point symptom, so the cause is
                       unknown: the amount may cover free goods, the line may
                       carry a discount, or the quantity may be the misread one.
                       Overwriting a legibly printed price on a guess is exactly
                       the confident-wrong-answer this module exists to avoid.
                       Keep what was printed and raise it for a human. */
                    out.mismatch = { rate: rate, derived: r2(derived) };
                    out.fixes.push({ field: 'rate', from: String(cell.rate), to: String(cell.rate),
                                     why: 'kept as printed, but amount ÷ qty gives ' + r2(derived) + ' — check this line' });
                }
            } else {
                out.rate = String(r2(derived));
                out.derivedRate = true;
                out.fixes.push({ field: 'rate', from: '(blank)', to: String(r2(derived)),
                                 why: 'filled in from amount ÷ qty' });
            }
        } else if (variants(cell.rate) && isFinite(mrp) && hasPoint(cell.mrp)) {
            /* No amount column. A rate is never above the printed MRP, so the
               largest variant that stays at or below it is the only one that
               can be right. Weaker evidence, but still evidence. */
            var rv = variants(cell.rate).filter(function (v) { return v <= mrp * 1.001; });
            if (rv.length) {
                var pick = Math.max.apply(null, rv);
                if (pick !== rate) {
                    out.fixes.push({ field: 'rate', from: String(cell.rate), to: String(r2(pick)),
                                     why: 'decimal point restored — a rate cannot exceed the MRP' });
                }
                out.rate = String(r2(pick));
            }
        }

        /* ── MRP, checked against the repaired rate ─────────────────── */
        var rateFinal = num(out.rate);
        var mv = variants(cell.mrp);
        if (mv && isFinite(rateFinal) && rateFinal > 0) {
            /* Stock is never bought above MRP, so the true MRP is at or above
               the rate. The SMALLEST variant that clears it is the answer: a
               larger one would need the point to be even further left, which
               the scan gives no reason to believe. */
            var ok = mv.filter(function (v) { return v >= rateFinal * 0.999 && v <= rateFinal * 50; });
            if (ok.length) {
                var pickM = Math.min.apply(null, ok);
                if (pickM !== mrp) {
                    out.fixes.push({ field: 'mrp', from: String(cell.mrp), to: String(r2(pickM)),
                                     why: 'decimal point restored — MRP is at or above the rate' });
                }
                out.mrp = String(r2(pickM));
            }
        }

        /* ── Quantity, recovered from amount ÷ rate ──────────────────────
           The same identity read the third way. On a real invoice the QTY
           header came through as "ary", so the column was never located and
           EVERY row lost its quantity — the one field a purchase cannot be
           saved without.

           Only ever fills a BLANK. A quantity that was read is never
           overruled: it is the shortest, cleanest number on the line and
           far more likely right than a division involving two others. */
        var qtyFinal = num(out.qty);
        if ((!isFinite(qtyFinal) || qtyFinal <= 0) && isFinite(amt) && amt > 0) {
            var rf = num(out.rate);
            if (isFinite(rf) && rf > 0) {
                var qd = amt / rf;
                var qr = Math.round(qd);
                /* It must land on a whole number: stock comes in units, and a
                   division that does not is a sign one of the two inputs was
                   misread — in which case inventing a quantity from them would
                   only bury the error deeper.

                   The tolerance is nearly absolute. A percentage is the wrong
                   shape here: at 1% a quantity of 100 would accept anything
                   from 99 to 101, and a quantity is an exact count, not a
                   measurement. The small relative term only covers the rate
                   being printed to two decimals, which drifts the division by
                   about 0.02 on a line of 100. */
                var tol = Math.max(0.05, qd * 0.001);
                if (qr >= 1 && qr <= 100000 && Math.abs(qd - qr) <= tol) {
                    out.qty = String(qr);
                    out.derivedQty = true;
                    out.fixes.push({ field: 'qty', from: (cell.qty ? String(cell.qty) : '(blank)'),
                                     to: String(qr), why: 'filled in from amount ÷ rate' });
                }
            }
        }

        return out;
    }

    /* Convenience for a whole table. Rows are the parser's own shape:
       [name, batch, expiry, qty, mrp, rate, gst, pack, amount] */
    function repairRows(rows) {
        var fixed = 0, touched = 0, notes = [];
        (rows || []).forEach(function (row) {
            var res = repairLine({ qty: row[3], mrp: row[4], rate: row[5], amount: row[8] });
            if (res.fixes.length) {
                touched++;
                fixed += res.fixes.length;
                res.fixes.forEach(function (f) {
                    if (notes.length < 12) {
                        notes.push((row[0] || 'row') + ': ' + f.field + ' ' + f.from + ' → ' + f.to);
                    }
                });
            }
            row[3] = res.qty;
            row[4] = res.mrp;
            row[5] = res.rate;
        });
        return { cellsFixed: fixed, rowsTouched: touched, notes: notes };
    }

    window.mmOcrNumbers = {
        repairLine: repairLine,
        repairRows: repairRows,
        variants: variants
    };
})();
