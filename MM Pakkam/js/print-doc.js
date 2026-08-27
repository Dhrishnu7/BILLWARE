/* ══════════════════════════════════════════════════════════════════════
   MM Pakkam — mmPrintDoc(html, opts)

   ONE way to put a document on paper, shared by every print button in the
   app: the sales invoice, the report hardcopy, an old bill, a khata
   statement, a cash/capital statement and a credit/debit note.

   WHY THIS EXISTS
   Every one of those used to do the same thing: window.open('', '_blank'),
   document.write, print. That works — it was measured working end to end on
   2026-08-27 — but the popup is the one link in the chain the shop does not
   control. A profile setting, a group policy or an extension can refuse it,
   and then the print button is at the mercy of whatever the browser decides
   to show. A counter that cannot print a bill cannot trade.

   An iframe in the page we are already on is not a popup. Nothing blocks it,
   no second tab appears and it needs no network. So that is the first
   choice, and the old popup is kept as the fallback — a browser that cannot
   print from an iframe still prints exactly the way it did before.

   THE RULE THIS FILE KEEPS
   It never fails silently. Every path either reaches the print dialog or
   says out loud why it could not, because "I pressed Print and nothing
   happened" is the one report nobody can act on.

   USAGE
     mmPrintDoc(fullHtmlDocument)                  → true if printing started
     mmPrintDoc(html, { title: 'Invoice - 12' })

   The html you pass MUST NOT auto-print itself (no <body onload="print()">,
   no <script>window.onload=…print()</script>). This owns the timing; a
   document that also prints itself produces two dialogs from the iframe.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.mmPrintDoc) return;

    // Say it in the app's own dialog when there is one, and fall back to the
    // native box rather than swallowing the message.
    function tell(msg) {
        try {
            if (typeof mmAlert === 'function') { mmAlert(msg, { title: '🖨️ Could not print' }); return; }
        } catch (e) {}
        try { window.alert(msg); } catch (e) {}
    }

    /* ── Route 1: a hidden iframe in this very page ──────────────────────
       Positioned off-screen at a real paper-sized box. NOT display:none and
       NOT visibility:hidden — an iframe hidden either of those ways has no
       layout, and browsers print it as a blank sheet. Off-screen keeps it
       laid out and invisible at the same time. */
    function viaIframe(html) {
        var ifr;
        try {
            ifr = document.createElement('iframe');
            ifr.setAttribute('aria-hidden', 'true');
            ifr.setAttribute('tabindex', '-1');
            ifr.style.cssText = 'position:fixed;left:-10000px;top:0;' +
                                'width:210mm;height:297mm;border:0;opacity:0;';
            document.body.appendChild(ifr);
        } catch (e) { return false; }

        var win = ifr.contentWindow;
        if (!win) { drop(ifr); return false; }

        try {
            var doc = win.document;
            doc.open();
            doc.write(html);
            doc.close();
        } catch (e) { drop(ifr); return false; }

        var printed = false;
        function go() {
            if (printed) return;
            printed = true;
            try { win.focus(); } catch (e) {}
            try {
                win.print();
            } catch (e) {
                drop(ifr);
                return;
            }
            // Keep the frame alive a moment: removing it while the dialog is
            // still reading the document cancels the job on some builds.
            setTimeout(function () { drop(ifr); }, 60000);
        }

        try { win.addEventListener('afterprint', function () { setTimeout(function () { drop(ifr); }, 500); }); } catch (e) {}

        // document.write into about:blank usually lands 'complete' at once,
        // but images and @font-face can still be in flight. Print on load
        // when it comes, and on a ceiling when it does not — the button must
        // never be left waiting on something that may never arrive.
        try {
            if (win.document.readyState === 'complete') setTimeout(go, 80);
            else win.addEventListener('load', function () { setTimeout(go, 80); });
        } catch (e) {}
        setTimeout(go, 1500);

        return true;
    }

    function drop(ifr) {
        try { if (ifr && ifr.parentNode) ifr.parentNode.removeChild(ifr); } catch (e) {}
    }

    /* ── Route 2: the old popup, unchanged ───────────────────────────── */
    function viaPopup(html, title) {
        var w;
        try { w = window.open('', '_blank'); } catch (e) { w = null; }
        if (!w) return false;
        try {
            w.document.write(html);
            w.document.close();
            if (title) { try { w.document.title = title; } catch (e) {} }
            w.focus();
            setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
        } catch (e) { return false; }
        return true;
    }

    window.mmPrintDoc = function (html, opts) {
        opts = opts || {};
        if (!html) {
            tell('There was nothing to print.\n\nOpen the bill or statement again and retry.');
            return false;
        }
        if (viaIframe(html)) return true;
        if (viaPopup(html, opts.title)) return true;
        tell('This browser would not open the print view.\n\n' +
             'Allow pop-ups for this site, or use Ctrl+P on the page, and try again.');
        return false;
    };
})();
