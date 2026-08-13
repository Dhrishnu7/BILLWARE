/* ─────────────────────────────────────────────────────────────
   BILLWARE MIGRATION ENGINE

   Bringing a shop's whole business across from whatever they used
   before. This is the difference between "shifting house with the
   furniture" and "start again from nothing", and it decides most
   sales — nobody retypes 150 khata customers to try new software.

   ── Pure on purpose ──
   Nothing here touches the DOM, the network or localStorage. It
   turns a spreadsheet into a PLAN, and report.html executes the
   plan. That is what lets the whole thing be tested against fake
   writers, and it is why the preview the shop approves is built by
   exactly the code that later does the work.

   ── The three rules everything obeys ──
   1. NEVER GUESS A COLUMN SILENTLY. Old software exports headers we
      have never seen. Auto-detection only ever SUGGESTS; the shop
      confirms every field, and an unmapped field is visibly unmapped
      rather than quietly empty.
   2. NOTHING IS WRITTEN UNTIL THE PREVIEW IS ACCEPTED. The file is
      the one document the shop cannot check line by line, so it gets
      no authority. Counts and money totals are shown first.
   3. RUNNING IT TWICE MUST NOT DOUBLE ANYTHING. A migration gets
      re-run — the first attempt half-failed, the file was corrected,
      someone clicked twice. Every kind carries a stable identity so
      the second run recognises what the first one did.
───────────────────────────────────────────────────────────── */
(function () {
'use strict';

/* ── Normalising ─────────────────────────────────────────────── */

function norm(s) {
    return String(s == null ? '' : s).trim();
}
/* Header comparison key: case, spaces, dots and underscores all vary
   between exports of the same field ("M.R.P", "mrp", "MRP ", "M_R_P"). */
function hkey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}
/* A person/firm identity. Names arrive with wild spacing and case;
   two rows for "RAVI  KUMAR" and "Ravi Kumar" are one person. */
function idkey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/* Money out of a spreadsheet cell. Handles ₹, commas, Indian
   grouping, trailing CR/DR, and brackets for negatives — all of
   which appear in real exports.
   Returns null (not 0) when there is genuinely no number: an empty
   balance cell means "no opening balance", and 0 would state one. */
function money(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/\bcr\b/i.test(s)) neg = true;              // credit = they owe us less
    s = s.replace(/[^0-9.\-]/g, '');
    if (!s || s === '-' || s === '.') return null;
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
}

function intOf(v) {
    const n = money(v);
    return n == null ? null : Math.round(n);
}

/* A phone number as digits. Old systems store "+91 98765 43210",
   "098765-43210", or a number Excel helpfully turned into 9.87654e9.
   Keep the last 10 digits — that is the Indian mobile. */
function phone(v) {
    if (v == null) return '';
    let s = String(v).trim();
    if (/e\+/i.test(s)) { const n = Number(s); if (isFinite(n)) s = String(Math.round(n)); }
    const d = s.replace(/\D/g, '');
    if (!d) return '';
    return d.length > 10 ? d.slice(-10) : d;
}

/* Expiry. Pharmacy exports use MM/YY, MM/YYYY, YYYY-MM, "Mar-26",
   and occasionally a full date. Billware stores YYYY-MM.
   An unreadable expiry is returned as '' and REPORTED, never
   guessed — a wrong expiry either dumps sellable stock or sells an
   expired strip, and both are worse than a blank the shop fixes. */
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
function expiry(v) {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    let m;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/)))            return ym(+m[1], +m[2]);
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/]\d{1,2}$/))) return ym(+m[1], +m[2]);
    if ((m = s.match(/^(\d{1,2})[-/](\d{2})$/)))            return ym(yr(+m[2]), +m[1]);
    if ((m = s.match(/^(\d{1,2})[-/](\d{4})$/)))            return ym(+m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/))) return ym(yr(+m[3]), +m[2]);
    if ((m = s.match(/^([a-z]{3,4})[-\s/]*(\d{2,4})$/i))) {
        const mo = MONTHS[m[1].toLowerCase()];
        if (mo) return ym(yr(+m[2]), mo);
    }
    return '';
    function yr(y) { return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; }
    function ym(y, mo) {
        if (!(mo >= 1 && mo <= 12) || !(y >= 1900 && y <= 2199)) return '';
        return y + '-' + String(mo).padStart(2, '0');
    }
}

