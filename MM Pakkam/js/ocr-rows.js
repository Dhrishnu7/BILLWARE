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
    var TOL_FRACTION = 0.25; // of the distance between printed lines
    var TOL_MIN      = 6;
    var TOL_MAX      = 40;
    var PROBE_WORDS  = 4;    // words that make a cluster a real data line

    /* MEASURE THE GAP BETWEEN LINES, NOT THE SIZE OF THE LETTERS.
       v280 used half the median word height and got 6px on a real invoice
       whose printed lines are 51px apart. Every figure landed correctly and
       SEVEN OF TEN PRODUCT NAMES were cut loose from their own row, because
       a name's box is not centred on its line: measured on that scan, PAN
       sat 10px below the figures beside it and MEFTALS 11px. The letters
       are 12px tall and the line is 51px away — it is the 51 that says how
       far a word may stray before it belongs to something else.

       Two passes, because the line spacing cannot be known until the lines
       are found. The first pass is deliberately tight, so it splits rather
       than merges; a split page still shows the right spacing between what
       it did find, and only clusters with several words in them are counted
       — a product line carries ten figures, a speck of dust carries one. */
    function toleranceFor(words) {
        var hs = [], i, h;
        for (i = 0; i < words.length; i++) {
            h = heightOf(words[i]);
            if (h > 0 && h < 400) hs.push(h);
        }
        if (hs.length < 5) return { tol: FALLBACK_TOL, height: 0, pitch: 0, measured: false };
        var med = median(hs);
        if (!(med > 0)) return { tol: FALLBACK_TOL, height: 0, pitch: 0, measured: false };

        var probe = group(words, { tol: Math.max(TOL_MIN, med * 0.5), _noProbe: true }).rows;
        var centres = [];
        for (i = 0; i < probe.length; i++) {
            if (probe[i].words.length >= PROBE_WORDS) centres.push(probe[i].midY);
        }
        if (centres.length < 3) {
            /* Not enough of a table to measure. The word height is the only
               thing left, and the old constant is the safer of the two. */
            return { tol: Math.max(FALLBACK_TOL, med), height: med, pitch: 0, measured: false };
        }
        var gaps = [];
        for (i = 1; i < centres.length; i++) gaps.push(centres[i] - centres[i - 1]);
        var pitch = median(gaps);
        if (!(pitch > 0)) return { tol: Math.max(FALLBACK_TOL, med), height: med, pitch: 0, measured: false };

        var tol = pitch * TOL_FRACTION;
        if (tol < TOL_MIN) tol = TOL_MIN;
        if (tol > TOL_MAX) tol = TOL_MAX;
        /* Never so wide that two printed lines could land in one row. */
        if (tol > pitch * 0.45) tol = pitch * 0.45;
        return { tol: tol, height: med, pitch: pitch, measured: true };
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

        return { rows: rows, tol: t.tol, height: t.height, pitch: t.pitch, measured: t.measured };
    }

    /* ──────────────────────────────────────────────────────────────────
       trimEchoes(row, nameCol)
       ──────────────────────────────────────────────────────────────────
       A scan of a pharmacy invoice reads the product name twice. Measured
       on a real one:

           AZTHRAL  x144-220 y-mid 434 conf 21   <- the product
           mb       x156-192 y-mid 443 conf 56   <- the echo beneath it
           OMEZ     x146-191 y-mid 683 conf 81
           onez     x147-208 y-mid 702 conf  0
           CIFRAN   x146-203 y-mid 735 conf 92
           FRAN     x146-219 y-mid 752 conf 23

       Same ink, read twice, and the pair lands in one row because the
       second reading is barely 10px below the first — closer than a real
       name strays from its own line. No vertical tolerance can separate
       them, and neither confidence nor width picks the right one every
       time: AZTHRAL is the LESS confident of its pair, and OMEZ is the
       NARROWER of its pair.

       What does decide it is the line the row is built on. The figures —
       quantity, batch, rate, amount — only ever sit on the product line,
       so they are the anchor, and of two readings of the same ink the one
       nearer that anchor is the printed name. It picks AZTHRAL over mb,
       OMEZ over onez, CIFRAN over FRAN, and DOLO 650 over DOLO 88.

       This is what v275 and v276 were reaching for. They emptied five
       names because they trimmed by absolute distance, so a name that
       simply sat low lost every word it had. This only ever chooses
       between words that CONFLICT — that overlap horizontally, and so
       cannot both be part of one name — which means a cell with nothing
       to choose between is returned exactly as it came in, and the cell
       can never end up empty.
    ────────────────────────────────────────────────────────────────── */
    var OVERLAP_MIN = 0.5;   // of the narrower word, before they conflict
    var CLEARLY_NEARER = 3;  // px, so a coin toss changes nothing
    var CONF_MARGIN    = 25; // confidence points, only when the geometry ties

    function midX(w) { return (w.bbox.x0 + w.bbox.x1) / 2; }

    function trimEchoes(row, nameCol) {
        var words = (row && row.words) || [];
        if (!nameCol || words.length < 2) return { words: words, dropped: [] };

        var inName = [], outside = [], i, j, m;
        for (i = 0; i < words.length; i++) {
            m = midX(words[i]);
            if (m >= nameCol.left && m < nameCol.right) inName.push(words[i]);
            else outside.push(words[i]);
        }
        if (inName.length < 2) return { words: words, dropped: [] };

        /* The anchor is where the figures are. Without figures there is no
           line to measure against and nothing should be thrown away. */
        if (!outside.length) return { words: words, dropped: [] };
        var anchor = median(outside.map(midY));

        var drop = {}, dropped = [];
        for (i = 0; i < inName.length; i++) {
            for (j = i + 1; j < inName.length; j++) {
                var a = inName[i], b = inName[j];
                if (drop[i] || drop[j]) continue;
                /* LETTERS ARE NOISE, DIGITS ARE IDENTITY — the same rule the
                   name matcher runs on. Left to itself this chose "2" over
                   "20" on a real line, because the echo happened to sit
                   nearer the figures, and OMEZ 20 would have gone into stock
                   as OMEZ 2. A strength is never thrown away on geometry: if
                   either word carries a digit the pair is left alone and the
                   matcher raises it as a question instead. */
                if (/\d/.test(a.text) || /\d/.test(b.text)) continue;
                var ov = Math.min(a.bbox.x1, b.bbox.x1) - Math.max(a.bbox.x0, b.bbox.x0);
                if (ov <= 0) continue;
                var narrower = Math.min(a.bbox.x1 - a.bbox.x0, b.bbox.x1 - b.bbox.x0);
                if (narrower <= 0 || ov / narrower < OVERLAP_MIN) continue;

                var da = Math.abs(midY(a) - anchor), db = Math.abs(midY(b) - anchor);
                var loser = -1;
                if (Math.abs(da - db) >= CLEARLY_NEARER) {
                    loser = (da > db) ? i : j;
                } else {
                    /* The two readings are the same distance from the line, so
                       geometry has nothing to say. Measured: CIFRAN sat 7px off
                       and its echo FRAN 9.5px — under three pixels apart, yet
                       one was read at 92% and the other at 23%. When the scan
                       is that certain which of the two it read, take it. A wide
                       margin only, and only between two words already known to
                       be the same ink: this is a tie-break, not a ranking. */
                    var ca = a.confidence, cb = b.confidence;
                    if (typeof ca === 'number' && typeof cb === 'number' &&
                        Math.abs(ca - cb) >= CONF_MARGIN) {
                        loser = (ca < cb) ? i : j;
                    }
                }
                if (loser < 0) continue;
                drop[loser] = true;
                dropped.push(inName[loser].text);
            }
        }
        if (!dropped.length) return { words: words, dropped: [] };

        var keptName = [];
        for (i = 0; i < inName.length; i++) if (!drop[i]) keptName.push(inName[i]);
        if (!keptName.length) return { words: words, dropped: [] };   // never empty a cell

        var out = keptName.concat(outside);
        out.sort(function (p, q) { return p.bbox.x0 - q.bbox.x0; });
        return { words: out, dropped: dropped };
    }

    window.mmOcrRows = {
        group: group,
        toleranceFor: toleranceFor,
        trimEchoes: trimEchoes
    };
})();
