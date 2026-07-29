/* ══════════════════════════════════════════════════════════════════════
   tally-export.js — hand the shop's books to the accountant's Tally

   WHY THIS EXISTS
   The honest gap in this app is deep financial accounting: no double-entry,
   no trial balance, no balance sheet. Building that would mean competing
   with software that has had 25 years to get Indian tax right, and losing.

   The accountant does not need this app to BE Tally. They need the data to
   REACH Tally without being retyped. So instead of replicating an
   accounting package, this writes the vouchers straight into the tool the
   CA already uses:

     Sales bills     -> Sales vouchers   (party debit, sales + GST credit)
     Purchase bills  -> Purchase vouchers(purchase + input GST debit, party credit)
     Expenses        -> Payment vouchers (expense debit, cash/bank credit)

   ── Tally's sign convention, because it looks wrong until you know it ──
   In Tally XML a DEBIT carries a NEGATIVE <AMOUNT> with ISDEEMEDPOSITIVE
   set to Yes; a CREDIT carries a POSITIVE amount with No. Every voucher
   below therefore sums to zero, which is what Tally checks on import.

   ── Ledger names are the whole ballgame ──
   Tally matches ledgers BY NAME. If the file says "Sales" and the CA's
   company has "Sales Account", the import fails or lands in the wrong
   place. So the names are settings, not constants — the shop asks its
   accountant once and saves them. Getting this wrong is the single most
   likely reason an import does not work.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var LS_KEY = 'mm_tally_ledgers';

    var DEFAULTS = {
        company:      '',              // blank = whichever company is open in Tally
        salesLedger:  'Sales',
        purchLedger:  'Purchase',
        cgstOut:      'Output CGST',
        sgstOut:      'Output SGST',
        cgstIn:       'Input CGST',
        sgstIn:       'Input SGST',
        cashLedger:   'Cash',
        bankLedger:   'Bank',
        walkIn:       'Cash',          // party ledger for counter sales
        expensePrefix: ''              // e.g. "Indirect Exp - " if the CA groups them
    };

    function loadCfg() {
        var c = {};
        try { c = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { c = {}; }
        var out = {};
        Object.keys(DEFAULTS).forEach(function (k) { out[k] = (c[k] != null && c[k] !== '') ? c[k] : DEFAULTS[k]; });
        return out;
    }
    function saveCfg(c) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) {} }

    // Tally wants YYYYMMDD with no separators.
    function tDate(d) {
        var s = String(d || '').slice(0, 10);
        var p = s.split('-');
        if (p.length !== 3) return s.replace(/\D/g, '');
        if (p[0].length === 4) return p[0] + p[1] + p[2];          // YYYY-MM-DD
        return (p[2].length === 2 ? '20' + p[2] : p[2]) + p[1] + p[0];  // DD-MM-YYYY
    }

    function xesc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }
    function amt(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

    /* One ledger line. debit=true flips the sign the way Tally expects. */
    function entry(name, value, debit) {
        return '' +
            '     <ALLLEDGERENTRIES.LIST>\n' +
            '      <LEDGERNAME>' + xesc(name) + '</LEDGERNAME>\n' +
            '      <ISDEEMEDPOSITIVE>' + (debit ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE>\n' +
            '      <AMOUNT>' + (debit ? '-' : '') + amt(value) + '</AMOUNT>\n' +
            '     </ALLLEDGERENTRIES.LIST>\n';
    }

    function voucher(kind, date, num, party, lines) {
        var s = '    <VOUCHER VCHTYPE="' + kind + '" ACTION="Create" OBJVIEW="Accounting Voucher View">\n' +
                '     <DATE>' + tDate(date) + '</DATE>\n' +
                '     <EFFECTIVEDATE>' + tDate(date) + '</EFFECTIVEDATE>\n' +
                '     <VOUCHERTYPENAME>' + xesc(kind) + '</VOUCHERTYPENAME>\n' +
                '     <VOUCHERNUMBER>' + xesc(num) + '</VOUCHERNUMBER>\n' +
                '     <PARTYLEDGERNAME>' + xesc(party) + '</PARTYLEDGERNAME>\n' +
                '     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n';
        s += lines.join('');
        s += '    </VOUCHER>\n';
        return '   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + s + '   </TALLYMESSAGE>\n';
    }

    /* ── Group the flat line-item rows back into whole bills ──
       The app stores sales per medicine; a voucher is per BILL. Tax is split
       evenly into CGST and SGST, which is correct for an intra-state pharmacy
       sale — see the caveat surfaced in the UI for inter-state supplies. */
    function groupBills(rows) {
        var map = {};
        rows.forEach(function (r) {
            var key = (r.billNo || '-') + '|' + (r.date || '');
            if (!map[key]) {
                map[key] = { billNo: r.billNo || '-', date: r.date || '', party: r.party || '', taxable: 0, tax: 0, total: 0 };
            }
            var taxable = (Number(r.qty) || 0) * (Number(r.rate) || 0);
            var total   = Number(r.total) || taxable;
            map[key].taxable += taxable;
            map[key].tax     += Math.max(0, total - taxable);
            map[key].total   += total;
            if (!map[key].party && r.party) map[key].party = r.party;
        });
        return Object.keys(map).map(function (k) { return map[k]; });
    }

    /* ── Build the XML ──
       opts: { from, to, sales, purchases, expenses } */
    function buildXml(opts) {
        var cfg = loadCfg();
        var from = opts.from || '', to = opts.to || '';
        var inRange = function (d) {
            var s = String(d || '').slice(0, 10);
            return (!from || s >= from) && (!to || s <= to);
        };

        var body = '';
        var counts = { sales: 0, purchases: 0, expenses: 0 };
        // Structured copy of every voucher, so the shop can read the export in
        // plain language before sending it. The XML is written for Tally; nobody
        // should have to squint at angle brackets to check their own bills.
        var rows = [];
        function note(kind, date, num, party, total, lines) {
            rows.push({ kind: kind, date: date, num: num, party: party, total: total, lines: lines });
        }

        // ── Sales ──
        if (opts.sales) {
            var rawSales = [];
            try { rawSales = JSON.parse(localStorage.getItem('mm_sales') || '[]'); } catch (e) {}
            var sRows = [];
            rawSales.forEach(function (bill) {
                if (!inRange(bill.date)) return;
                (bill.medicines || []).forEach(function (m) {
                    sRows.push({
                        billNo: bill.billNo, date: bill.date,
                        party: bill.customerName || bill.customer_name || '',
                        qty: m.qty, rate: m.rate, total: m.total
                    });
                });
            });
            groupBills(sRows).forEach(function (b) {
                var party = b.party && b.party.trim() ? b.party.trim() : cfg.walkIn;
                var lines = [entry(party, b.total, true)];             // party owes / cash in = debit
                lines.push(entry(cfg.salesLedger, b.taxable, false));  // income = credit
                var plain = [{ ledger: party, amount: b.total, debit: true },
                             { ledger: cfg.salesLedger, amount: b.taxable, debit: false }];
                if (b.tax > 0) {
                    lines.push(entry(cfg.cgstOut, b.tax / 2, false));
                    lines.push(entry(cfg.sgstOut, b.tax / 2, false));
                    plain.push({ ledger: cfg.cgstOut, amount: b.tax / 2, debit: false });
                    plain.push({ ledger: cfg.sgstOut, amount: b.tax / 2, debit: false });
                }
                body += voucher('Sales', b.date, b.billNo, party, lines);
                note('Sales', b.date, b.billNo, party, b.total, plain);
                counts.sales++;
            });
        }

        // ── Purchases ──
        if (opts.purchases) {
            var rawPurch = [];
            try { rawPurch = JSON.parse(localStorage.getItem('mm_purchases') || '[]'); } catch (e) {}
            var pRows = rawPurch.filter(function (p) { return inRange(p.date); }).map(function (p) {
                var qty = Number(p.quantity) || 0, rate = Number(p.rate) || 0, gst = Number(p.gst) || 0;
                var taxable = qty * rate;
                return {
                    billNo: p.billNo || '-', date: p.date, party: p.firm || '',
                    qty: qty, rate: rate, total: taxable * (1 + gst / 100)
                };
            });
            groupBills(pRows).forEach(function (b) {
                var party = b.party && b.party.trim() ? b.party.trim() : 'Sundry Creditors';
                var lines = [entry(cfg.purchLedger, b.taxable, true)];  // stock bought = debit
                var plainP = [{ ledger: cfg.purchLedger, amount: b.taxable, debit: true }];
                if (b.tax > 0) {
                    lines.push(entry(cfg.cgstIn, b.tax / 2, true));
                    lines.push(entry(cfg.sgstIn, b.tax / 2, true));
                    plainP.push({ ledger: cfg.cgstIn, amount: b.tax / 2, debit: true });
                    plainP.push({ ledger: cfg.sgstIn, amount: b.tax / 2, debit: true });
                }
                lines.push(entry(party, b.total, false));               // supplier owed = credit
                plainP.push({ ledger: party, amount: b.total, debit: false });
                body += voucher('Purchase', b.date, b.billNo, party, lines);
                note('Purchase', b.date, b.billNo, party, b.total, plainP);
                counts.purchases++;
            });
        }

        // ── Expenses → Payment vouchers ──
        if (opts.expenses) {
            var exp = [];
            try { exp = JSON.parse(localStorage.getItem('mm_expenses') || '[]'); } catch (e) {}
            exp.filter(function (e) { return inRange(e.date); }).forEach(function (e, i) {
                var ledger = (cfg.expensePrefix || '') + (e.category || 'Other');
                var paidFrom = /bank|upi|card/i.test(e.paymentMode || '') ? cfg.bankLedger : cfg.cashLedger;
                var lines = [entry(ledger, e.amount, true), entry(paidFrom, e.amount, false)];
                body += voucher('Payment', e.date, 'EXP-' + (i + 1), paidFrom, lines);
                note('Payment', e.date, 'EXP-' + (i + 1), ledger + (e.note ? ' — ' + e.note : ''), e.amount,
                     [{ ledger: ledger, amount: e.amount, debit: true },
                      { ledger: paidFrom, amount: e.amount, debit: false }]);
                counts.expenses++;
            });
        }

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<ENVELOPE>\n' +
            ' <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n' +
            ' <BODY>\n' +
            '  <IMPORTDATA>\n' +
            '   <REQUESTDESC>\n' +
            '    <REPORTNAME>Vouchers</REPORTNAME>\n' +
            '    <STATICVARIABLES>\n' +
            '     <SVCURRENTCOMPANY>' + xesc(cfg.company) + '</SVCURRENTCOMPANY>\n' +
            '    </STATICVARIABLES>\n' +
            '   </REQUESTDESC>\n' +
            '   <REQUESTDATA>\n' +
            body +
            '   </REQUESTDATA>\n' +
            '  </IMPORTDATA>\n' +
            ' </BODY>\n' +
            '</ENVELOPE>\n';

        rows.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
        return { xml: xml, counts: counts, rows: rows };
    }

    window.mmTally = {
        loadCfg: loadCfg,
        saveCfg: saveCfg,
        defaults: DEFAULTS,
        build: buildXml
    };
})();
