/**
 * note-print.js — printable GST credit and debit notes
 *
 * Open since Returns shipped: the shop could process a refund, reverse the
 * stock, file it in GSTR-1 and post it to Tally — and hand the customer
 * nothing. A credit note is a tax document. Without it the buyer cannot
 * reverse their input credit, and the shop has no signed proof the goods came
 * back.
 *
 * COMPUTES NOTHING. Every figure comes from mmReturns.load(), the same builder
 * the GSTR-1 and Tally exports read, so the printed paper and the filed return
 * are the same numbers by construction. A second calculation here is how a
 * shop ends up handing over a note that disagrees with what it filed.
 *
 * The tax HEAD is decided by mmTaxHead() — the one rule (v318) — so an
 * inter-state note prints IGST and everything else prints CGST+SGST, exactly
 * as the till and the exporter already agree.
 */
(function () {
    'use strict';

    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    function r2(v) { return Math.round(num(v) * 100) / 100; }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function inr(v) {
        var n = num(v), neg = n < 0;
        var s = Math.abs(r2(n)).toFixed(2).split('.');
        var x = s[0], last3 = x.slice(-3), rest = x.slice(0, -3);
        x = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
        return (neg ? '-' : '') + x + '.' + s[1];
    }

    // Built from date PARTS. `new Date('2026-04-01')` is parsed as UTC and
    // reads as the previous day in IST — a note dated a day early is a real
    // problem on a document that states a tax period.
    function dmy(iso) {
        var s = String(iso || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '';
        var p = s.split('-');
        var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return p[2] + ' ' + M[+p[1] - 1] + ' ' + p[0];
    }

    /* Amount in words. Required on a tax invoice by convention and expected on
       a note; Indian scale, so lakh and crore rather than million. */
    var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
        'Seventeen', 'Eighteen', 'Nineteen'];
    var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function under100(n) {
        if (n < 20) return ONES[n];
        return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
    }
    function under1000(n) {
        if (n < 100) return under100(n);
        return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + under100(n % 100) : '');
    }
    function words(amount) {
        var n = Math.floor(Math.abs(num(amount)));
        var paise = Math.round((Math.abs(num(amount)) - n) * 100);
        if (n === 0 && !paise) return 'Zero Rupees Only';
        var out = '';
        var crore = Math.floor(n / 10000000); n %= 10000000;
        var lakh  = Math.floor(n / 100000);   n %= 100000;
        var thou  = Math.floor(n / 1000);     n %= 1000;
        if (crore) out += under1000(crore) + ' Crore ';
        if (lakh)  out += under1000(lakh) + ' Lakh ';
        if (thou)  out += under1000(thou) + ' Thousand ';
        if (n)     out += under1000(n);
        out = out.trim();
        var s = (out ? out + ' Rupees' : '');
        if (paise) s += (s ? ' and ' : '') + under100(paise) + ' Paise';
        return (s || 'Zero Rupees') + ' Only';
    }

    function shopProfile() {
        var p = {};
        try { p = JSON.parse(localStorage.getItem('mm_shop_profile') || '{}') || {}; } catch (e) {}
        var w = window.mmShopProfile || {};
        // Both spellings: localStorage is camelCase, the cloud row snake_case.
        function pick() {
            for (var i = 0; i < arguments.length; i++) {
                var k = arguments[i];
                if (p[k]) return p[k];
                if (w[k]) return w[k];
            }
            return '';
        }
        return {
            name:    pick('shopName', 'shop_name', 'storeName', 'store_name', 'name'),
            addr1:   pick('address1', 'address_1', 'address'),
            addr2:   pick('address2', 'address_2'),
            town:    pick('town', 'city'),
            pin:     pick('pincode', 'pin', 'postal_code'),
            state:   pick('state'),
            phone:   pick('phone', 'mobile'),
            gstin:   String(pick('gstin', 'gst_no') || '').toUpperCase(),
            dl:      pick('dlNo', 'dl_no', 'drugLicence', 'drug_licence')
        };
    }

    // The party's own record, for their address and GSTIN. By id first — that
    // survives a rename — then by name, which is all an older note has.
    function partyDetails(note) {
        var out = { name: note.party || note.customerName || '', gstin: '', addr: '', phone: '' };
        var isSale = note.type === 'credit';
        try {
            if (isSale) {
                var list = (typeof mmCustomerList === 'function') ? mmCustomerList() : [];
                var hit = null;
                if (note.customerId != null) {
                    hit = list.find(function (c) { return c && String(c.id) === String(note.customerId); });
                }
                if (!hit) {
                    var nm = String(out.name || '').trim().toLowerCase();
                    hit = list.find(function (c) { return c && String(c.name || '').trim().toLowerCase() === nm; });
                }
                if (hit) {
                    out.gstin = String(hit.gstin || '').toUpperCase();
                    out.addr  = hit.address || '';
                    out.phone = hit.phone || '';
                }
            } else {
                var sup = [];
                try { sup = JSON.parse(localStorage.getItem('mm_suppliers') || '[]') || []; } catch (e) {}
                var snm = String(out.name || '').trim().toLowerCase();
                var s = sup.find(function (x) { return x && String(x.name || x.firm || '').trim().toLowerCase() === snm; });
                if (s) {
                    out.gstin = String(s.gstin || '').toUpperCase();
                    out.addr  = s.address || '';
                    out.phone = s.phone || '';
                }
            }
        } catch (e) {}
        return out;
    }

    function build(note) {
        if (!note) return '';
        var isCredit = note.type === 'credit';
        var shop  = shopProfile();
        var party = partyDetails(note);

        /* ONE tax-head rule, shared with the till and the exporter. A note
           printed with the wrong head is worse than no note: the buyer claims
           credit under a head the return does not report. */
        var head = (typeof mmTaxHead === 'function')
            ? mmTaxHead(party.gstin)
            : { interState: false };
        var igst = !!head.interState;

        var title = isCredit ? 'CREDIT NOTE' : 'DEBIT NOTE';
        var partyLabel = isCredit ? 'Recipient' : 'Supplier';

        var rows = '', anyUnknown = false;
        (note.lines || []).forEach(function (l, i) {
            if (!l.known) anyUnknown = true;
            var half = r2(num(l.tax) / 2);
            rows += '<tr>' +
                '<td class="c">' + (i + 1) + '</td>' +
                '<td>' + esc(l.product) + (l.batch ? '<br><span class="sm">Batch ' + esc(l.batch) + '</span>' : '') + '</td>' +
                '<td class="c">' + esc(l.hsn || '—') + '</td>' +
                '<td class="c">' + num(l.qty) + '</td>' +
                '<td class="n">' + inr(l.taxable) + '</td>' +
                '<td class="c">' + (l.known ? num(l.rate) + '%' : '<span class="warn">?</span>') + '</td>' +
                (igst
                    ? '<td class="n">' + inr(l.tax) + '</td>'
                    : '<td class="n">' + inr(half) + '</td><td class="n">' + inr(num(l.tax) - half) + '</td>') +
                '<td class="n">' + inr(num(l.taxable) + num(l.tax)) + '</td>' +
            '</tr>';
        });

        var taxHalf = r2(num(note.tax) / 2);
        var css =
            '@page{size:A4;margin:12mm;}' +
            'body{font:12px/1.45 "Segoe UI",Roboto,sans-serif;color:#111;margin:0;padding:18px;}' +
            '.wrap{max-width:780px;margin:0 auto;border:1.5px solid #111;padding:16px;}' +
            'h1{font-size:1.15rem;margin:0 0 2px;letter-spacing:.06em;text-align:center;}' +
            '.sub{text-align:center;font-size:.72rem;color:#444;margin:0 0 12px;letter-spacing:.05em;}' +
            '.shop{text-align:center;border-bottom:1.5px solid #111;padding-bottom:10px;margin-bottom:10px;}' +
            '.shop .nm{font-size:1.05rem;font-weight:800;}' +
            '.sm{font-size:.72rem;color:#555;}' +
            '.grid2{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;}' +
            '.box{flex:1;min-width:220px;border:1px solid #999;padding:8px 10px;}' +
            '.box .lbl{font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:3px;}' +
            'table{width:100%;border-collapse:collapse;margin-top:6px;}' +
            'th,td{border:1px solid #999;padding:5px 6px;font-size:.76rem;}' +
            'th{background:#f2f2f2;text-transform:uppercase;font-size:.66rem;letter-spacing:.04em;}' +
            '.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
            '.c{text-align:center;}' +
            'tfoot td{font-weight:800;background:#fafafa;}' +
            '.words{margin-top:8px;font-size:.76rem;}' +
            '.foot{display:flex;justify-content:space-between;margin-top:26px;gap:14px;}' +
            '.sign{text-align:center;font-size:.72rem;border-top:1px solid #111;padding-top:4px;min-width:180px;}' +
            '.warn{color:#b91c1c;font-weight:800;}' +
            '.note{margin-top:10px;font-size:.72rem;color:#555;}' +
            '@media print{body{padding:0;} .noprint{display:none;}}';

        var addrBits = [shop.addr1, shop.addr2, [shop.town, shop.pin].filter(Boolean).join(' ')]
            .filter(Boolean).join(', ');

        return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
            '<title>' + esc(title + ' ' + note.no) + '</title><style>' + css + '</style></head><body>' +
            '<div class="wrap">' +
              '<div class="shop">' +
                '<div class="nm">' + esc(shop.name || 'Shop') + '</div>' +
                (addrBits ? '<div class="sm">' + esc(addrBits) + '</div>' : '') +
                '<div class="sm">' +
                  (shop.gstin ? 'GSTIN: ' + esc(shop.gstin) : '') +
                  (shop.dl ? ' &nbsp;·&nbsp; DL: ' + esc(shop.dl) : '') +
                  (shop.phone ? ' &nbsp;·&nbsp; ' + esc(shop.phone) : '') +
                '</div>' +
              '</div>' +
              '<h1>' + title + '</h1>' +
              '<p class="sub">' + (isCredit ? 'Issued against a sales return' : 'Issued against a purchase return') + '</p>' +
              '<div class="grid2">' +
                '<div class="box">' +
                  '<div class="lbl">' + partyLabel + '</div>' +
                  '<div style="font-weight:700;">' + esc(party.name || '—') + '</div>' +
                  (party.addr ? '<div class="sm">' + esc(party.addr) + '</div>' : '') +
                  (party.phone ? '<div class="sm">' + esc(party.phone) + '</div>' : '') +
                  '<div class="sm">GSTIN: ' + esc(party.gstin || 'Unregistered') + '</div>' +
                '</div>' +
                '<div class="box">' +
                  '<div class="lbl">Note details</div>' +
                  '<div><strong>No:</strong> ' + esc(note.no) + '</div>' +
                  '<div><strong>Date:</strong> ' + esc(dmy(note.date)) + '</div>' +
                  '<div class="sm"><strong>Against invoice:</strong> ' + esc(note.ref || '—') + '</div>' +
                  (note.reason ? '<div class="sm"><strong>Reason:</strong> ' + esc(note.reason) + '</div>' : '') +
                  '<div class="sm"><strong>Supply:</strong> ' + (igst ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)') + '</div>' +
                '</div>' +
              '</div>' +
              '<table><thead><tr>' +
                '<th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Taxable</th><th>GST</th>' +
                (igst ? '<th>IGST</th>' : '<th>CGST</th><th>SGST</th>') +
                '<th>Total</th>' +
              '</tr></thead><tbody>' + rows + '</tbody>' +
              '<tfoot><tr>' +
                '<td colspan="4" class="c">Total</td>' +
                '<td class="n">' + inr(note.taxable) + '</td><td></td>' +
                (igst ? '<td class="n">' + inr(note.tax) + '</td>'
                      : '<td class="n">' + inr(taxHalf) + '</td><td class="n">' + inr(num(note.tax) - taxHalf) + '</td>') +
                '<td class="n">' + inr(note.gross) + '</td>' +
              '</tr></tfoot></table>' +
              '<div class="words"><strong>Amount in words:</strong> ' + esc(words(note.gross)) + '</div>' +
              (anyUnknown
                ? '<div class="note warn">One or more lines have no GST rate recorded, so their tax shows as ' +
                  'zero. Correct the original document before issuing this note.</div>'
                : '') +
              '<div class="note">' +
                (isCredit
                  ? 'This credit note reduces the value of the original invoice. Please reverse any input tax credit claimed on the returned goods.'
                  : 'This debit note is raised against goods returned to you. Please issue your credit note for the same value.') +
              '</div>' +
              '<div class="foot">' +
                '<div class="sign">Receiver&rsquo;s signature</div>' +
                '<div class="sign">For ' + esc(shop.name || 'the shop') + '</div>' +
              '</div>' +
            '</div>' +
            '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
            '</body></html>';
    }

    // Find a note by its number across both kinds, then print it.
    function findNote(no) {
        if (!window.mmReturns || typeof mmReturns.load !== 'function') return null;
        var data;
        try { data = mmReturns.load(); } catch (e) { return null; }
        var want = String(no || '').trim();
        var all = (data.creditNotes || []).concat(data.debitNotes || []);
        return all.find(function (n) { return String(n.no).trim() === want; }) || null;
    }

    function open(no) {
        var note = findNote(no);
        if (!note) {
            if (typeof mmAlert === 'function') mmAlert('That note could not be found. Reload the page and try again.');
            return false;
        }
        var w = window.open('', '_blank');
        if (!w) {
            if (typeof mmAlert === 'function') {
                mmAlert('Your browser blocked the print window. Allow pop-ups for this site and try again.');
            }
            return false;
        }
        w.document.write(build(note));
        w.document.close();
        if (typeof mmAudit === 'function') mmAudit('Note printed', note.no, inr(note.gross));
        return true;
    }

    window.mmNotePrint = { build: build, open: open, findNote: findNote, _words: words, _dmy: dmy };
})();