/* ── What each kind of data is made of ────────────────────────
   `syn` are header spellings seen in real exports (Marg, Tally,
   Excel sheets a shop keeps by hand). They only ever SUGGEST.
   `req` fields must be mapped before the import can run.
─────────────────────────────────────────────────────────────── */
const KINDS = {
    customers: {
        label: 'Customers  (and what they owe you)',
        hint:  'Your khata list. This is the one that matters most.',
        fields: [
            { key:'name',    label:'Customer name', req:true,  type:'text',
              syn:['name','customername','customer','partyname','party','accountname','ledgername','account'] },
            { key:'phone',   label:'Phone',         type:'phone',
              syn:['phone','mobile','mobileno','contact','contactno','phoneno','cell'] },
            { key:'address', label:'Address',       type:'text',
              syn:['address','addr','area','place','city','town'] },
            { key:'gstin',   label:'GSTIN',         type:'text',
              syn:['gstin','gstno','gst','gstinno','taxno'] },
            { key:'balance', label:'Amount they owe you', type:'money',
              syn:['balance','outstanding','due','dues','closingbalance','closing','amount','amountdue',
                   'pending','pendingamount','oldbalance','openingbalance','opening','debit','receivable','bal'] }
        ]
    },
    suppliers: {
        label: 'Suppliers  (and what you owe them)',
        hint:  'Distributors, their details, and any balance carried over.',
        fields: [
            { key:'name',    label:'Supplier name', req:true, type:'text',
              syn:['name','suppliername','supplier','firm','firmname','partyname','party','distributor','vendor','company','ledgername'] },
            { key:'phone',   label:'Phone',   type:'phone', syn:['phone','mobile','mobileno','contact','contactno','phoneno'] },
            { key:'gstin',   label:'GSTIN',   type:'text',  syn:['gstin','gstno','gst','gstinno','tinno','tin'] },
            { key:'address', label:'Address', type:'text',  syn:['address','addr','area','city','town','place'] },
            /* v397. Stored on the supplier and read only by the balance
               formula — it never becomes a purchase or a payment, so it
               cannot touch stock, GST, the till or the P&L. */
            { key:'balance', label:'Amount you owe them', type:'money',
              syn:['balance','outstanding','due','dues','closingbalance','closing','payable','amount','amountdue',
                   'pending','pendingamount','oldbalance','openingbalance','opening','credit','bal'] }
        ]
    },
    doctors: {
        label: 'Doctors',
        hint:  'Prescribers you name on Schedule H bills.',
        fields: [
            { key:'name',   label:'Doctor name', req:true, type:'text',
              syn:['name','doctorname','doctor','drname','dr','prescriber','physician'] },
            { key:'phone',  label:'Phone',       type:'phone', syn:['phone','mobile','mobileno','contact','contactno'] },
            { key:'clinic', label:'Clinic / hospital', type:'text',
              syn:['clinic','hospital','clinicname','address','place','institution'] },
            { key:'regNo',  label:'Registration no', type:'text',
              syn:['regno','registration','registrationno','regdno','mcino','mci','councilno'] }
        ]
    },
    stock: {
        label: 'Stock on the shelf  (with batch & expiry)',
        hint:  'Your closing stock from the old system. Comes in as opening stock.',
        fields: [
            { key:'productName', label:'Medicine name', req:true, type:'text',
              syn:['productname','product','itemname','item','medicine','medicinename','name','description',
                   'itemdesc','particulars','drugname','brand'] },
            { key:'batchNo',  label:'Batch no', type:'text',
              syn:['batchno','batch','batchnumber','btno','bno','lot','lotno','batchcode'] },
            { key:'expireDate', label:'Expiry', type:'expiry',
              syn:['expiry','expirydate','expdate','exp','expdt','expiredate','edate','expmonth'] },
            { key:'quantity', label:'Quantity', req:true, type:'int',
              syn:['quantity','qty','stock','closingqty','closingstock','balqty','balance','nos','units','pcs'] },
            { key:'pack',     label:'Pack size', type:'int',
              syn:['pack','packing','packsize','unitperpack','strip','conv','packqty'] },
            { key:'mrp',      label:'MRP', type:'money',
              syn:['mrp','mrpvalue','maxretailprice','retailprice','rrp'] },
            { key:'rate',     label:'Purchase rate', type:'money',
              syn:['rate','purchaserate','ptr','cost','costprice','buyingrate','netrate','prate'] },
            { key:'gst',      label:'GST %', type:'money',
              syn:['gst','gstpercent','gstrate','tax','taxpercent','taxrate','igst','vat'] },
            { key:'hsn',      label:'HSN code', type:'text',
              syn:['hsn','hsncode','hsnsac','sac','hsnno'] }
        ]
    },
    barcodes: {
        label: 'Barcodes',
        hint:  'So scanning works from day one instead of being rebuilt.',
        fields: [
            { key:'barcode',     label:'Barcode', req:true, type:'text',
              syn:['barcode','bar','code','eancode','ean','upc','scancode','barcodeno'] },
            { key:'productName', label:'Medicine name', req:true, type:'text',
              syn:['productname','product','itemname','item','medicine','name','description'] }
        ]
    }
};

