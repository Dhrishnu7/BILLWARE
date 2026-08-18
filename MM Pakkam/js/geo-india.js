/* ══════════════════════════════════════════════════════════════════════════
   WHERE A SHOP ACTUALLY IS.

   shop_profiles has stored `city` (free text) and `pincode` since the e-invoice
   work. Neither can group a report:

     · city is typed by hand, so "Chennai", "chennai" and "Madras" are three
       different places and a district ranking built on it is nonsense
     · pincode groups perfectly and reads as nothing — nobody thinks in 600028

   So district and state are their own confirmed fields. This file's job is to
   SUGGEST them, never to set them. A global reference list may propose; the
   shop decides. That matters more here than it looks: a pincode prefix can
   straddle two districts, and districts get split and renamed by the state
   government faster than any bundled list gets updated.

   ── THE TWO SOURCES FOR STATE, AND WHY BOTH ──────────────────────────────
   1. GSTIN — the first two digits ARE the state code. Authoritative, because
      the shop's registration says so. Read via mmGstValid, never re-listed
      here: one state table, in js/gst-validate.js.
   2. PINCODE — the first two digits give the postal circle. Available even for
      a shop with no GST registration, which several small ones are.

   When both exist they are compared and a MISMATCH IS REPORTED, not resolved.
   A shop registered in Karnataka billing from a Tamil Nadu pincode is either a
   typo or a branch, and both are things a human should look at. Silently
   picking one would bury it.

   ── HONEST COVERAGE ──────────────────────────────────────────────────────
   The district table below is seeded for the south, because that is where
   these shops are. Everywhere else returns NO SUGGESTION and the shop simply
   types the district — which is a worse experience but a correct one. A wrong
   suggestion that someone accepts without reading is far more expensive than
   an empty box, because it is invisible afterwards.

   Depends on: js/gst-validate.js (for mmGstValid.STATES / stateOf).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* Pincode first TWO digits -> state / UT.
       This is the postal circle, which is not always identical to the political
       state — a circle can serve a neighbouring UT. The known cases are handled
       by the three-digit table below, which wins when it matches. */
    var PIN2_STATE = {
        11: 'Delhi',
        12: 'Haryana', 13: 'Haryana',
        14: 'Punjab', 15: 'Punjab', 16: 'Punjab',
        17: 'Himachal Pradesh',
        18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir',
        20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh',
        23: 'Uttar Pradesh', 24: 'Uttar Pradesh', 25: 'Uttar Pradesh',
        26: 'Uttar Pradesh', 27: 'Uttar Pradesh', 28: 'Uttar Pradesh',
        30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan',
        34: 'Rajasthan',
        36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat',
        40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra',
        43: 'Maharashtra', 44: 'Maharashtra',
        45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh',
        48: 'Madhya Pradesh',
        49: 'Chhattisgarh',
        50: 'Telangana',
        51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh',
        56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka',
        60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu',
        63: 'Tamil Nadu', 64: 'Tamil Nadu', 65: 'Tamil Nadu', 66: 'Tamil Nadu',
        67: 'Kerala', 68: 'Kerala', 69: 'Kerala',
        70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal',
        73: 'West Bengal', 74: 'West Bengal',
        75: 'Odisha', 76: 'Odisha', 77: 'Odisha',
        78: 'Assam',
        79: 'Arunachal Pradesh',
        80: 'Bihar', 81: 'Bihar', 82: 'Bihar', 83: 'Bihar',
        84: 'Bihar', 85: 'Bihar'
    };

    /* Pincode first THREE digits -> district. The postal "sorting district",
       which usually but NOT always equals the revenue district.

       Only prefixes we are confident about are listed. A prefix that genuinely
       spans two districts carries `spans: true` — the suggestion is still made
       (it is right more often than not) but the UI must show it as a guess and
       the shop must confirm it. Anything not listed returns nothing at all.

       Seeded for Tamil Nadu, Puducherry and Kerala. Add more only from a real
       source, never from memory — a plausible-looking wrong district is the
       one error nobody catches. */
    var PIN3 = {
        600: ['Chennai', 'Tamil Nadu'],
        601: ['Tiruvallur', 'Tamil Nadu', 1],
        602: ['Tiruvallur', 'Tamil Nadu', 1],
        603: ['Chengalpattu', 'Tamil Nadu'],
        604: ['Tiruvannamalai', 'Tamil Nadu'],
        605: ['Puducherry', 'Puducherry', 1],
        606: ['Tiruvannamalai', 'Tamil Nadu', 1],
        607: ['Cuddalore', 'Tamil Nadu'],
        608: ['Cuddalore', 'Tamil Nadu'],
        609: ['Karaikal', 'Puducherry', 1],
        610: ['Tiruvarur', 'Tamil Nadu'],
        611: ['Nagapattinam', 'Tamil Nadu'],
        612: ['Thanjavur', 'Tamil Nadu'],
        613: ['Thanjavur', 'Tamil Nadu'],
        614: ['Pudukkottai', 'Tamil Nadu', 1],
        620: ['Tiruchirappalli', 'Tamil Nadu'],
        621: ['Tiruchirappalli', 'Tamil Nadu', 1],
        622: ['Pudukkottai', 'Tamil Nadu'],
        623: ['Ramanathapuram', 'Tamil Nadu'],
        624: ['Dindigul', 'Tamil Nadu'],
        625: ['Madurai', 'Tamil Nadu'],
        626: ['Virudhunagar', 'Tamil Nadu'],
        627: ['Tirunelveli', 'Tamil Nadu'],
        628: ['Thoothukudi', 'Tamil Nadu'],
        629: ['Kanniyakumari', 'Tamil Nadu'],
        630: ['Sivaganga', 'Tamil Nadu'],
        631: ['Ranipet', 'Tamil Nadu', 1],
        632: ['Vellore', 'Tamil Nadu'],
        635: ['Krishnagiri', 'Tamil Nadu', 1],
        636: ['Salem', 'Tamil Nadu'],
        637: ['Namakkal', 'Tamil Nadu'],
        638: ['Erode', 'Tamil Nadu'],
        639: ['Karur', 'Tamil Nadu'],
        641: ['Coimbatore', 'Tamil Nadu'],
        642: ['Tiruppur', 'Tamil Nadu', 1],
        643: ['The Nilgiris', 'Tamil Nadu'],
        682: ['Ernakulam', 'Kerala'],
        695: ['Thiruvananthapuram', 'Kerala']
    };

    /* Districts offered as a datalist once the state is known. A datalist
       SUGGESTS and still accepts anything typed, so a district we have not
       heard of — a new one, a renamed one — is never unenterable. That is the
       whole reason it is not a <select>.

       Listed only for states we can state confidently. An unlisted state gives
       a plain text box, which is honest. */
    var DISTRICTS = {
        'Tamil Nadu': ['Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore',
            'Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram','Kanniyakumari',
            'Karur','Krishnagiri','Madurai','Mayiladuthurai','Nagapattinam','Namakkal',
            'Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem','Sivaganga',
            'Tenkasi','Thanjavur','The Nilgiris','Theni','Thoothukudi','Tiruchirappalli',
            'Tirunelveli','Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur',
            'Vellore','Viluppuram','Virudhunagar'],
        'Puducherry': ['Puducherry','Karaikal','Mahe','Yanam'],
        'Kerala': ['Alappuzha','Ernakulam','Idukki','Kannur','Kasaragod','Kollam',
            'Kottayam','Kozhikode','Malappuram','Palakkad','Pathanamthitta',
            'Thiruvananthapuram','Thrissur','Wayanad']
    };

    function _clean(s) { return String(s === null || s === undefined ? '' : s).trim(); }

    /* State from the GSTIN's first two digits, via the ONE state table we keep
       (js/gst-validate.js). Returns '' if that file has not loaded or the code
       is not a real state — never a guess. */
    function stateFromGstin(gstin) {
        var g = _clean(gstin).toUpperCase();
        if (g.length < 2) return '';
        var api = window.mmGstValid;
        if (!api || !api.STATES) return '';
        return api.STATES[g.slice(0, 2)] || '';
    }

    function stateFromPin(pincode) {
        var p = _clean(pincode).replace(/\s/g, '');
        if (!/^[1-9][0-9]{5}$/.test(p)) return '';
        var three = PIN3[Number(p.slice(0, 3))];
        if (three) return three[1];
        return PIN2_STATE[Number(p.slice(0, 2))] || '';
    }

    function districtFromPin(pincode) {
        var p = _clean(pincode).replace(/\s/g, '');
        if (!/^[1-9][0-9]{5}$/.test(p)) return null;
        var hit = PIN3[Number(p.slice(0, 3))];
        if (!hit) return null;
        return { district: hit[0], state: hit[1], spans: !!hit[2] };
    }

    function districtsFor(state) {
        return (DISTRICTS[_clean(state)] || []).slice();
    }

    /**
     * The whole suggestion, in one call, for a shop's setup/edit form and for
     * the Super Admin backfill panel.
     *
     * Returns everything it worked out AND where each part came from, because
     * the form has to be able to say "we think Coimbatore, from your pincode"
     * rather than silently filling a box. A pre-filled box nobody can explain
     * is a box nobody checks.
     *
     *   { state, stateSource, district, districtSource, districtIsGuess,
     *     conflict }
     *
     * `conflict` is set when the GSTIN and the pincode disagree about the
     * state. It is NEVER resolved here: both answers are handed back with the
     * GSTIN's taken as `state` (it is the registered fact) and the
     * disagreement reported so a person can look at it.
     */
    function suggest(pincode, gstin) {
        var byGst = stateFromGstin(gstin);
        var byPin = stateFromPin(pincode);
        var d = districtFromPin(pincode);

        var out = {
            state: byGst || byPin || '',
            stateSource: byGst ? 'GSTIN' : (byPin ? 'pincode' : ''),
            district: d ? d.district : '',
            districtSource: d ? 'pincode' : '',
            districtIsGuess: !!(d && d.spans),
            conflict: null
        };

        if (byGst && byPin && byGst !== byPin) {
            out.conflict = {
                gstin: byGst,
                pincode: byPin,
                message: 'The GSTIN says ' + byGst + ' but the pincode is in ' +
                         byPin + '. One of them is wrong, or this shop bills ' +
                         'from a different state than it is registered in.'
            };
            /* The pincode is what the district guess came from, so if it
               disagrees with the registration the district is not trustworthy
               either. Withhold it rather than offer it. */
            out.district = '';
            out.districtSource = '';
        }
        return out;
    }

    window.mmGeo = {
        suggest: suggest,
        stateFromGstin: stateFromGstin,
        stateFromPin: stateFromPin,
        districtFromPin: districtFromPin,
        districtsFor: districtsFor,
        states: function () { return Object.keys(DISTRICTS); },
        /* Exposed so a test can prove the tables are actually being read,
           rather than a lookup quietly returning '' for everything. */
        _tables: function () { return { PIN2_STATE: PIN2_STATE, PIN3: PIN3, DISTRICTS: DISTRICTS }; }
    };
})();
