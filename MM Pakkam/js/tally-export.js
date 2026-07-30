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
        expensePrefix: '',             // e.g. "Indirect Exp - " if the CA groups them
        /* Most CAs keep returns in their own ledgers so gross sales stay
           visible; some just post them back against Sales/Purchase. Both are
           legitimate, so these are settings rather than a decision made here. */
        salesRetLedger: 'Sales Returns',
        purchRetLedger: 'Purchase Returns'
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

    function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    /* Split a bill's tax into its CGST and SGST halves.
       NOT tax/2 twice: an odd number of paise rounds UP on both halves, so
       ₹4.63 became 2.32 + 2.32 = 4.64 and the voucher no longer balanced.
       Tally rejects a voucher whose two sides differ by even one paisa. */
    function halves(tax) {
        var cg = r2(tax / 2);
        return { cg: cg, sg: r2(tax - cg) };
    }

    /* ── Group the flat line-item rows back into whole bills ──
       The app stores sales per medicine; a voucher is per BILL. Rows arrive
       with taxable/tax/total already worked out per line, because sales and
       purchases derive them from opposite directions — see below.

       The three figures are then forced to foot exactly: tax is defined as
       total − taxable rather than carried separately, so rounding can never
       leave the voucher one paisa out. */
    function groupBills(rows) {
        var map = {};
        rows.forEach(function (r) {
            var key = (r.billNo || '-') + '|' + (r.date || '');
            if (!map[key]) {
                map[key] = { billNo: r.billNo || '-', date: r.date || '', party: r.party || '', taxable: 0, tax: 0, total: 0 };
            }
            map[key].taxable += Number(r.taxable) || 0;
            map[key].tax     += Number(r.tax)     || 0;
            map[key].total   += Number(r.total)   || 0;
            if (!map[key].party && r.party) map[key].party = r.party;
        });
        return Object.keys(map).map(function (k) {
            var b = map[k];
            b.taxable = r2(b.taxable);
            b.total   = r2(b.total);
            b.tax     = r2(b.total - b.taxable);
            return b;
        });
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
        var counts = { sales: 0, purchases: 0, expenses: 0, creditNotes: 0, debitNotes: 0 };
        var retData = null;
        // Structured copy of every voucher, so the shop can read the export in
        // plain language before sending it. The XML is written for Tally; nobody
        // should have to squint at angle brackets to check their own bills.
        var rows = [];
        /* Tally will not accept a voucher whose debits and credits differ, by
           any amount. Two bugs used to produce exactly that — a discounted
           bill's Sales figure exceeded the money received, and an odd number
           of paise rounded up on BOTH tax halves. Neither was visible in the
           XML unless you added the columns up by hand, and the shop would only
           have found out when the accountant's import failed.

           So every voucher is now checked as it is written. Anything that does
           not balance is named, and the UI refuses the download. */
        var unbalanced = [];
        function note(kind, date, num, party, total, lines) {
            var dr = 0, cr = 0;
            lines.forEach(function (l) { if (l.debit) dr += l.amount; else cr += l.amount; });
            if (Math.abs(r2(dr) - r2(cr)) > 0.005) {
                unbalanced.push(kind + ' ' + (num || '-') + ': debits ' + amt(dr) + ' vs credits ' + amt(cr));
            }
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
                    /* Work BACKWARDS from the line total, exactly as the GSTR-1
                       and e-invoice exports do. The old code multiplied qty ×
                       rate, which is the price before any discount — so a
                       discounted bill produced a Sales figure LARGER than the
                       money received, tax came out as zero, and the voucher was
                       out by the whole discount. The total is what the customer
                       actually paid; the tax inside it follows from the rate. */
                    var total = Number(m.total) || 0;
                    if (!total) return;
                    var taxable = total / (1 + (Number(m.gst) || 0) / 100);
                    sRows.push({
                        billNo: bill.billNo, date: bill.date,
                        party: bill.customerName || bill.customer_name || '',
                        taxable: taxable, tax: total - taxable, total: total
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
                    var hs = halves(b.tax);
                    lines.push(entry(cfg.cgstOut, hs.cg, false));
                    lines.push(entry(cfg.sgstOut, hs.sg, false));
                    plain.push({ ledger: cfg.cgstOut, amount: hs.cg, debit: false });
                    plain.push({ ledger: cfg.sgstOut, amount: hs.sg, debit: false });
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
                /* Purchases run the other way: the app stores a PRE-tax rate,
                   so the taxable value is authoritative and the total follows. */
                var taxable = qty * rate;
                var tax     = taxable * gst / 100;
                return {
                    billNo: p.billNo || '-', date: p.date, party: p.firm || '',
                    taxable: taxable, tax: tax, total: taxable + tax
                };
            });
            groupBills(pRows).forEach(function (b) {
                var party = b.party && b.party.trim() ? b.party.trim() : 'Sundry Creditors';
                var lines = [entry(cfg.purchLedger, b.taxable, true)];  // stock bought = debit
                var plainP = [{ ledger: cfg.purchLedger, amount: b.taxable, debit: true }];
                if (b.tax > 0) {
                    var hp = halves(b.tax);
                    lines.push(entry(cfg.cgstIn, hp.cg, true));
                    lines.push(entry(cfg.sgstIn, hp.sg, true));
                    plainP.push({ ledger: cfg.cgstIn, amount: hp.cg, debit: true });
                    plainP.push({ ledger: cfg.sgstIn, amount: hp.sg, debit: true });
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

        /* ── Returns → Credit Note / Debit Note vouchers ──
           A refund the books never saw is money the shop appears to have kept.
           Each of these is the exact mirror of the Sales or Purchase voucher
           above: the same ledgers, the same tax split, the opposite sides.
           The GST rate comes from the original document via js/returns-data.js,
           because a return records only an amount. */
        if (opts.returns && window.mmReturns) {
            var rets = retData = mmReturns.load({ from: from, to: to });

            rets.creditNotes.forEach(function (n) {
                if (!n.usable) return;                  // never post a guessed rate
                var party = (n.party && n.party.trim()) ? n.party.trim() : cfg.walkIn;
                // Reverse of a sale: income and output tax come back, the
                // customer stops owing.
                var lines = [entry(cfg.salesRetLedger, n.taxable, true)];
                var plain = [{ ledger: cfg.salesRetLedger, amount: n.taxable, debit: true }];
                if (n.tax > 0) {
                    var hc = halves(n.tax);
                    lines.push(entry(cfg.cgstOut, hc.cg, true));
                    lines.push(entry(cfg.sgstOut, hc.sg, true));
                    plain.push({ ledger: cfg.cgstOut, amount: hc.cg, debit: true });
                    plain.push({ ledger: cfg.sgstOut, amount: hc.sg, debit: true });
                }
                lines.push(entry(party, n.gross, false));
                plain.push({ ledger: party, amount: n.gross, debit: false });
                body += voucher('Credit Note', n.date, n.no, party, lines);
                note('Credit Note', n.date, n.no, party, n.gross, plain);
                counts.creditNotes++;
            });

            rets.debitNotes.forEach(function (n) {
                if (!n.usable) return;
                var sup = (n.party && n.party.trim()) ? n.party.trim() : 'Sundry Creditors';
                // Reverse of a purchase: the supplier owes us, stock and input
                // tax go back out.
                var lines = [entry(sup, n.gross, true)];
                var plain = [{ ledger: sup, amount: n.gross, debit: true }];
                lines.push(entry(cfg.purchRetLedger, n.taxable, false));
                plain.push({ ledger: cfg.purchRetLedger, amount: n.taxable, debit: false });
                if (n.tax > 0) {
                    var hd = halves(n.tax);
                    lines.push(entry(cfg.cgstIn, hd.cg, false));
                    lines.push(entry(cfg.sgstIn, hd.sg, false));
                    plain.push({ ledger: cfg.cgstIn, amount: hd.cg, debit: false });
                    plain.push({ ledger: cfg.sgstIn, amount: hd.sg, debit: false });
                }
                body += voucher('Debit Note', n.date, n.no, sup, lines);
                note('Debit Note', n.date, n.no, sup, n.gross, plain);
                counts.debitNotes++;
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
        return { xml: xml, counts: counts, rows: rows,
                 unbalanced: unbalanced,
                 returnProblems: (retData ? retData.problems : []) };
    }

    window.mmTally = {
        loadCfg: loadCfg,
        saveCfg: saveCfg,
        defaults: DEFAULTS,
        build: buildXml
    };
})();
