/* ══════════════════════════════════════════════════════════════════════
   ocr-rows.js  —  group words into lines using the size of the text
   ══════════════════════════════════════════════════════════════════════
   Everything downstream — the column slicer, the name matcher, the
   amount = qty × rate check — assumes a "row" is one printed line of the
   invoice. Rows were formed by walking the words in reading order and
   putting each one into the first row whose centre was within TWELVE
   PIXELS vertically.

   Twelve pixels of what? A 300-dpi scan prints its body text about 28px
   tall with 45px between lines; a phone photo of the same invoice may run
   14px tall with 22px between lines. The one tolerance cannot be right for
   both, and on the small end it is larger than the gap between two
   different lines — so the product line and the manufacturer line printed
   beneath it are merged into a single row.

   That is where "mb 500" came from: AZITHRAL 500 with half of "Alembic"
   sitting on top of it, in one cell. v275 and v276 both tried to fix that
   by trimming the name cell afterwards and both made it worse — five names
   came back empty — because by then the damage is done and the row's
   geometry is already a blend of two lines. v277 reverted them with the
   note that the fix belongs in how rows are FORMED. This is that fix.

   Two changes, both measured off the words themselves:

   1. THE TOLERANCE COMES FROM THE TEXT. Half the median word height:
      close enough to catch a line that sags a little, small enough that
      the next line down is a different row. Falls back to the old 12 when
      the heights are unusable.

   2. THE ANCHOR DOES NOT DRIFT. The old code reset a row's centre to the
      MEAN of every word in it after each addition. On a line of ten words
      that mean creeps, so by the last word the band has slid off the line
      it started on — a slow leak that lets in a word from the row below
      and pushes out one of its own. The anchor is now the median of the
      row's word centres, which a couple of outliers cannot move.

   It only decides which words share a line. It never edits, drops or
   reorders a word, so the worst it can do is group as badly as before.

   ES5, so the headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function midY(w) { return (w.bbox.y0 + w.bbox.y1) / 2; }
    function heightOf(w) { return Math.abs(w.bbox.y1 - w.bbox.y0); }

    function median(a) {
        if (!a.length) return 0;
        var s = a.slice().sort(function (x, y) { return x - y; });
        var m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    var FALLBACK_TOL = 12;   // what it was before anything was measured
    var TOL_FRACTION = 0.5;  // of the median word height
    var TOL_MIN      = 4;
    var TOL_MAX      = 26;

    /* The height of a word is the height of its tallest glyph, so a cell
       holding only "50" measures shorter than one holding "AZITHRAL". The
       median over the whole page is what a line of body text is worth, and
       the outliers — a big heading, a lone comma — cannot move it. */
    function toleranceFor(words) {
        var hs = [], i, h;
        for (i = 0; i < words.length; i++) {
            h = heightOf(words[i]);
            if (h > 0 && h < 400) hs.push(h);
        }
        if (hs.length < 5) return { tol: FALLBACK_TOL, height: 0, measured: false };
        var med = median(hs);
        if (!(med > 0)) return { tol: FALLBACK_TOL, height: 0, measured: false };
        var tol = med * TOL_FRACTION;
        if (tol < TOL_MIN) tol = TOL_MIN;
        if (tol > TOL_MAX) tol = TOL_MAX;
        return { tol: tol, height: med, measured: true };
    }

    /* group(words) -> { rows, tol, height, measured }
       rows: [{ midY, words }] top to bottom, each row's words left to right.
       Same shape the parser already builds, so it is a drop-in. */
    function group(words, opts) {
        opts = opts || {};
        words = words || [];
        var t = (typeof opts.tol === 'number')
              ? { tol: opts.tol, height: 0, measured: false }
              : toleranceFor(words);

        var rows = [], i, j, w, y, placed, row;

        for (i = 0; i < words.length; i++) {
            w = words[i];
            y = midY(w);
            placed = false;
            for (j = 0; j < rows.length; j++) {
                if (Math.abs(rows[j].midY - y) <= t.tol) {
                    rows[j].words.push(w);
                    rows[j]._ys.push(y);
                    /* Median, not mean — see the header. */
                    rows[j].midY = median(rows[j]._ys);
                    placed = true;
                    break;
                }
            }
            if (!placed) rows.push({ midY: y, words: [w], _ys: [y] });
        }

        rows.sort(function (a, b) { return a.midY - b.midY; });
        for (i = 0; i < rows.length; i++) {
            rows[i].words.sort(function (a, b) { return a.bbox.x0 - b.bbox.x0; });
            delete rows[i]._ys;
        }

        return { rows: rows, tol: t.tol, height: t.height, measured: t.measured };
    }

    window.mmOcrRows = {
        group: group,
        toleranceFor: toleranceFor
    };
})();