/* ── CSV ──────────────────────────────────────────────────────
   Quoted fields, embedded commas and doubled quotes all appear in
   exported party names ("SUN PHARMA, MUMBAI"). Delimiter is sniffed
   because Indian exports are sometimes semicolon- or tab-separated.
─────────────────────────────────────────────────────────────── */
function sniffDelimiter(text) {
    const line = String(text || '').split(/\r?\n/).find(l => l.trim()) || '';
    const counts = [[',', 0], [';', 0], ['\t', 0], ['|', 0]];
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (!inQ) counts.forEach(p => { if (c === p[0]) p[1]++; });
    }
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] ? counts[0][0] : ',';
}

function parseCsv(text, delim) {
    const d = delim || sniffDelimiter(text);
    const src = String(text || '').replace(/^﻿/, '');   // strip BOM
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inQ) {
            if (c === '"') {
                if (src[i + 1] === '"') { cell += '"'; i++; }
                else inQ = false;
            } else cell += c;
        } else if (c === '"') inQ = true;
        else if (c === d) { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (c === '\r') { /* handled by \n */ }
        else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => norm(x) !== ''));
}

/* The header row is not always row 1 — exports carry a title, the
   shop's name, a date range. Take the first row where at least half
   the cells are non-empty text and none looks like a pure number. */
function findHeaderRow(rows) {
    const limit = Math.min(rows.length, 12);
    for (let i = 0; i < limit; i++) {
        const r = rows[i] || [];
        const filled = r.filter(c => norm(c) !== '');
        if (filled.length < 2) continue;
        const numeric = filled.filter(c => money(c) != null && /^[\s₹,.\d()-]+$/.test(String(c)));
        if (numeric.length <= Math.floor(filled.length / 2)) return i;
    }
    return 0;
}

/* ── Auto-detection: a SUGGESTION, never a decision ───────────── */
function autoMap(headers, kind) {
    const spec = KINDS[kind];
    const map = {};
    if (!spec) return map;
    const hk = (headers || []).map(hkey);
    const taken = {};
    spec.fields.forEach(f => {
        // Exact synonym match first — far safer than a substring.
        for (let i = 0; i < hk.length; i++) {
            if (taken[i] || !hk[i]) continue;
            if (f.syn.indexOf(hk[i]) !== -1) { map[f.key] = i; taken[i] = 1; return; }
        }
        // Then a contains-match, longest synonym first so "mrp" cannot
        // claim a column that "maxretailprice" describes better.
        const syns = f.syn.slice().sort((a, b) => b.length - a.length);
        for (let s = 0; s < syns.length; s++) {
            for (let i = 0; i < hk.length; i++) {
                if (taken[i] || !hk[i]) continue;
                if (hk[i].indexOf(syns[s]) !== -1) { map[f.key] = i; taken[i] = 1; return; }
            }
        }
        map[f.key] = -1;      // visibly unmapped, never silently blank
    });
    return map;
}

/* ── Rows → records ───────────────────────────────────────────
   `issues` are per-row and per-field, so the preview can say "batch
   missing on 4 rows" and point at them, rather than failing the file.
─────────────────────────────────────────────────────────────── */
function buildRecords(rows, headerIdx, mapping, kind) {
    const spec = KINDS[kind];
    const out = { records: [], issues: [] };
    if (!spec) return out;

    const get = (row, key) => {
        const i = mapping[key];
        return (i == null || i < 0) ? '' : (row[i] == null ? '' : row[i]);
    };

    for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        if (!row.some(c => norm(c) !== '')) continue;
        const rec = { _row: r + 1 };
        let bad = false;

        spec.fields.forEach(f => {
            const raw = get(row, f.key);
            let v;
            switch (f.type) {
                case 'money':  v = money(raw); break;
                case 'int':    v = intOf(raw); break;
                case 'phone':  v = phone(raw); break;
                case 'expiry':
                    v = expiry(raw);
                    if (!v && norm(raw)) {
                        out.issues.push({ row: r + 1, field: f.key,
                            msg: 'Could not read the expiry "' + norm(raw) + '" — left blank, fix it after import' });
                    }
                    break;
                default:       v = norm(raw);
            }
            if (f.req) {
                const empty = (f.type === 'int' || f.type === 'money') ? (v == null) : !v;
                if (empty) {
                    bad = true;
                    out.issues.push({ row: r + 1, field: f.key, fatal: true,
                        msg: f.label + ' is empty — this row will be skipped' });
                }
            }
            rec[f.key] = v;
        });

        if (!bad) out.records.push(rec);
    }
    return out;
}

