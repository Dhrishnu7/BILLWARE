/**
 * ocr-cloud.js — read a supplier invoice with a vision model instead of Tesseract.
 *
 * WHAT THIS REPLACES
 * ------------------
 * The Tesseract path reads characters and then spends js/ocr-rows.js,
 * ocr-columns.js, ocr-numbers.js, ocr-names.js and half of ocr-preprocess.js
 * reconstructing the table those characters came out of. Measured against a
 * 30-figure known-answer list, that stack peaked at 8/30 on a phone photo, and
 * what was left were character-level misreads — BT4416 for BT4419 — which no
 * amount of parser work can fix.
 *
 * A vision model reads the table AS a table. So this file does almost nothing:
 * downscale the photo, post it, and lay the returned rows out in the same
 * eleven columns the rest of purchase.html already understands. Every screen
 * after this point — the preview, the mapper, the warnings box, "Save scan
 * data" — is unchanged and unaware.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * No preprocessing. Binarising, deskewing, despeckling and erasing grid lines
 * all exist to help a character matcher and actively HURT a vision model,
 * which wants the photograph. Sending the cleaned-up bitmap would throw away
 * the colour and context it reads with.
 *
 * No repairs. Same rule as the Tesseract path and for the same reason: a
 * confidently wrong batch number is worse than a blank one. Where a figure
 * disagrees with the arithmetic it is REPORTED, never adjusted.
 *
 * Needs the network. mmOcrCloudAvailable() is the gate; purchase.html falls
 * back to Tesseract when it returns false, so a shop with no signal can still
 * scan.
 */

