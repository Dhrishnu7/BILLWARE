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

    /* The mirror of fixDigitLookalikes, and much narrower. A token that is
       exactly "0" is never a strength — no medicine is a zero of anything —
       so between two letters it is the letter O that the scan flattened.
       Measured: TAXIM O 200 came back as "TaXiM 0 200", and because digits
       are identity the matcher read that as a different strength (0.200
       against 200) and refused to correct a name it had otherwise found.

       Only a LONE zero, and only with a letter beside it: "0.5" and "40"
       keep their zeros, and so does a "0" standing on its own in a cell
       with nothing around it. */
    function fixLoneZero(s) {
        var toks = str(s).split(/(\s+)/);
        var words = [], idx = [];
        for (var i = 0; i < toks.length; i++) {
            if (!/^\s*$/.test(toks[i])) { words.push(toks[i]); idx.push(i); }
        }
        for (var w = 0; w < words.length; w++) {
            if (words[w] !== '0') continue;
            var prev = w > 0 ? words[w - 1] : '';
            var next = w < words.length - 1 ? words[w + 1] : '';
            if (/[A-Za-z]/.test(prev) || /[A-Za-z]/.test(next)) toks[idx[w]] = 'O';
        }
        return toks.join('');
    }

    function clean(raw) {
        var s = str(raw)
            .replace(/[|\[\]{}()<>*_~^`"]/g, ' ')
            .replace(/^[\s\d.,:;/\\-]+/, '')      // leading serial / punctuation
            .replace(/[\s.,:;]+$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return fixLoneZero(fixDigitLookalikes(s));
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

    /* A national brand list is a far larger haystack than one pharmacy's
       shelf, so a match against it has to be correspondingly clearer. */
    var FALLBACK_SIM = 0.86;

    function match(raw, known, fallback) {
        var cleaned = clean(raw);
        var out = { name: cleaned || str(raw), changed: false, from: str(raw),
                    suggestion: '', score: 0, why: '' };
        var haveKnown = !!(known && known.length);
        var haveFall  = !!(fallback && fallback.length);
        if (!haveKnown && !haveFall) return out;
        if (norm(cleaned).length < MIN_CHARS) return out;

        var target = norm(cleaned);

        /* Already one of theirs — the commonest case, and it must never be
           touched. Checked before any scoring so an exact hit can never lose
           to a marginally closer-looking neighbour. */
        var e;
        for (e = 0; known && e < known.length; e++) {
            if (norm(known[e]) === target) {
                out.name = known[e];
                return out;
            }
        }

        var tLetters = lettersOf(target), tDigits = digitsOf(target);
        var best = null, bestScore = 0, secondScore = 0, usedFallback = false;

        for (var i = 0; known && i < known.length; i++) {
            var k = known[i], kn = norm(k);
            if (kn.length < MIN_CHARS) continue;
            var sc = similarity(target, kn);
            if (sc > bestScore) { secondScore = bestScore; bestScore = sc; best = k; }
            else if (sc > secondScore) { secondScore = sc; }
        }

        /* THE SHOP'S OWN HISTORY WINS OUTRIGHT. The common-brand list is only
           reached when that has nothing to offer, because a pharmacy that
           stocks DOLO knows it stocks DOLO, and a national list cannot know
           which of two similar brands this particular shop actually buys.

           On day one the shop's history is empty and this is the only corpus
           there is — which is exactly the moment a new user decides whether
           the scanning works. See js/med-names.js. */
        if (haveFall && (!best || bestScore < MIN_SIM)) {
            /* THE LIST CARRIES BRANDS, NOT PACK SIZES — "AZITHRAL", not
               "AZITHRAL 500" — so the strength has to be taken out of the
               comparison or every match fails on the digits the shop's own
               invoice supplies. "AZTHRAL 500" scored 0.60 against "AZITHRAL"
               whole and 0.88 letter for letter, which is the same reading
               either way; only one of them recognises it.

               The digits are not being ignored, they are being LEFT ALONE:
               nothing here can change them, and whatever the scan read is
               carried through onto the corrected name below. Where a list
               entry does carry digits of its own they still have to agree,
               so "PAN 40" in the list can never claim a scanned "PAN 20". */
            var fBest = null, fScore = 0, fSecond = 0;
            for (var f = 0; f < fallback.length; f++) {
                var fk = fallback[f], fn = norm(fk);
                if (fn.length < MIN_CHARS) continue;
                if (fn === target) { out.name = fk; return out; }
                var fDigits = digitsOf(fn);
                if (fDigits && fDigits !== tDigits) continue;
                var fLetters = lettersOf(fn);
                if (fLetters.length < MIN_CHARS) continue;
                var fs = similarity(tLetters, fLetters);
                if (fs > fScore) { fSecond = fScore; fScore = fs; fBest = fk; }
                else if (fs > fSecond) { fSecond = fs; }
            }
            if (fBest && fScore >= FALLBACK_SIM) {
                best = fBest; bestScore = fScore; secondScore = fSecond;
                usedFallback = true;
            }
        }

        if (!best || bestScore < (usedFallback ? FALLBACK_SIM : MIN_SIM)) return out;
        /* Two candidates equally close means the scan does not say which one
           it is, and picking the first is a coin toss with someone's stock. */
        if (bestScore - secondScore < MIN_EDGE) {
            out.suggestion = best;
            out.score = bestScore;
            out.why = 'more than one product looks this close';
            return out;
        }

        var bDigits = digitsOf(norm(best));

        /* A brand-only entry from the common list makes no claim about the
           strength, so there is nothing to disagree with — the scanned
           digits stand as printed and are carried onto the corrected name.
           Without this, every fallback match on a product that HAS a
           strength would be demoted to a question. */
        if (usedFallback && !bDigits) bDigits = tDigits;

        if (bDigits !== tDigits) {
            /* A STRENGTH, NOT A SPELLING. Report it, never rewrite it — the
               shop may simply have started buying a different strength, and
               only the person holding the invoice can tell. */
            out.suggestion = best;
            out.score = bestScore;
            out.why = 'same name but a different strength — check the invoice';
            return out;
        }

        /* A correction from the common list REPLACES THE BRAND AND KEEPS THE
           REST. The list holds "AZITHRAL", the paper says "AZITHRAL 500",
           and simply taking the list entry would delete a strength the scan
           read perfectly — the one thing this module is built never to do.
           So the brand's own tokens are swapped out and whatever followed
           them is carried through: "AZTHRAL 500" → "AZITHRAL 500",
           "AUGMENTIN 625" → "AUGMENTIN 625", "PAN 20" → "PAN 20".

           A match from the shop's OWN list is a whole product name, strength
           included, so there it is the entry that stands. */
        var finalName = best;
        if (usedFallback) {
            var cTok = cleaned.split(/\s+/).filter(function (t) { return t.length; });
            var bTok = str(best).split(/\s+/).filter(function (t) { return t.length; });
            var rest = cTok.slice(bTok.length).join(' ').trim();
            if (rest) finalName = best + ' ' + rest;
        }

        if (finalName !== cleaned) {
            out.name = finalName;
            out.changed = true;
            out.score = bestScore;
            out.why = usedFallback ? 'matched to a common brand name'
                                   : 'matched to a product you already buy';
        } else {
            out.name = finalName;   // spacing/punctuation only
        }
        return out;
    }

    /* Rows are the parser's shape; the product name is column 0. */
    function matchRows(rows, known, fallback) {
        var changed = 0, notes = [], asks = [], listNotes = [];
        (rows || []).forEach(function (row) {
            var r = match(row[0], known, fallback);
            if (r.changed) {
                changed++;
                /* Kept apart, because the two are not worth the same to the
                   person checking. A match against the shop's own history
                   says "you have bought this before". A match against the
                   common brand list says only "this is a real brand and the
                   letters are close" — the shop may never have stocked it,
                   and telling them otherwise invites a nod-through.

                   The name is shown cleaned rather than raw: the serial
                   number bleeds in from the left-hand column, so the note
                   read "4 AZTHRAL 500 → AZITHRAL 500" and the 4 is not part
                   of anything. */
                var note = clean(r.from) + ' → ' + r.name;
                if (/common brand/.test(r.why)) {
                    if (listNotes.length < 10) listNotes.push(note);
                } else if (notes.length < 10) {
                    notes.push(note);
                }
            }
            if (r.suggestion && notes.length + asks.length < 14) {
                asks.push(r.name + ' — did you mean ' + r.suggestion + '? (not changed)');
            }
            row[0] = r.name;
        });
        return { changed: changed, notes: notes, listNotes: listNotes, questions: asks };
    }

    window.mmOcrNames = {
        match: match,
        matchRows: matchRows,
        clean: clean,
        similarity: similarity
    };
})();
