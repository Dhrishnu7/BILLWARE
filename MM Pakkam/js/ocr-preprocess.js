/* ══════════════════════════════════════════════════════════════════════
   ocr-preprocess.js — clean up an invoice photo before it reaches Tesseract

   WHY THIS EXISTS
   Tesseract is trained on clean, high-contrast printed text. Pharma
   distributors send the opposite: low-ink dot-matrix, smudged thermal rolls,
   phone photos taken at an angle under shop lighting. Until now the file went
   to the OCR engine exactly as captured, which is where most of the accuracy
   was being lost — before a single character was read.

   The pipeline below is the classic document-scanner one, in plain canvas with
   no extra library:

     scale ──► grayscale ──► deskew ──► contrast stretch ──► (blur) ──►
     adaptive threshold ──► despeckle

   Two steps matter most for this particular problem:
     • ADAPTIVE threshold, not a global one. A thermal receipt is dark at one
       end and faded at the other; a single cutoff either loses the faint half
       or floods the dark half. A local threshold judges each pixel against its
       own neighbourhood.
     • A deliberate BLUR before thresholding on dot-matrix. The characters are
       literally disconnected dots; blurring merges them into strokes so the
       engine sees letters instead of noise. It is the one case where throwing
       away detail improves the result — which is why it is opt-in, not always
       applied: on clean text the same blur softens the edges and hurts.

   Exposes: window.mmOcrPreprocess(source, opts) -> { canvas, blob, meta }
     opts.mode  'auto' | 'none' | 'basic' | 'binarize' | 'dotmatrix'
     opts.deskew        default true
     opts.despeckle     default true
     opts.targetLong    long-edge px to work at (default 2000)
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var MIN_LONG = 1600;   // upscale smaller images to at least this
    var MAX_LONG = 3200;   // and never work bigger than this (memory + speed)

    // ── decode any File/Blob/Image/Canvas into a canvas ──
    function toBitmap(source) {
        if (source instanceof HTMLCanvasElement) return Promise.resolve(source);
        /* An <img> that has already decoded is usable as-is. Without this it
           fell through to `img.src = source`, which stringifies the element to
           "[object HTMLImageElement]" and fails to decode — so any caller
           holding a loaded image got "Could not decode image". */
        if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
            if (source.complete && source.naturalWidth) return Promise.resolve(source);
            return new Promise(function (resolve, reject) {
                source.addEventListener('load', function () { resolve(source); }, { once: true });
                source.addEventListener('error', function () { reject(new Error('Could not decode image')); }, { once: true });
            });
        }
        if (typeof createImageBitmap === 'function' && (source instanceof Blob)) {
            return createImageBitmap(source);
        }
        return new Promise(function (resolve, reject) {
            var img = new Image();
            var url = (source instanceof Blob) ? URL.createObjectURL(source) : source;
            img.onload = function () { resolve(img); if (source instanceof Blob) URL.revokeObjectURL(url); };
            img.onerror = function () { reject(new Error('Could not decode image')); };
            img.src = url;
        });
    }

    function drawScaled(bmp) {
        var w = bmp.width, h = bmp.height;
        var long = Math.max(w, h);
        var scale = 1;
        if (long < MIN_LONG) scale = Math.min(3, MIN_LONG / long);      // upscale faint scans
        else if (long > MAX_LONG) scale = MAX_LONG / long;              // downscale huge photos
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, cw, ch);
        return { canvas: c, scale: scale };
    }

    // ── luminance, in place, returns a Uint8 plane ──
    function toGray(ctx, w, h) {
        var img = ctx.getImageData(0, 0, w, h);
        var d = img.data, g = new Uint8ClampedArray(w * h);
        for (var i = 0, p = 0; i < d.length; i += 4, p++) {
            g[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        }
        return g;
    }

    function grayToCtx(ctx, g, w, h) {
        var img = ctx.createImageData(w, h), d = img.data;
        for (var p = 0, i = 0; p < g.length; p++, i += 4) {
            d[i] = d[i + 1] = d[i + 2] = g[p]; d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
    }

    // ── histogram stats: percentiles + how much of the page is ink ──
    function stats(g) {
        var hist = new Uint32Array(256), i;
        for (i = 0; i < g.length; i++) hist[g[i]]++;
        var total = g.length, acc = 0, p2 = 0, p98 = 255, seen2 = false;
        for (i = 0; i < 256; i++) {
            acc += hist[i];
            if (!seen2 && acc >= total * 0.02) { p2 = i; seen2 = true; }
            if (acc >= total * 0.98) { p98 = i; break; }
        }
        // Otsu, used by the deskew estimator
        var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
        var sumB = 0, wB = 0, best = 0, thr = 128;
        for (i = 0; i < 256; i++) {
            wB += hist[i]; if (!wB) continue;
            var wF = total - wB; if (!wF) break;
            sumB += i * hist[i];
            var mB = sumB / wB, mF = (sum - sumB) / wF;
            var between = wB * wF * (mB - mF) * (mB - mF);
            if (between > best) { best = between; thr = i; }
        }
        var ink = 0;
        for (i = 0; i < g.length; i++) if (g[i] < thr) ink++;
        return { p2: p2, p98: p98, otsu: thr, contrast: p98 - p2, inkRatio: ink / total };
    }

    // ── map [p2,p98] onto [0,255] so faint print gains real contrast ──
    function stretch(g, st) {
        var lo = st.p2, hi = st.p98;
        if (hi - lo < 12) return g;                 // already flat; stretching would only amplify noise
        var lut = new Uint8ClampedArray(256);
        for (var v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, ((v - lo) * 255) / (hi - lo)));
        for (var i = 0; i < g.length; i++) g[i] = lut[g[i]];
        return g;
    }

    // ── 3x3 box blur (separable). Merges dot-matrix dots into strokes. ──
    function blur3(g, w, h, passes) {
        var src = g, tmp = new Uint8ClampedArray(g.length);
        for (var n = 0; n < (passes || 1); n++) {
            var x, y, i;
            for (y = 0; y < h; y++) {              // horizontal
                for (x = 0; x < w; x++) {
                    i = y * w + x;
                    var a = src[i - (x > 0 ? 1 : 0)], b = src[i], c = src[i + (x < w - 1 ? 1 : 0)];
                    tmp[i] = (a + b + c) / 3;
                }
            }
            for (x = 0; x < w; x++) {              // vertical
                for (y = 0; y < h; y++) {
                    i = y * w + x;
                    var a2 = tmp[i - (y > 0 ? w : 0)], b2 = tmp[i], c2 = tmp[i + (y < h - 1 ? w : 0)];
                    src[i] = (a2 + b2 + c2) / 3;
                }
            }
        }
        return src;
    }

    /* ── Bradley adaptive threshold ──
       Each pixel is compared with the mean of a window around it (via an
       integral image, so it stays O(n) regardless of window size). This is what
       copes with a receipt that fades across the page. */
    function adaptiveThreshold(g, w, h, winFrac, tPct) {
        var integral = new Float64Array((w + 1) * (h + 1));
        var x, y, i;
        for (y = 0; y < h; y++) {
            var rowSum = 0;
            for (x = 0; x < w; x++) {
                rowSum += g[y * w + x];
                integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
            }
        }
        var win = Math.max(15, Math.floor(w * (winFrac || 0.045)));
        if (win % 2 === 0) win++;
        var half = win >> 1, t = 1 - (tPct == null ? 0.13 : tPct);
        var out = new Uint8ClampedArray(g.length);
        for (y = 0; y < h; y++) {
            var y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
            for (x = 0; x < w; x++) {
                var x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
                var count = (x1 - x0 + 1) * (y1 - y0 + 1);
                var sum = integral[(y1 + 1) * (w + 1) + (x1 + 1)]
                        - integral[y0 * (w + 1) + (x1 + 1)]
                        - integral[(y1 + 1) * (w + 1) + x0]
                        + integral[y0 * (w + 1) + x0];
                i = y * w + x;
                out[i] = (g[i] * count < sum * t) ? 0 : 255;
            }
        }
        return out;
    }

    // ── drop lone black pixels (thermal speckle, paper grain) ──
    function despeckle(b, w, h) {
        var out = new Uint8ClampedArray(b);
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var i = y * w + x;
                if (b[i] !== 0) continue;
                var n = 0;
                if (b[i - 1] === 0) n++;
                if (b[i + 1] === 0) n++;
                if (b[i - w] === 0) n++;
                if (b[i + w] === 0) n++;
                if (b[i - w - 1] === 0) n++;
                if (b[i - w + 1] === 0) n++;
                if (b[i + w - 1] === 0) n++;
                if (b[i + w + 1] === 0) n++;
                if (n <= 1) out[i] = 255;
            }
        }
        return out;
    }

    /* ── skew estimate ──
       Rows of text produce a strongly peaked horizontal projection when the page
       is straight and a smeared one when it is tilted. Score each candidate
       angle by the variance of that projection and keep the sharpest. Measured
       on a small copy — a degree of accuracy is plenty and this keeps it fast. */
    function estimateSkew(g, w, h, otsu) {
        var SW = Math.min(700, w), sc = SW / w, SH = Math.max(1, Math.round(h * sc));
        var small = new Uint8Array(SW * SH), x, y;
        for (y = 0; y < SH; y++) {
            var sy = Math.min(h - 1, Math.round(y / sc));
            for (x = 0; x < SW; x++) {
                var sx = Math.min(w - 1, Math.round(x / sc));
                small[y * SW + x] = g[sy * w + sx] < otsu ? 1 : 0;
            }
        }
        var best = 0, bestScore = -1;
        for (var deg = -5; deg <= 5; deg += 0.5) {
            var rad = deg * Math.PI / 180, tan = Math.tan(rad);
            var proj = new Float64Array(SH);
            for (y = 0; y < SH; y++) {
                for (x = 0; x < SW; x++) {
                    if (!small[y * SW + x]) continue;
                    var yy = y + ((x - SW / 2) * tan) | 0;
                    if (yy >= 0 && yy < SH) proj[yy]++;
                }
            }
            var mean = 0, k;
            for (k = 0; k < SH; k++) mean += proj[k];
            mean /= SH;
            var varr = 0;
            for (k = 0; k < SH; k++) { var d = proj[k] - mean; varr += d * d; }
            if (varr > bestScore) { bestScore = varr; best = deg; }
        }
        return best;
    }

    /* ── Which way up is the page? ─────────────────────────────────────
       estimateSkew() above searches ±5°, which is right for a photo taken
       slightly crooked and useless for the far more common case: a phone
       held sideways over an A4 invoice, giving a page rotated a quarter
       turn. Tesseract in PSM 6 reads almost nothing off that, and the shop
       is told its "unclear" photo is at fault when the photo is perfect.

       Text lines make ink alternate strongly ACROSS them and weakly ALONG
       them, so the projection profile perpendicular to the lines is spiky
       and the parallel one is flat. Comparing the two says whether the
       lines run horizontally (0°/180°) or vertically (90°/270°) — cheaply,
       with no OCR at all.

       It cannot tell 0° from 180°: both have horizontal lines. That last
       bit of ambiguity is left to the caller, which resolves it by running
       a quick low-resolution scan of each and keeping whichever produced
       real words. Two cheap scans beats four expensive ones.
    ────────────────────────────────────────────────────────────────── */
    function rotate90(src, deg) {
        deg = ((deg % 360) + 360) % 360;
        if (deg === 0) return src;
        var swap = (deg === 90 || deg === 270);
        var c = document.createElement('canvas');
        c.width  = swap ? src.height : src.width;
        c.height = swap ? src.width  : src.height;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(deg * Math.PI / 180);
        ctx.drawImage(src, -src.width / 2, -src.height / 2);
        return c;
    }

    /* A REJECTED APPROACH, recorded so it is not tried again.

       The obvious cheap test is to compare the ink-projection profiles of the
       two axes: text lines ought to make the profile across them spiky and the
       one along them flat. Measured on a real sideways invoice it was
       confidently WRONG — cvRow 2.05 against cvCol 0.27, a 7.5x margin in the
       wrong direction. The photo had a strip of dark desk along the bottom
       edge, which binarises to a solid band of ink spanning the full width and
       swamps every row statistic. Dense table rules do the same thing.

       Cropping to the sheet first would fix that particular photo and fail on
       the next one for some other reason. A confidently wrong answer is worse
       than none, so the heuristic is gone: the caller reads a small copy at
       each of the four turns and keeps whichever produced real words. It costs
       a few seconds once, and it cannot be fooled by the furniture.

       This function now only prepares that small copy. */
    async function mmOcrProbeCanvas(source, opts) {
        opts = opts || {};
        var bmp = await toBitmap(source);
        var MAXW = opts.probeWidth || 900;
        var sc = Math.min(1, MAXW / Math.max(bmp.width, bmp.height));
        var w = Math.max(1, Math.round(bmp.width * sc));
        var h = Math.max(1, Math.round(bmp.height * sc));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);

        /* Contrast-stretched greyscale, not the full binarise pipeline: the
           probe only has to be legible enough to tell words from noise, and
           thresholding a downscaled photo throws away thin strokes. */
        var g = toGray(ctx, w, h);
        g = stretch(g, stats(g));
        grayToCtx(ctx, g, w, h);

        return { canvas: c, width: w, height: h };
    }

    function rotateCanvas(src, deg) {
        if (!deg) return src;
        var rad = -deg * Math.PI / 180;
        var c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(rad);
        ctx.drawImage(src, -src.width / 2, -src.height / 2);
        return c;
    }

    async function mmOcrPreprocess(source, opts) {
        opts = opts || {};
        var t0 = (performance && performance.now) ? performance.now() : Date.now();
        var bmp = await toBitmap(source);
        /* A quarter-turn is applied before anything else: every later step —
           deskew, thresholding window, despeckle — assumes text runs across
           the image. */
        if (opts.rotate90) bmp = rotate90(bmp, opts.rotate90);
        var scaled = drawScaled(bmp);
        var canvas = scaled.canvas;
        var w = canvas.width, h = canvas.height;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });

        var g = toGray(ctx, w, h);
        var st = stats(g);

        // 'auto': faint, low-contrast pages are the dot-matrix / worn-ribbon case
        // and want the merge-the-dots treatment; anything crisper does not.
        var mode = opts.mode || 'auto';
        if (mode === 'auto') mode = (st.contrast < 70 || st.inkRatio < 0.035) ? 'dotmatrix' : 'binarize';

        var meta = {
            width: w, height: h, scale: scaled.scale, mode: mode,
            contrast: st.contrast, inkRatio: +st.inkRatio.toFixed(4), skewDeg: 0
        };

        if (mode === 'none') {
            meta.ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
            return { canvas: canvas, blob: await canvasBlob(canvas), meta: meta };
        }

        // Deskew before thresholding: rotation resamples, and resampling a
        // black-and-white image reintroduces the grey edges we just removed.
        if (opts.deskew !== false) {
            var deg = estimateSkew(g, w, h, st.otsu);
            if (Math.abs(deg) >= 0.5) {
                grayToCtx(ctx, g, w, h);
                canvas = rotateCanvas(canvas, deg);
                ctx = canvas.getContext('2d', { willReadFrequently: true });
                g = toGray(ctx, w, h);
                st = stats(g);
                meta.skewDeg = deg;
            }
        }

        g = stretch(g, st);

        if (mode === 'basic') {
            grayToCtx(ctx, g, w, h);
            meta.ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
            return { canvas: canvas, blob: await canvasBlob(canvas), meta: meta };
        }

        if (mode === 'dotmatrix') g = blur3(g, w, h, 1);

        var bin = adaptiveThreshold(g, w, h, opts.winFrac, opts.tPct);
        if (opts.despeckle !== false) bin = despeckle(bin, w, h);

        grayToCtx(ctx, bin, w, h);
        meta.ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
        return { canvas: canvas, blob: await canvasBlob(canvas), meta: meta };
    }

    function canvasBlob(canvas) {
        return new Promise(function (res) {
            if (canvas.toBlob) canvas.toBlob(function (b) { res(b); }, 'image/png');
            else res(null);
        });
    }

    window.mmOcrPreprocess = mmOcrPreprocess;
    window.mmOcrProbeCanvas = mmOcrProbeCanvas;
    window.mmOcrRotate90 = rotate90;
})();