(function (global) {
    'use strict';

    /* The high-resolution vision tier reads up to 2576px on the long edge, so
       anything beyond ~2400 is upload time bought for nothing. Coming the
       other way, this is NOT a floor: unlike Tesseract, the model still reads
       a 1600px WhatsApp photo, which is the whole reason this path exists. */
    var MAX_EDGE = 2400;
    var JPEG_QUALITY = 0.92;
    var TIMEOUT_MS = 120000;

    var HEADERS = ['Product Name', 'Batch No', 'Expiry', 'Quantity', 'MRP',
                   'Rate', 'GST%', 'Pack', 'Amount', 'HSN', 'Free'];

    function _url() {
        if (typeof _AUTH_SUPABASE_URL !== 'undefined') return _AUTH_SUPABASE_URL;
        if (typeof SUPABASE_URL !== 'undefined') return SUPABASE_URL;
        return '';
    }
    function _anonKey() {
        if (typeof _AUTH_SUPABASE_KEY !== 'undefined') return _AUTH_SUPABASE_KEY;
        if (typeof SUPABASE_KEY !== 'undefined') return SUPABASE_KEY;
        return '';
    }

    /* Offline is the only reason to skip the cloud path outright. Everything
       else — a slow line, a busy server, a missing API key — is discovered by
       trying, and purchase.html falls back on the error rather than guessing
       in advance. */
    function mmOcrCloudAvailable() {
        if (!_url() || !_anonKey()) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        return true;
    }

    /* The user's Auth token, not the publishable key. mm-ocr rejects the
       publishable key on purpose — otherwise anyone who opens devtools has a
       free vision model on the shop's bill. */
    function _bearer() {
        return new Promise(function (resolve) {
            try {
                var db = (typeof _authDB === 'function') ? _authDB()
                       : (typeof _supabase !== 'undefined' ? _supabase : null);
                if (!db || !db.auth) { resolve(null); return; }
                db.auth.getSession().then(function (r) {
                    resolve((r && r.data && r.data.session && r.data.session.access_token) || null);
                }).catch(function () { resolve(null); });
            } catch (e) { resolve(null); }
        });
    }

    function _readAsBase64(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () {
                var s = String(fr.result || '');
                var i = s.indexOf(',');
                resolve(i >= 0 ? s.slice(i + 1) : s);
            };
            fr.onerror = function () { reject(new Error('Could not read the file.')); };
            fr.readAsDataURL(file);
        });
    }

    /* Downscale only. A phone shoots 12MP; the model reads 3.75MP, and the
       difference is thirty seconds of upload on a shop's connection.
       imageOrientation:'from-image' matters — a portrait photo carries its
       rotation in EXIF, and a canvas that ignores it hands over a sideways
       page. The model copes with sideways, but there is no reason to make it. */
    function _shrinkImage(file) {
        return new Promise(function (resolve, reject) {
            function draw(src, w, h) {
                var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
                var cw = Math.max(1, Math.round(w * scale));
                var ch = Math.max(1, Math.round(h * scale));
                var c = document.createElement('canvas');
                c.width = cw; c.height = ch;
                var ctx = c.getContext('2d');
                ctx.drawImage(src, 0, 0, cw, ch);
                c.toBlob(function (blob) {
                    if (!blob) { reject(new Error('Could not prepare the photo.')); return; }
                    _readAsBase64(blob).then(function (b64) {
                        resolve({ base64: b64, mimeType: 'image/jpeg', width: cw, height: ch,
                                  sourceWidth: w, sourceHeight: h });
                    }).catch(reject);
                }, 'image/jpeg', JPEG_QUALITY);
            }

            if (typeof createImageBitmap === 'function') {
                createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
                    draw(bmp, bmp.width, bmp.height);
                }).catch(function () { fallback(); });
            } else { fallback(); }

            function fallback() {
                var url = URL.createObjectURL(file);
                var im = new Image();
                im.onload = function () {
                    URL.revokeObjectURL(url);
                    draw(im, im.naturalWidth, im.naturalHeight);
                };
                im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not open the photo.')); };
                im.src = url;
            }
        });
    }

    function _num(v) {
        var s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
        if (!s || s === '.' || s === '-') return null;
        var n = parseFloat(s);
        return isFinite(n) ? n : null;
    }

    /* Strings, not numbers, all the way through: purchase.html builds rows of
       strings and does its own coercion, and "" is the only unambiguous way to
       say "this was not printed" — 0 is a value. */
    function _clean(v) {
        var s = String(v == null ? '' : v).trim();
        if (!s || s === '-' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null') return '';
        return s;
    }
    function _cleanNumStr(v) {
        var n = _num(v);
        return n === null ? '' : String(n);
    }

    /* ── The invoice checks itself ────────────────────────────────────────
       Kept from the Tesseract path, because it is the only check that can see
       the table WHOLE. Every other warning is a judgement about one line; an
       agreeing Sub Total is proof that no line is missing and no amount was
       misread. When it disagrees, the size of the gap says which: a shortfall
       equal to one line's amount means a line was dropped, not misread. */
    function _totalsCheck(rows, printedSubTotal) {
        var printed = _num(printedSubTotal);
        if (printed === null || printed <= 0) return null;
        var summed = 0;
        for (var i = 0; i < rows.length; i++) {
            var v = _num(rows[i][8]);
            if (v !== null) summed += v;
        }
        summed = Math.round(summed * 100) / 100;
        var diff = Math.round((summed - printed) * 100) / 100;
        // A rupee of slack for a round-off applied to the total but not the lines.
        return { printed: printed, summed: summed, diff: diff, ok: Math.abs(diff) <= 1 };
    }

    function _mapLines(lines) {
        var rows = [];
        var uncertain = {};   // field -> count, for the summary line
        var flags = [];       // per row: which fields the model was unsure of
        var arith = [];       // rows where qty x rate does not make amount
        var mrpBelowRate = [];
        var noName = 0;

        (lines || []).forEach(function (ln, idx) {
            var name = _clean(ln.productName);
            var row = [
                name,                          // 0  Product Name
                _clean(ln.batchNo),            // 1  Batch No
                _clean(ln.expiry),             // 2  Expiry
                _cleanNumStr(ln.quantity),     // 3  Quantity
                _cleanNumStr(ln.mrp),          // 4  MRP
                _cleanNumStr(ln.rate),         // 5  Rate
                _cleanNumStr(ln.gstPercent),   // 6  GST%
                _clean(ln.pack),               // 7  Pack
                _cleanNumStr(ln.amount),       // 8  Amount
                _clean(ln.hsn),                // 9  HSN
                _cleanNumStr(ln.freeQty)       // 10 Free
            ];
            if (!name) noName++;

            /* Two records of the same fact, for two different jobs.
               `uncertain` is the tally behind the summary line ("batchNo on 3
               line(s)"). `flags` keeps WHICH LINE each doubt belongs to.

               Only the tally used to survive, so the shop was told three batch
               numbers were doubtful and then had to read all forty rows to
               find them. The model told us the row number; we were throwing it
               away one line before it was needed. */
            var lineFlags = [];
            (ln.uncertain || []).forEach(function (f) {
                var k = String(f || '').trim();
                if (!k) return;
                uncertain[k] = (uncertain[k] || 0) + 1;
                if (lineFlags.indexOf(k) < 0) lineFlags.push(k);
            });
            flags.push(lineFlags);

            var q = _num(row[3]), r = _num(row[5]), a = _num(row[8]), m = _num(row[4]);
            /* Reported, never corrected. Which of the three figures is wrong
               is not knowable from here, and picking one would replace a
               visible problem with an invisible one. */
            if (q !== null && r !== null && a !== null && a > 0) {
                var expect = q * r;
                if (expect > 0 && Math.abs(expect - a) / a > 0.05) {
                    arith.push((name || 'line ' + (idx + 1)) +
                        ' (' + q + ' x ' + r + ' = ' + (Math.round(expect * 100) / 100) + ', printed ' + a + ')');
                }
            }
            if (m !== null && r !== null && m > 0 && r > m) {
                mrpBelowRate.push(name || 'line ' + (idx + 1));
            }
            rows.push(row);
        });

        return { rows: rows, uncertain: uncertain, flags: flags, arith: arith,
                 mrpBelowRate: mrpBelowRate, noName: noName };
    }

    /**
     * Scan one invoice.
     * @returns {Promise<{rows:Array, headers:Array, invoice:Object, messages:Array,
     *                    totalCheck:Object|null, raw:Object}>}
     * Rejects with an Error whose message is safe to show a shopkeeper.
     */
    function mmOcrCloudScan(file, opts) {
        opts = opts || {};
        var say = opts.onProgress || function () {};
        var isPdf = (file.type === 'application/pdf') || /\.pdf$/i.test(file.name || '');

        return Promise.resolve()
            .then(function () {
                say('Preparing the photo…', 10);
                /* A PDF goes up whole rather than as a rasterised first page:
                   the model reads every page, so a two-page invoice stops
                   losing its second half. */
                if (isPdf) {
                    return _readAsBase64(file).then(function (b64) {
                        return { base64: b64, mimeType: 'application/pdf', kind: 'pdf' };
                    });
                }
                return _shrinkImage(file);
            })
            .then(function (prep) {
                say('Uploading…', 25);
                return _bearer().then(function (token) {
                    if (!token) {
                        throw new Error('Your sign-in has expired. Please sign in again, then scan.');
                    }
                    var ctrl = new AbortController();
                    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

                    /* The scan takes 10-40 seconds with no server-side
                        progress to report, so the bar is driven on a clock.
                        It is honest about that: it climbs to 90 and waits. */
                    var pct = 30;
                    var tick = setInterval(function () {
                        pct = Math.min(90, pct + 2);
                        say('Reading the invoice…', pct);
                    }, 900);

                    return fetch(_url() + '/functions/v1/mm-ocr', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': _anonKey(),
                            'Authorization': 'Bearer ' + token
                        },
                        body: JSON.stringify({
                            image: prep.base64,
                            mimeType: prep.mimeType,
                            kind: prep.kind || 'image'
                        }),
                        signal: ctrl.signal
                    }).then(function (res) {
                        clearTimeout(timer); clearInterval(tick);
                        return res.json().catch(function () { return null; }).then(function (body) {
                            if (!res.ok || !body || body.error) {
                                /* The server's verbatim reason for failing.
                                   Logged loudly and separately, because the
                                   shop-facing message is deliberately plain
                                   and the operator needs the real one — the
                                   first version of this swallowed it and cost
                                   an evening guessing at a 400. */
                                if (body && body.detail) {
                                    console.error('[OCR] server said:', body.detail);
                                }
                                var err = new Error((body && body.error) ||
                                    'The scanner could not be reached. Check your connection.');
                                /* Silence is earned by exactly two cases: the
                                   function is not deployed (404), or it is
                                   deployed and nobody has set the API key yet
                                   (notConfigured). Both mean "this feature is
                                   not switched on", which the shop cannot act
                                   on and should not be nagged about.

                                   It used to include EVERY 503, which swallowed
                                   an out-of-credit account completely — the
                                   scans silently degraded to Tesseract and
                                   nothing anywhere said why. A failure someone
                                   must fix has to be visible. */
                                err.notDeployed = (res.status === 404 || !!(body && body.notConfigured));
                                err.status = res.status;
                                throw err;
                            }
                            return { body: body, prep: prep };
                        });
                    }).catch(function (e) {
                        clearTimeout(timer); clearInterval(tick);
                        if (e && e.name === 'AbortError') {
                            throw new Error('The scan took too long. Try again, or use a smaller photo.');
                        }
                        throw e;
                    });
                });
            })
            .then(function (out) {
                say('Checking the figures…', 95);
                var result = out.body.result || {};
                var mapped = _mapLines(result.lines);
                var totalCheck = _totalsCheck(mapped.rows, result.subTotal);
                var messages = [];

                /* Ordered so the most useful thing is read first: what the
                   shop must check, before what merely went well. */
                if (mapped.noName) {
                    messages.push(mapped.noName + ' line(s) were found but the product NAME could not be read — ' +
                        'they are in the list with the name blank, find them by their batch or amount and type the name in.');
                }
                var uKeys = Object.keys(mapped.uncertain);
                if (uKeys.length) {
                    messages.push('The scanner was unsure of these — check them against the paper first: ' +
                        uKeys.map(function (k) { return k + ' on ' + mapped.uncertain[k] + ' line(s)'; }).join(', '));
                }
                if (mapped.arith.length) {
                    messages.push(mapped.arith.length + ' line(s) do not multiply out — quantity x rate does not equal ' +
                        'the printed amount, so one of the three was misread: ' + mapped.arith.slice(0, 6).join('; '));
                }
                if (mapped.mrpBelowRate.length) {
                    messages.push('MRP is BELOW the purchase rate on ' + mapped.mrpBelowRate.length +
                        ' line(s), which is almost never right — the two columns may be swapped: ' +
                        mapped.mrpBelowRate.slice(0, 6).join(', '));
                }
                (result.notes || []).forEach(function (n) {
                    var s = String(n || '').trim();
                    if (s) messages.push(s);
                });
                if (String(result.taxExclusive || '') === 'no') {
                    messages.push('The rates on this invoice appear to INCLUDE GST. Check the Rate column — ' +
                        'this app expects the rate before tax.');
                }

                // Last in, so it reads first: the only check that sees the table whole.
                if (totalCheck) {
                    if (totalCheck.ok) {
                        messages.unshift('✅ The ' + mapped.rows.length + ' line amounts add up to the ₹' +
                            totalCheck.printed.toFixed(2) + ' Sub Total printed on the invoice — ' +
                            'nothing is missing and no amount was misread.');
                    } else {
                        var short = totalCheck.diff < 0;
                        messages.unshift('⚠️ The line amounts come to ₹' + totalCheck.summed.toFixed(2) +
                            ' but the invoice\'s Sub Total says ₹' + totalCheck.printed.toFixed(2) +
                            ' — ' + (short ? 'short' : 'over') + ' by ₹' + Math.abs(totalCheck.diff).toFixed(2) + '. ' +
                            (short ? 'A whole line may be missing, or one amount read low.'
                                   : 'One amount was probably read high, or a line was counted twice.'));
                    }
                }

                say('Done', 100);
                return {
                    rows: mapped.rows,
                    /* Parallel to rows, one entry per line: the field names the
                       model said it was unsure of. The page turns these into
                       highlighted boxes so the shop checks four cells against
                       the paper instead of re-reading forty rows. */
                    flags: mapped.flags,
                    headers: HEADERS.slice(),
                    invoice: {
                        supplierName: _clean(result.supplierName),
                        invoiceNo: _clean(result.invoiceNo),
                        invoiceDate: _clean(result.invoiceDate),
                        subTotal: _clean(result.subTotal),
                        grandTotal: _clean(result.grandTotal),
                        taxExclusive: _clean(result.taxExclusive)
                    },
                    messages: messages,
                    totalCheck: totalCheck,
                    /* The evidence file, same purpose as the Tesseract one:
                       the OCR path must never be changed from a screenshot.
                       Here it is the model's raw answer plus what was sent. */
                    raw: {
                        engine: out.body.engine || 'cloud',
                        savedAt: new Date().toISOString(),
                        sentAs: {
                            mimeType: out.prep.mimeType,
                            width: out.prep.width || null,
                            height: out.prep.height || null,
                            sourceWidth: out.prep.sourceWidth || null,
                            sourceHeight: out.prep.sourceHeight || null
                        },
                        usage: out.body.usage || null,
                        result: result,
                        parsed: mapped.rows.map(function (r) { return r.slice(); }),
                        totalCheck: totalCheck
                    }
                };
            });
    }

    global.mmOcrCloudAvailable = mmOcrCloudAvailable;
    global.mmOcrCloudScan = mmOcrCloudScan;
    global.mmOcrCloudHeaders = HEADERS;

})(typeof window !== 'undefined' ? window : this);
