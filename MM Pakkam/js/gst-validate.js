/* ══════════════════════════════════════════════════════════════════════
   gst-validate.js  —  the checks the GST portal will run, run here first
   ══════════════════════════════════════════════════════════════════════
   Every rule in this file is one the government enforces at upload time.
   Running them at the keyboard instead means the shop finds out while the
   supplier's invoice is still in their hand, rather than three weeks later
   from a rejected return with no idea which bill it came from.

   Deliberately offline-only. Whether a GSTIN is ACTIVE, or belongs to the
   business whose name was typed next to it, lives in the government's own
   register and cannot be known from here — see notOnlineChecked() below.
   This file must never imply otherwise.

   ES5 on purpose: same as the other js/ modules, so it runs on old phones
   and can be exercised in the MSHTML test harness.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    /* ── GSTIN ──────────────────────────────────────────────────────────
       15 characters: SS PPPPP1111P E Z C
         SS     state code
         12345  PAN (5 letters, 4 digits, 1 letter)
         E      entity number for that PAN in that state
         Z      literally 'Z', reserved
         C      check digit over the first 14
    ──────────────────────────────────────────────────────────────────── */
    var CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var SHAPE   = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

    var STATES = {
        '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
        '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
        '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
        '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
        '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
        '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
        '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
        '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli and Daman & Diu',
        '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka',
        '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
        '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana',
        '37': 'Andhra Pradesh', '38': 'Ladakh',
        '97': 'Other Territory', '99': 'Centre Jurisdiction'
    };

    function norm(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

    /* The published algorithm: weight each of the first 14 characters by 1
       and 2 alternately, and for each product add its quotient and remainder
       in base 36. The check digit is whatever brings the total to a multiple
       of 36. It catches every single-character typo and every transposition
       of adjacent characters, which is nearly all of them. */
    function checkDigit(first14) {
        var s = norm(first14), sum = 0, i, v, p;
        if (s.length !== 14) return '';
        for (i = 0; i < 14; i++) {
            v = CHARSET.indexOf(s.charAt(i));
            if (v < 0) return '';
            p = v * (i % 2 === 0 ? 1 : 2);
            sum += Math.floor(p / 36) + (p % 36);
        }
        return CHARSET.charAt((36 - (sum % 36)) % 36);
    }

    /* Returns a REASON, not just false. "Not valid" sends a shopkeeper back
       to the same 15 characters with no idea which one is wrong. */
    function gstin(raw) {
        var s = norm(raw);
        if (!s) return { ok: false, code: 'empty', reason: 'No GSTIN entered.' };

        if (s.length !== 15) {
            return { ok: false, code: 'length', reason:
                'A GSTIN is exactly 15 characters — this one has ' + s.length + '.' };
        }
        if (!SHAPE.test(s)) {
            /* Say which part is wrong. The PAN block in the middle is where
               almost every hand-typed mistake lands. */
            var why = 'The pattern is wrong.';
            if (!/^[0-9]{2}/.test(s))            why = 'The first 2 characters must be the state code digits.';
            else if (!/^.{2}[A-Z]{5}/.test(s))   why = 'Characters 3-7 must be the 5 letters of the PAN.';
            else if (!/^.{7}[0-9]{4}/.test(s))   why = 'Characters 8-11 must be the 4 digits of the PAN.';
            else if (!/^.{11}[A-Z]/.test(s))     why = 'Character 12 must be a letter.';
            else if (s.charAt(13) !== 'Z')       why = 'Character 14 is always the letter Z.';
            return { ok: false, code: 'shape', reason: why };
        }

        var st = s.slice(0, 2);
        if (!STATES[st]) {
            return { ok: false, code: 'state', reason:
                'There is no state with code ' + st + '.' };
        }

        var want = checkDigit(s.slice(0, 14));
        if (want && s.charAt(14) !== want) {
            /* The single most useful message in this file: it means a
               character was mistyped, and the number does not exist. */
            return { ok: false, code: 'checksum', reason:
                'This GSTIN fails its own check digit — the last character should be "'
                + want + '", not "' + s.charAt(14) + '". Something in it is mistyped.' };
        }

        return { ok: true, code: 'ok', state: st, stateName: STATES[st], value: s };
    }

    function gstinOk(s) { return gstin(s).ok; }
    function stateOf(s) { var v = norm(s); return /^\d{2}$/.test(v.slice(0, 2)) ? v.slice(0, 2) : ''; }
    function stateName(cc) { return STATES[String(cc)] || ''; }

    /* ── HSN ────────────────────────────────────────────────────────────
       4, 6 or 8 digits. How many is required depends on turnover, so the
       count is not enforced — only that it is one of the three. */
    function hsn(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { ok: false, code: 'empty', reason: 'No HSN code.' };
        if (!/^\d+$/.test(s)) return { ok: false, code: 'chars', reason: 'An HSN code is digits only.' };
        if (s.length !== 4 && s.length !== 6 && s.length !== 8) {
            return { ok: false, code: 'length', reason:
                'An HSN code is 4, 6 or 8 digits — this one has ' + s.length + '.' };
        }
        return { ok: true, code: 'ok', value: s };
    }

    /* ── GST rate ───────────────────────────────────────────────────────
       A pharmacy uses 0/5/12; the rest are here so a shop selling
       non-medicine items is not wrongly flagged. A rate outside this set
       (7.5, 2, 1.5 — all seen in real data) is rejected by the portal. */
    var SLABS = [0, 0.25, 3, 5, 12, 18, 28];
    function rate(n) {
        var v = Number(n);
        if (!isFinite(v)) return false;
        for (var i = 0; i < SLABS.length; i++) if (SLABS[i] === v) return true;
        return false;
    }

    function pin(p) { return /^\d{6}$/.test(String(p == null ? '' : p).trim()); }

    /* ── Document number ────────────────────────────────────────────────
       Rule 46: at most 16 characters, alphanumeric with / and - only. A
       bill number the portal will not accept is worth knowing about long
       before the return, because it cannot be changed afterwards. */
    function docNo(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { ok: false, code: 'empty', reason: 'No bill number.' };
        if (s.length > 16) {
            return { ok: false, code: 'length', reason:
                'A bill number may be at most 16 characters — this one has ' + s.length + '.' };
        }
        if (!/^[A-Za-z0-9\/\-]+$/.test(s)) {
            return { ok: false, code: 'chars', reason:
                'A bill number may only contain letters, digits, "/" and "-".' };
        }
        return { ok: true, code: 'ok', value: s };
    }

    /* What this file can never tell you. Quoted in the UI so nobody reads a
       row of green ticks as "the portal will accept this". */
    function notOnlineChecked() {
        return [
            'whether a GSTIN is still active, or was cancelled after the sale',
            'whether a GSTIN belongs to the business named beside it',
            'whether an HSN code is the RIGHT one for that particular product'
        ];
    }

    /* ── Live feedback on an input ──────────────────────────────────────
       One call per field, so the pages stay free of validation plumbing.
       Deliberately NON-BLOCKING: it colours the box and shows the reason,
       and never prevents typing or saving. A shop copying a GSTIN off a
       letterhead that genuinely fails the check digit still has to be able
       to record what the customer gave them; the pre-filing check will
       raise it again before it can do any harm.
    ──────────────────────────────────────────────────────────────────── */
    function attach(el, kind, opts) {
        if (!el || el._mmGstWired) return;
        el._mmGstWired = true;
        opts = opts || {};

        var note = document.createElement('div');
        note.style.cssText = 'font-size:0.72rem;line-height:1.45;margin-top:3px;display:none;';
        if (el.parentNode) el.parentNode.insertBefore(note, el.nextSibling);

        var base = el.style.borderColor || '';
        function check() {
            var v = String(el.value || '').trim();
            if (!v) {                                  // blank is not an error
                note.style.display = 'none';
                el.style.borderColor = base;
                return;
            }
            var r = kind === 'hsn' ? hsn(v) : kind === 'docNo' ? docNo(v) : gstin(v);
            /* Half-typed input is not yet wrong. Only complain once the field
               is long enough that the answer is knowable. */
            var full = kind === 'gstin' ? v.length >= 15 : true;
            if (r.ok) {
                el.style.borderColor = '#a7f3d0';
                note.style.display = 'block';
                note.style.color = '#065f46';
                note.innerHTML = '✓ Valid' + (r.stateName ? ' · ' + r.stateName : '');
            } else if (full) {
                el.style.borderColor = '#fecaca';
                note.style.display = 'block';
                note.style.color = '#991b1b';
                note.innerHTML = '⚠ ' + r.reason;
            } else {
                note.style.display = 'none';
                el.style.borderColor = base;
            }
            if (typeof opts.onChange === 'function') opts.onChange(r);
        }
        el.addEventListener('input', check);
        el.addEventListener('blur', check);
        el._mmGstCheck = check;
        return check;
    }

    window.mmGstValid = {
        gstin: gstin,
        gstinOk: gstinOk,
        checkDigit: checkDigit,
        stateOf: stateOf,
        stateName: stateName,
        STATES: STATES,
        hsn: hsn,
        rate: rate,
        SLABS: SLABS,
        pin: pin,
        docNo: docNo,
        notOnlineChecked: notOnlineChecked,
        attach: attach
    };
})();
