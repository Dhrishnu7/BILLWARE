/* ══════════════════════════════════════════════════════════════════════
   ocr-columns.js  —  let the DATA correct the column boundaries
   ══════════════════════════════════════════════════════════════════════
   Columns are found by reading the header row and slicing the page at the
   midpoints between the headings. That fails in a way the parser cannot
   notice: if one heading does not scan, its column simply ceases to exist
   and its figures are swept into the neighbour.

   Measured on a real invoice. The heading "QTY" scanned as "arty", matched
   nothing, and so no quantity column was created. The slice then ran
   straight from EXP to FREE — x 774 to 915 — and both of these landed in
   one cell:

       quantity values   x ≈ 788-796   100, 30, 50, 40, 80, 50, 30, 80
       free values       x ≈ 877-882   10, 5, 6, 3, 8, 2
                         gap: 806 → 857

   The shop saw a free quantity of "10010" against 100 bought.

   The figures themselves say where the boundary belongs. Two tight
   clusters with a wide gap between them are two columns, whatever the
   heading did or did not say. A header can be unreadable; fifty numbers
   sitting in two straight lines cannot.

   This only ever SPLITS a column that the header row already found, and
   only on strong evidence. It never merges, never moves an existing
   boundary, and when the evidence is weak it does nothing — so it cannot
   do worse than the header-only layout it refines.

   ES5, so the fixture harness can drive it headlessly.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function mid(w) { return (w.bbox.x0 + w.bbox.x1) / 2; }

    function median(a) {
        if (!a.length) return 0;
        var s = a.slice().sort(function (x, y) { return x - y; });
        return s[Math.floor(s.length / 2)];
    }

    /* Deliberately strict. A split invents a column boundary out of
       geometry, and a wrong one silently moves figures between fields —
       so every one of these has to hold. */
    var MIN_WORDS_EACH = 3;    // a cluster of one or two is noise
    var MIN_GAP_PX     = 20;   // absolute floor, for a tiny scan
    var GAP_VS_INNER   = 2.5;  // the gap must dwarf the spacing inside a cluster

    /* rows: [{ words: [{ text, bbox }] }] — the DATA rows only, never the
       header. cols: [{ type, left, right }] as built from the header. */
    function refine(cols, rows, opts) {
        opts = opts || {};
        var out = [], notes = [];
        var haveType = {};
        cols.forEach(function (c) { haveType[c.type] = true; });

        cols.forEach(function (col) {
            var centres = [];
            rows.forEach(function (r) {
                (r.words || []).forEach(function (w) {
                    var m = mid(w);
                    if (m >= col.left && m < col.right) centres.push(m);
                });
            });

            if (col.type === 'name' || centres.length < MIN_WORDS_EACH * 2) {
                /* The product name is words with spaces between them; every gap
                   in it looks like a column boundary. Never split it. */
                out.push(col);
                return;
            }

            centres.sort(function (a, b) { return a - b; });
            var gaps = [], i;
            for (i = 1; i < centres.length; i++) gaps.push(centres[i] - centres[i - 1]);

            var biggest = 0, at = -1;
            for (i = 0; i < gaps.length; i++) {
                if (gaps[i] > biggest) { biggest = gaps[i]; at = i; }
            }
            /* Compare the biggest gap with the TYPICAL gap, excluding itself:
               inside a column the figures are stacked, so consecutive centres
               are a pixel or two apart and the median gap is near zero. */
            var inner = median(gaps.filter(function (g, k) { return k !== at; }));
            var leftCount  = at + 1;
            var rightCount = centres.length - leftCount;

            var strong = at >= 0
                      && biggest >= MIN_GAP_PX
                      && biggest >= Math.max(inner * GAP_VS_INNER, MIN_GAP_PX)
                      && leftCount  >= MIN_WORDS_EACH
                      && rightCount >= MIN_WORDS_EACH;

            if (!strong) { out.push(col); return; }

            var cut = (centres[at] + centres[at + 1]) / 2;

            /* The half the heading sits over keeps the heading's meaning. The
               other half is a column whose heading did not scan. */
            var hx = (opts.headerMid && opts.headerMid[col.type]);
            var headerLeft = (typeof hx === 'number') ? (hx < cut) : false;

            /* What the orphan is, by position and by what is missing. On a
               pharmacy invoice the order is QTY then FREE, so an orphan to the
               left of FREE is the quantity. Named only when that field is
               genuinely absent — never stolen from a column already found. */
            var orphanType = null;
            if (col.type === 'free' && !headerLeft && !haveType['qty']) orphanType = 'qty';
            else if (col.type === 'qty' && headerLeft && !haveType['free']) orphanType = 'free';

            /* No name for the orphan, no split. Measured on the real invoice,
               the gap test ALSO fired on pack, mrp and amount — right-aligned
               figures leave a gap beside a left-aligned heading, and the desk
               behind the sheet reads as a column of its own. Splitting those
               would have marked half of each as "skip", quietly dropping MRP
               values that were read perfectly well.

               So the rule is: only ever split when both halves can be named.
               Either this recovers a column the header lost, or it does
               nothing — it can never turn read data into discarded data. */
            if (!orphanType) { out.push(col); return; }

            var a = { type: headerLeft ? col.type : orphanType, left: col.left,  right: cut };
            var b = { type: headerLeft ? orphanType : col.type, left: cut,       right: col.right };
            out.push(a, b);
            haveType[a.type] = haveType[b.type] = true;
            notes.push('split "' + col.type + '" at x=' + Math.round(cut) +
                       ' (gap ' + Math.round(biggest) + 'px vs ' + Math.round(inner) +
                       ' inside) → ' + a.type + ' | ' + b.type);
        });

        return { columns: out, notes: notes, changed: notes.length > 0 };
    }

    window.mmOcrColumns = { refine: refine };
})();