/* ── The plan ─────────────────────────────────────────────────
   What WOULD happen, computed against what is already in the shop.
   report.html shows this and only writes if the owner accepts it.
─────────────────────────────────────────────────────────────── */
function plan(records, existing, kind) {
    const res = { create: [], skip: [], kind: kind, money: 0, count: 0 };
    const seen = {};
    const have = {};
    (existing || []).forEach(e => { const k = keyOf(e, kind); if (k) have[k] = e; });

    (records || []).forEach(rec => {
        const k = keyOf(rec, kind);
        if (!k) return;
        if (seen[k]) {
            res.skip.push({ rec: rec, why: 'appears twice in the file' });
            return;
        }
        seen[k] = 1;
        if (have[k]) {
            res.skip.push({ rec: rec, why: 'already in Billware', existing: have[k] });
            return;
        }
        res.create.push(rec);
        if ((kind === 'customers' || kind === 'suppliers') && rec.balance) res.money += rec.balance;
        if (kind === 'stock') res.money += (Number(rec.quantity) || 0) * (Number(rec.rate) || 0);
    });
    res.count = res.create.length;
    return res;
}

/* Identity per kind — what makes two rows "the same thing".
   Customers are name+phone because two people genuinely share a
   first name and the phone is what separates them; that is the same
   rule dbAddCustomer already uses, so the plan cannot disagree with
   what the writer will do. Stock is name+batch, because the same
   medicine in two batches is two different things on the shelf. */
function keyOf(rec, kind) {
    if (!rec) return '';
    switch (kind) {
        case 'customers': return idkey(rec.name) ? idkey(rec.name) + '|' + (rec.phone || '') : '';
        case 'suppliers': return idkey(rec.name);
        case 'doctors':   return idkey(rec.name) ? idkey(rec.name) + '|' + (rec.phone || '') : '';
        case 'stock':     return idkey(rec.productName) ? idkey(rec.productName) + '|' + idkey(rec.batchNo) : '';
        case 'barcodes':  return norm(rec.barcode);
        default:          return '';
    }
}

/* A stable id for one opening balance, so re-running cannot double
   it. Deliberately keyed on the CUSTOMER and not on the amount: the
   server dedups on this id, so the same person can only ever receive
   an opening balance once, whatever a later file says. A correction
   is then a visible "already imported — skipped" in the preview,
   which is the honest outcome. Silently applying a second delta is
   how a khata ends up double. */
function openingOpId(rec) {
    return 'mig-open-' + keyOf(rec, 'customers').replace(/[^a-z0-9|]/g, '').slice(0, 60);
}

/* Opening stock rides in as purchases, because stock in Billware is
   derived from purchases minus sales — there is no stock table to
   write to, and inventing one would give the shop two answers for
   what is on the shelf. They are stamped with this bill number so
   they are identifiable, reviewable and reversible as a group, and
   so a second run can recognise them. */
const OPENING_BILL = 'OPENING-STOCK';
const OPENING_FIRM = 'Opening Stock (migrated)';

function stockToPurchase(rec, dateStr) {
    return {
        billNo: OPENING_BILL,
        firm:   OPENING_FIRM,
        date:   dateStr,
        productName: rec.productName,
        batchNo: rec.batchNo || '',
        expireDate: rec.expireDate || '',
        pack: rec.pack || 0,
        quantity: rec.quantity || 0,
        mrp: rec.mrp || 0,
        rate: rec.rate || 0,
        gst: rec.gst || 0,
        hsn: rec.hsn || ''
    };
}

window.mmMigrate = {
    KINDS: KINDS,
    norm: norm, hkey: hkey, idkey: idkey,
    money: money, intOf: intOf, phone: phone, expiry: expiry,
    sniffDelimiter: sniffDelimiter, parseCsv: parseCsv, findHeaderRow: findHeaderRow,
    autoMap: autoMap, buildRecords: buildRecords, plan: plan, keyOf: keyOf,
    openingOpId: openingOpId, stockToPurchase: stockToPurchase,
    OPENING_BILL: OPENING_BILL, OPENING_FIRM: OPENING_FIRM
};

})();
