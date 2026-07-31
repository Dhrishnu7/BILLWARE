/* ══════════════════════════════════════════════════════════════════════
   ocr-names.js  —  match a scanned product name to one the shop stocks
   ══════════════════════════════════════════════════════════════════════
   A real scan produced "[3 COMBIFLAM", "mb 500", "5 ::" and "DOLO 850".
   The shop's own purchase history already holds the right spellings, so
   the corpus to match against is free and specific to this pharmacy.

   THE RULE THAT MATTERS, and the reason this is not just a fuzzy match:

       LETTERS ARE NOISE. DIGITS ARE IDENTITY.

   "COMBIFLAM" misread as "COMBIFLAN" is the same medicine. "PAN 40" and
   "PAN 20" are DIFFERENT MEDICINES, and so are DOLO 650 and DOLO 500.
   A strength is not a spelling, and a matcher that treats them alike will
   eventually put a pantoprazole 20 into stock as a 40 and no one will
   notice until someone is dispensed the wrong dose.

   So: differences in LETTERS are corrected. Differences in DIGITS are
   never corrected — they are reported as a question for the shop, who can
   see the paper and knows whether they have started buying a new
   strength. "DOLO 850" stays "DOLO 850" and is flagged as possibly
   "DOLO 650"; it is not quietly rewritten.

   ES5, so the headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function str(s) { return String(s == null ? '' : s); }

    /* Strip what the scanner adds rather than what the printer wrote: the
       serial number that bleeds in from the left-hand column, bracket and
       pipe noise, and runs of punctuation. */
    /* "5OO" is not a strength, it is 500 with two letter O's. Restricted hard:
       the token must already contain a digit and consist of NOTHING but digits
       and the two letters that stand in for them. That keeps "B12" (a real
       vitamin) and the standalone "O" of "TAXIM O 200" out of reach — B is not
       on the list, and a lone "O" has no digit beside it. */
    function fixDigitLookalikes(s) {
        return str(s).split(/(\s+)/).map(function (tok) {
            if (!/\d/.test(tok)) return tok;
            if (!/^[0-9OIl]+$/.test(tok)) return tok;
            return tok.replace(/O/g, '0').replace(/[Il]/g, '1');
        }).join('');
    }

    function clean(raw) {
        var s = str(raw)
            .replace(/[|\[\]{}()<>*_~^`"]/g, ' ')
            .replace(/^[\s\d.,:;/\\-]+/, '')      // leading serial / punctuation
            .replace(/[\s.,:;]+$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return fixDigitLookalikes(s);
    }

    function norm(s) {
        return clean(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    /* Every run of digits, in order. This is the drug's identity. */
    function digitsOf(s) {
        var m = str(s).match(/\d+/g);
        return m ? m.join('.') : '';
    }
    /* Letters only — the part that OCR gets wrong and that is safe to fix. */
    function lettersOf(s) {
        return str(s).toUpperCase().replace(/[^A-Z]/g, '');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        var prev = new Array(b.length + 1), cur = new Array(b.length + 1), i, j;
        for (j = 0; j <= b.length; j++) prev[j] = j;
        for (i = 1; i <= a.length; i++) {
            cur[0] = i;
            for (j = 1; j <= b.length; j++) {
                var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            }
            for (j = 0; j <= b.length; j++) prev[j] = cur[j];
        }
        return prev[b.length];
    }

    function similarity(a, b) {
        var m = Math.max(a.length, b.length);
        if (!m) return 0;
        return 1 - (levenshtein(a, b) / m);
    }

    /* ──────────────────────────────────────────────────────────────────
       match(raw, known)
         known — the shop's own product names (getAllMedNames())
       Returns { name, changed, from, suggestion, score, why }
       `suggestion` is set INSTEAD of a change when only the digits differ.
    ────────────────────────────────────────────────────────────────── */
    var MIN_SIM   = 0.80;   // below this it is a different product, not a misread
    var MIN_EDGE  = 0.06;   // the winner must be clear of the runner-up
    var MIN_CHARS = 3;      // "PAN" is real; two characters is noise

    function match(raw, known) {
        var cleaned = clean(raw);
        var out = { name: cleaned || str(raw), changed: false, from: str(raw),
                    suggestion: '', score: 0, why: '' };
        if (!known || !known.length) return out;
        if (norm(cleaned).length < MIN_CHARS) return out;

        var target = norm(cleaned);

        /* Already one of theirs — the commonest case, and it must never be
           touched. Checked before any scoring so an exact hit can never lose
           to a marginally closer-looking neighbour. */
        for (var e = 0; e < known.length; e++) {
            if (norm(known[e]) === target) {
                out.name = known[e];
                return out;
            }
        }

        var tLetters = lettersOf(target), tDigits = digitsOf(target);
        var best = null, bestScore = 0, secondScore = 0;

        for (var i = 0; i < known.length; i++) {
            var k = known[i], kn = norm(k);
            if (kn.length < MIN_CHARS) continue;
            var sc = similarity(target, kn);
            if (sc > bestScore) { secondScore = bestScore; bestScore = sc; best = k; }
            else if (sc > secondScore) { secondScore = sc; }
        }

        if (!best || bestScore < MIN_SIM) return out;
        /* Two candidates equally close means the scan does not say which one
           it is, and picking the first is a coin toss with someone's stock. */
        if (bestScore - secondScore < MIN_EDGE) {
            out.suggestion = best;
            out.score = bestScore;
            out.why = 'more than one product looks this close';
            return out;
        }

        var bDigits = digitsOf(norm(best));

        if (bDigits !== tDigits) {
            /* A STRENGTH, NOT A SPELLING. Report it, never rewrite it — the
               shop may simply have started buying a different strength, and
               only the person holding the invoice can tell. */
            out.suggestion = best;
            out.score = bestScore;
            out.why = 'same name but a different strength — check the invoice';
            return out;
        }

        if (lettersOf(best) !== tLetters) {
            out.name = best;
            out.changed = true;
            out.score = bestScore;
            out.why = 'matched to a product you already buy';
        } else {
            out.name = best;      // spacing/punctuation only
        }
        return out;
    }

    /* Rows are the parser's shape; the product name is column 0. */
    function matchRows(rows, known) {
        var changed = 0, notes = [], asks = [];
        (rows || []).forEach(function (row) {
            var r = match(row[0], known);
            if (r.changed) {
                changed++;
                if (notes.length < 10) notes.push(r.from + ' → ' + r.name);
            }
            if (r.suggestion && notes.length + asks.length < 14) {
                asks.push(r.name + ' — did you mean ' + r.suggestion + '? (not changed)');
            }
            row[0] = r.name;
        });
        return { changed: changed, notes: notes, questions: asks };
    }

    window.mmOcrNames = {
        match: match,
        matchRows: matchRows,
        clean: clean,
        similarity: similarity
    };
})();
