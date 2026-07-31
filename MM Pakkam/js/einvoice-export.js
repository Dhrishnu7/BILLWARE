/* ══════════════════════════════════════════════════════════════════════
   einvoice-export.js — e-invoice (IRN) and e-way bill, as bulk-upload JSON

   WHY THIS SHAPE, AND NOT AN API CALL
   An IRN can only be created by the government's IRP. Calling it live needs
   API credentials, which can never live in a page the customer downloads —
   they would be readable by anyone with the URL. It also usually needs a paid
   GSP account. The portals both accept a JSON FILE instead: the shop uploads
   it at einvoice1.gst.gov.in (or ewaybillgst.gov.in) and gets the IRNs and
   signed QR codes back. Same trade the GSTR-1 export already makes — free,
   no credentials, works today — and it leaves a clean seam if a GSP is ever
   worth paying for: only the transport of this JSON would change.

   WHO ACTUALLY NEEDS IT
     e-invoice   Only B2B supplies, and only above the turnover threshold.
                 Counter sales to an ordinary customer are EXEMPT and are
                 deliberately excluded here — filing them would be wrong, not
                 merely unnecessary. A bill is B2B only when its customer has
                 a valid 15-character GSTIN on their Directory record.
     e-way bill  Movement of goods above a value threshold (₹50,000 in most
                 states). A customer walking out with their own medicines is
                 not a consignment, so nothing is auto-selected: the shop
                 ticks the bills that were actually SENT somewhere.

   THE ARITHMETIC IS NOT THE SAME AS GSTR-1
   GSTR-1 carries full precision and rounds once at the end, because only the
   summary totals are checked. The IRP checks EVERY LINE against the invoice
   total, so here each line is rounded to paise first and the totals are the
   sum of those rounded lines. Doing it the GSTR-1 way produces a file that
   fails validation by a rupee.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var CFG_KEY = 'mm_einvoice_cfg';

    /* The e-way bill threshold is a STATE decision, not a national one — most
       states use ₹50,000, Tamil Nadu exempts intra-state movement below ₹1 lakh.
       So it is a setting the shop confirms, not a constant. */
    var DEFAULT_EWB_THRESHOLD = 50000;

    /* Rates that exist. Same list the GSTR-1 guard uses: a hand-typed 7.5%
       produces a file the portal rejects, and it is far cheaper to catch it
       here than at the filing deadline. */
    var SLABS = { 0: 1, 0.25: 1, 3: 1, 5: 1, 12: 1, 18: 1, 28: 1 };

    /* Unit codes are a closed list (UQC). "STRIP" and "TAB" are not on it, and
       the shop's pack field is free text, so everything is filed as NOS —
       accepted for goods sold by count, which is all a pharmacy sells. */
    var UQC = 'NOS';

    function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function r3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
    function num(n) { return Number(n) || 0; }
    function key(s) { return String(s || '').trim().toLowerCase(); }

    /* GSTIN, properly. The blank-vs-present check is not enough: a real export
       once went out with a 10-character GSTIN and looked fine. */
    var GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
    function validGstin(g) { return GSTIN_RE.test(String(g || '').trim().toUpperCase()); }
    function stateOf(g) {
        var s = String(g || '').trim();
        return /^\d{2}/.test(s) ? s.slice(0, 2) : '';
    }
    function validPin(p) { return /^\d{6}$/.test(String(p || '').trim()); }

    /* Both portals want DD/MM/YYYY. GSTR-1 wants DD-MM-YYYY. They are not
       interchangeable, and a hyphen here is silently accepted then rejected
       at validation, so this is deliberately a separate function. */
    function dmy(d) {
        var p = String(d || '').slice(0, 10).split('-');
        return p.length === 3 && p[0].length === 4 ? p[2] + '/' + p[1] + '/' + p[0] : '';
    }

    /* Batch expiry is free text in the app ("11/27", "Nov 2027", ""). ExpDt is
       optional on the schema, so anything not confidently a date is dropped
       rather than guessed — a wrong expiry on a legal document is worse than
       an absent one. */
    function expDmy(e) {
        var s = String(e || '').trim();
        if (!s) return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dmy(s);
        var m = s.match(/^(\d{1,2})[\/\-](\d{2}|\d{4})$/);   // MM/YY or MM/YYYY
        if (m) {
            var mo = ('0' + m[1]).slice(-2);
            var yr = m[2].length === 2 ? '20' + m[2] : m[2];
            if (Number(mo) < 1 || Number(mo) > 12) return '';
            var last = new Date(Number(yr), Number(mo), 0).getDate();  // expiry = end of that month
            return ('0' + last).slice(-2) + '/' + mo + '/' + yr;
        }
        return '';
    }

    /* Document numbers are constrained: max 16 chars, and the first character
       may not be 0, / or -. "MM-001" passes; a raw "001" does not. */
    function docNoProblem(no) {
        var s = String(no || '').trim();
        if (!s) return 'has no bill number';
        if (s.length > 16) return 'bill number is longer than 16 characters';
        if (/^[0\/\-]/.test(s)) return 'bill number may not start with 0, / or -';
        if (!/^[A-Za-z0-9\/\-]+$/.test(s)) return 'bill number may only contain letters, digits, / and -';
        return '';
    }

    function loadCfg() {
        var cfg = {};
        try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) {}
        if (cfg.ewbThreshold == null || !(Number(cfg.ewbThreshold) > 0)) cfg.ewbThreshold = DEFAULT_EWB_THRESHOLD;
        return cfg;
    }
    function saveCfg(cfg) {
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch (e) {}
    }

    /* Seller identity: the shop profile is the source of truth for what it
       knows, and the modal's own fields fill the two things it has never
       collected (town and PIN). Anything typed in the modal wins, so a shop
       can correct a stale profile without editing it. */
    function seller(extra) {
        var sp = window.mmShopProfile || {};
        var cfg = loadCfg();
        var e = extra || {};
        var gstin = String(e.gstin || cfg.gstin || sp.gstin || '').trim().toUpperCase();
        return {
            gstin: gstin,
            stcd:  stateOf(gstin),
            lglNm: String(e.lglNm || cfg.lglNm || sp.shop_name || '').trim(),
            trdNm: String(e.trdNm || cfg.trdNm || sp.shop_name || '').trim(),
            addr1: String(e.addr1 || cfg.addr1 || sp.address_line1 || '').trim(),
            addr2: String(e.addr2 || cfg.addr2 || sp.address_line2 || '').trim(),
            loc:   String(e.loc   || cfg.loc   || sp.city    || '').trim(),
            pin:   String(e.pin   || cfg.pin   || sp.pincode || '').trim(),
            ph:    String(e.ph    || cfg.ph    || sp.phone   || '').trim().replace(/\D/g, '').slice(-10),
            em:    String(e.em    || cfg.em    || '').trim()
        };
    }

    function sellerProblems(s) {
        var p = [];
        if (!s.gstin) p.push('Your GSTIN is missing — set it in your shop profile.');
        else if (!validGstin(s.gstin)) p.push('Your GSTIN "' + s.gstin + '" is not a valid 15-character GSTIN.');
        if (!s.lglNm) p.push('Your shop name is missing.');
        if (!s.addr1) p.push('Your address is missing.');
        if (!s.loc)   p.push('Your town / city is required on an e-invoice.');
        if (!validPin(s.pin)) p.push('Your 6-digit PIN code is required on an e-invoice.');
        return p;
    }

    /* Customers, indexed the way bills refer to them. Id first: it survives a
       rename, which the name lookup does not. Bills raised before the id link
       existed carry only a name, so both paths stay. */
    function customerIndex() {
        var byId = {}, byName = {}, all = [];
        try {
            (JSON.parse(localStorage.getItem('mm_customers') || '[]') || []).forEach(function (c) {
                var rec = {
                    id: c.id != null ? String(c.id) : '',
                    name: String(c.name || '').trim(),
                    gstin: String(c.gstin || '').trim().toUpperCase(),
                    address: String(c.address || '').trim(),
                    city: String(c.city || '').trim(),
                    pincode: String(c.pincode || '').trim(),
                    phone: String(c.phone || '').trim()
                };
                all.push(rec);
                if (rec.id) byId[rec.id] = rec;
                if (rec.name) byName[key(rec.name)] = rec;
            });
        } catch (e) {}
        return { byId: byId, byName: byName, all: all };
    }

    function buyerOf(bill, idx) {
        var cid = (bill.customerId != null) ? String(bill.customerId)
                : (bill.customer_id != null ? String(bill.customer_id) : '');
        return (cid && idx.byId[cid]) || idx.byName[key(bill.customerName || bill.customer_name || '')] || null;
    }

    function inRange(d, from, to) {
        var s = String(d || '').slice(0, 10);
        if (!s) return false;
        if (from && s < from) return false;
        if (to   && s > to)   return false;
        return true;
    }

    /* ──────────────────────────────────────────────────────────────────
       One bill → the ItemList and ValDtls both documents share.
       Returns { items, val, problems, igst } or null when the bill is empty.
    ────────────────────────────────────────────────────────────────── */
    function linesOf(bill, isInterState) {
        var items = [], problems = [];
        var assVal = 0, cgstVal = 0, sgstVal = 0, igstVal = 0, itemTotal = 0;
        var noHsn = 0, badRate = {};

        (bill.medicines || []).forEach(function (m, i) {
            var total = num(m.total);
            if (!total) return;                       // a zero line is not a supply
            var rate = num(m.gst);
            var qty  = num(m.qty) || 1;

            if (!SLABS[rate]) badRate[rate] = (badRate[rate] || 0) + 1;
            var hsn = String(m.hsn || '').trim();
            if (!hsn) noHsn++;

            /* Round per line, then sum — the IRP checks each line against the
               invoice total, so the totals must be the sum of what was filed,
               not a more precise number that disagrees with it. */
            var ass  = r2(total / (1 + rate / 100));
            var tax  = r2(total - ass);
            var cg = 0, sg = 0, ig = 0;
            if (isInterState) {
                ig = tax;
            } else {
                cg = r2(tax / 2);
                sg = r2(tax - cg);                    // the odd paise lands on SGST, never lost
            }
            var lineVal = r2(ass + cg + sg + ig);

            /* UnitPrice × Qty is validated against TotAmt within ₹1. The app
               stores a post-discount tax-inclusive total, so the pre-tax unit
               price is derived from it and Discount is filed as 0 — inventing
               a gross price and a discount to match would be fabricating two
               numbers the shop never entered. */
            items.push({
                SlNo: String(i + 1),
                PrdDesc: String(m.product || '').slice(0, 300),
                IsServc: 'N',
                HsnCd: hsn,
                Barcde: '',
                Qty: r3(qty),
                FreeQty: 0,
                Unit: UQC,
                UnitPrice: r3(ass / qty),
                TotAmt: ass,
                Discount: 0,
                PreTaxVal: 0,
                AssAmt: ass,
                GstRt: rate,
                IgstAmt: ig,
                CgstAmt: cg,
                SgstAmt: sg,
                CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0,
                StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0,
                OthChrg: 0,
                TotItemVal: lineVal,
                BchDtls: (function () {
                    var b = String(m.batch || '').trim();
                    if (!b) return undefined;         // optional; omitted rather than sent empty
                    var d = { Nm: b.slice(0, 20) };
                    var ed = expDmy(m.exp);
                    if (ed) d.ExpDt = ed;
                    return d;
                })()
            });

            assVal += ass; cgstVal += cg; sgstVal += sg; igstVal += ig; itemTotal += lineVal;
        });

        if (!items.length) return null;

        /* The bill's own total may differ by a few paise from the sum of its
           lines — the till applies a round-off (v202). That difference is what
           RndOffAmt is for. A gap of more than a rupee is not rounding, it is a
           disagreement, and is reported rather than quietly absorbed. */
        var billTotal = num(bill.grandTotal);
        var sum = r2(itemTotal);
        var rnd = billTotal ? r2(billTotal - sum) : 0;
        if (Math.abs(rnd) > 1) {
            problems.push('bill total ₹' + billTotal.toFixed(2) + ' does not match its lines (₹' + sum.toFixed(2) + ')');
            rnd = 0;
        }

        if (noHsn) problems.push(noHsn + ' line(s) have no HSN code');
        Object.keys(badRate).forEach(function (r) {
            problems.push('GST rate ' + r + '% does not exist (' + badRate[r] + ' line(s))');
        });

        return {
            items: items,
            problems: problems,
            val: {
                AssVal: r2(assVal),
                CgstVal: r2(cgstVal),
                SgstVal: r2(sgstVal),
                IgstVal: r2(igstVal),
                CesVal: 0, StCesVal: 0,
                Discount: 0, OthChrg: 0,
                RndOffAmt: rnd,
                TotInvVal: r2(sum + rnd)
            }
        };
    }

    /* ──────────────────────────────────────────────────────────────────
       build(opts)
         from, to        date range (YYYY-MM-DD)
         seller          overrides for the shop's own details
         ewbThreshold    value above which a bill is offered as a consignment
         transport       { [billNo]: { on, distance, vehicleNo, transMode,
                                       transporterId, transporterName } }
       Returns everything the modal needs to explain itself, plus the two
       JSON payloads. Nothing is written to disk here.
    ────────────────────────────────────────────────────────────────── */
    function build(opts) {
        opts = opts || {};
        var s = seller(opts.seller);
        var sProbs = sellerProblems(s);
        var threshold = num(opts.ewbThreshold) || loadCfg().ewbThreshold;
        var transport = opts.transport || {};

        var bills = [];
        try { bills = JSON.parse(localStorage.getItem('mm_sales') || '[]') || []; } catch (e) {}
        bills = bills.filter(function (b) { return inRange(b.date, opts.from, opts.to); });

        var idx = customerIndex();
        var rows = [], einvoices = [], ewbs = [];
        var needBuyerDetails = {};      // customer id/name -> record, deduped
        var b2bCount = 0, readyCount = 0, blockedCount = 0, b2bValue = 0;
        var ewbCandidates = 0, ewbBuilt = 0;

        bills.forEach(function (bill) {
            var buyer = buyerOf(bill, idx);
            var ctin = buyer ? buyer.gstin : '';
            var isB2B = validGstin(ctin);
            var value = num(bill.grandTotal);
            var name = String(bill.customerName || bill.customer_name || (buyer && buyer.name) || '').trim();

            /* Counter sales are exempt from e-invoicing. They are still listed
               when they are large enough to need an e-way bill, because that
               obligation follows the goods, not the buyer's registration. */
            var overThreshold = value > threshold;
            if (!isB2B && !overThreshold) return;

            var interState = isB2B && stateOf(ctin) && s.stcd && stateOf(ctin) !== s.stcd;
            var built = linesOf(bill, interState);
            var problems = built ? built.problems.slice() : ['bill has no items'];

            var dp = docNoProblem(bill.billNo);
            if (dp) problems.push(dp);
            if (!dmy(bill.date)) problems.push('bill date is unreadable');

            if (isB2B) {
                b2bCount++;
                b2bValue += value;
                if (!buyer.city || !validPin(buyer.pincode) || !buyer.address) {
                    problems.push('buyer address / town / PIN is incomplete');
                    var k = buyer.id || key(buyer.name);
                    if (k) needBuyerDetails[k] = buyer;
                }
            }

            var row = {
                billNo: String(bill.billNo || ''),
                date: String(bill.date || '').slice(0, 10),
                customer: name || '(counter sale)',
                ctin: ctin,
                isB2B: isB2B,
                value: r2(value),
                interState: !!interState,
                overThreshold: overThreshold,
                problems: problems,
                /* Kept apart from `problems` because they stop only the e-way
                   bill. A missing delivery address has no bearing on whether
                   the e-invoice can be filed. */
                ewbProblems: [],
                /* What the destination would be, so the form can show it
                   rather than make the shop guess what it is about to file. */
                toPlace: (buyer && buyer.city) || '',
                toPin: (buyer && validPin(buyer.pincode)) ? buyer.pincode : ''
            };
            rows.push(row);

            if (!built) { if (isB2B) blockedCount++; return; }

            var docDtls = {
                Typ: 'INV',
                No: String(bill.billNo || '').trim(),
                Dt: dmy(bill.date)
            };

            /* ── e-invoice: B2B only, and only when nothing is outstanding ── */
            if (isB2B) {
                if (problems.length || sProbs.length) {
                    blockedCount++;
                } else {
                    readyCount++;
                    einvoices.push({
                        Version: '1.1',
                        TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', EcmGstin: null, IgstOnIntra: 'N' },
                        DocDtls: docDtls,
                        SellerDtls: {
                            Gstin: s.gstin, LglNm: s.lglNm, TrdNm: s.trdNm || s.lglNm,
                            Addr1: s.addr1, Addr2: s.addr2 || undefined,
                            Loc: s.loc, Pin: Number(s.pin), Stcd: s.stcd,
                            Ph: s.ph || undefined, Em: s.em || undefined
                        },
                        BuyerDtls: {
                            Gstin: ctin, LglNm: buyer.name, TrdNm: buyer.name,
                            Pos: stateOf(ctin),
                            Addr1: buyer.address, Loc: buyer.city,
                            Pin: Number(buyer.pincode), Stcd: stateOf(ctin),
                            Ph: buyer.phone ? buyer.phone.replace(/\D/g, '').slice(-10) : undefined
                        },
                        ItemList: built.items,
                        ValDtls: built.val
                    });
                }
            }

            /* ── e-way bill: only what the shop ticked ────────────────────
               Never automatic. Whether goods moved is a fact about the day,
               not about the bill, and generating an unnecessary e-way bill
               creates a document the shop then has to cancel. */
            if (overThreshold) ewbCandidates++;
            var t = transport[row.billNo];
            if (t && t.on) {
                /* A consignment to an unregistered buyer is perfectly legal —
                   it files as URP — so only the bill's OWN problems block it,
                   never the absence of a buyer GSTIN. */
                /* Where the goods are going. For a registered buyer this is on
                   their record; for a counter sale nothing in the app knows it,
                   so it is asked for. Defaulting to the shop's own PIN would
                   file a consignment that never left the premises. */
                var toPlace = String(t.toPlace || '').trim() || row.toPlace;
                var typedPin = String(t.toPin || '').trim();
                var toPin = validPin(typedPin) ? typedPin : row.toPin;
                if (typedPin && !validPin(typedPin)) row.ewbProblems.push('destination PIN must be 6 digits');
                else if (!toPin) row.ewbProblems.push('a destination PIN is needed for the e-way bill');
                if (!toPlace) row.ewbProblems.push('a destination town is needed for the e-way bill');
                row.toPlace = toPlace; row.toPin = toPin;

                if (!problems.length && !sProbs.length && !row.ewbProblems.length) {
                    ewbBuilt++;
                    var toState = isB2B ? stateOf(ctin) : s.stcd;
                    ewbs.push({
                        userGstin: s.gstin,
                        supplyType: 'O',
                        subSupplyType: '1',              // 1 = Supply
                        docType: 'INV',
                        docNo: docDtls.No,
                        docDate: docDtls.Dt,
                        fromGstin: s.gstin,
                        fromTrdName: s.trdNm || s.lglNm,
                        fromAddr1: s.addr1, fromAddr2: s.addr2 || '',
                        fromPlace: s.loc, fromPincode: Number(s.pin),
                        fromStateCode: Number(s.stcd), actFromStateCode: Number(s.stcd),
                        /* URP is the portal's own code for an unregistered
                           buyer — a blank GSTIN is rejected, "URP" is not. */
                        toGstin: isB2B ? ctin : 'URP',
                        toTrdName: row.customer,
                        toAddr1: (buyer && buyer.address) || toPlace,
                        toAddr2: '',
                        toPlace: toPlace,
                        toPincode: Number(toPin),
                        toStateCode: Number(toState), actToStateCode: Number(toState),
                        transactionType: 1,
                        /* The portal checks totInvValue against the sum of the
                           value + tax fields. The till's round-off lives in the
                           e-invoice's RndOffAmt; without it here the two sides
                           disagree by that amount and the upload is rejected.
                           otherValue is the e-way schema's slot for it, and it
                           takes a negative. */
                        otherValue: built.val.RndOffAmt,
                        totalValue: built.val.AssVal,
                        cgstValue: built.val.CgstVal,
                        sgstValue: built.val.SgstVal,
                        igstValue: built.val.IgstVal,
                        cessValue: 0, cessNonAdvolValue: 0,
                        totInvValue: built.val.TotInvVal,
                        transporterId: String(t.transporterId || ''),
                        transporterName: String(t.transporterName || ''),
                        transDocNo: String(t.transDocNo || ''),
                        transDocDate: String(t.transDocDate || ''),
                        transMode: String(t.transMode || '1'),   // 1 = road
                        /* 0 means "work it out from the PIN codes" — better than
                           a guessed number, which is checked against the map. */
                        transDistance: String(num(t.distance) || 0),
                        vehicleNo: String(t.vehicleNo || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
                        vehicleType: 'R',
                        itemList: built.items.map(function (it) {
                            var half = it.GstRt / 2;
                            return {
                                productName: it.PrdDesc.slice(0, 100),
                                productDesc: it.PrdDesc.slice(0, 100),
                                hsnCode: Number(it.HsnCd) || 0,
                                quantity: it.Qty,
                                qtyUnit: UQC,
                                cgstRate: it.IgstAmt ? 0 : half,
                                sgstRate: it.IgstAmt ? 0 : half,
                                igstRate: it.IgstAmt ? it.GstRt : 0,
                                cessRate: 0, cessNonadvol: 0,
                                taxableAmount: it.AssAmt
                            };
                        })
                    });
                }
            }
        });

        rows.sort(function (a, b) { return (a.date + a.billNo).localeCompare(b.date + b.billNo); });

        return {
            einvoices: einvoices,
            ewbs: ewbs,
            rows: rows,
            seller: s,
            sellerProblems: sProbs,
            threshold: threshold,
            needBuyerDetails: Object.keys(needBuyerDetails).map(function (k) { return needBuyerDetails[k]; }),
            summary: {
                billsInPeriod: bills.length,
                listed: rows.length,
                b2bBills: b2bCount,
                b2bValue: r2(b2bValue),
                ready: readyCount,
                blocked: blockedCount,
                ewbCandidates: ewbCandidates,
                ewbBuilt: ewbBuilt,
                einvoiceValue: r2(einvoices.reduce(function (t, e) { return t + e.ValDtls.TotInvVal; }, 0))
            }
        };
    }

    window.mmEinvoice = {
        build: build,
        loadCfg: loadCfg,
        saveCfg: saveCfg,
        validGstin: validGstin,
        validPin: validPin,
        stateOf: stateOf,
        DEFAULT_EWB_THRESHOLD: DEFAULT_EWB_THRESHOLD
    };
})();
