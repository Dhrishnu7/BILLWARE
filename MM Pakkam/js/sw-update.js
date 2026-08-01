/* ══════════════════════════════════════════════════════════════════════
   sw-update.js  —  make new versions actually arrive, without eating a bill
   ══════════════════════════════════════════════════════════════════════
   Found at a client's shop: the site was live and correct on the server —
   index.html byte for byte identical to the deploy — and the counter PC was
   still running a version from days earlier.

   Nothing had failed to deploy. registration.update() was never called
   ANYWHERE. A browser only re-checks sw.js when the page navigates, or once
   every 24 hours; a billing counter opens the app in the morning and never
   navigates again, so it can sit on yesterday's code all day and there is
   nothing in the app that would ever notice.

   Four pages — directory, inventory, khata, shop-setup — did not even
   register the worker. They were still SERVED by it, because its scope is
   the whole site, so they got the cached copies and never triggered a
   single update check. A shop that lives on the Inventory screen was
   effectively frozen.

   And the same twenty lines were pasted into fourteen pages in three
   slightly different versions, which is why the four that missed out went
   unnoticed. One file now, loaded everywhere.

   ── THE PART THAT MATTERS AT A COUNTER ────────────────────────────────
   The old code reloaded the page the moment a new worker took control.
   That was survivable only because updates were checked so rarely, and
   always right after a page load. Checking every thirty minutes turns the
   same line into a hazard: a deploy lands while a pharmacist is halfway
   through a bill, the page reloads, and the rows are gone.

   So the reload is now conditional. If nobody has typed anything since the
   page loaded, it reloads at once — invisible, exactly as before. If they
   have, it waits and offers a button instead. Losing a half-entered bill to
   an update is worse than running the old version for another minute.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    /* The old per-page blocks are not deleted, they are stood down: each one
       is now guarded by this flag. If this file ever fails to load — a bad
       deploy, a stale cache, a network hiccup on a shop's connection — the
       page falls back to exactly the registration it had before rather than
       ending up with no service worker at all. */
    window.mmSwManaged = true;

    if (!('serviceWorker' in navigator)) return;

    var CHECK_EVERY_MS = 30 * 60 * 1000;   // periodic re-check
    var FOCUS_THROTTLE = 5 * 60 * 1000;    // don't re-check on every tab switch
    var lastCheck = 0;

    /* Has the user put anything into this page since it loaded? Deliberately
       crude and deliberately cautious: any keystroke into any field counts.
       A false "busy" costs one banner click; a false "idle" costs a bill. */
    var userTyped = false;
    function markTyped(e) {
        var t = e && e.target;
        if (!t) return;
        var tag = (t.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
            userTyped = true;
        }
    }
    document.addEventListener('input', markTyped, true);
    document.addEventListener('change', markTyped, true);

    /* Pages that know better can say so — sales and purchase have a real
       answer to "is there unsaved work", and it beats guessing. */
    function busy() {
        try {
            if (typeof window.mmHasUnsavedWork === 'function') return !!window.mmHasUnsavedWork();
        } catch (e) { /* a page's own check must never block an update */ }
        return userTyped;
    }

    function showReloadBanner() {
        if (document.getElementById('mmUpdateBanner')) return;
        var b = document.createElement('div');
        b.id = 'mmUpdateBanner';
        b.setAttribute('role', 'status');
        b.style.cssText = [
            'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
            'background:#0f172a', 'color:#fff', 'padding:0.7rem 0.9rem',
            'border-radius:12px', 'box-shadow:0 8px 28px rgba(0,0,0,0.28)',
            'font:500 0.82rem/1.4 Inter,system-ui,sans-serif',
            'display:flex', 'align-items:center', 'gap:0.7rem', 'max-width:min(92vw,360px)'
        ].join(';');
        var txt = document.createElement('span');
        txt.textContent = 'A new version is ready. Finish what you are doing, then reload.';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Reload';
        btn.style.cssText = [
            'background:#22c55e', 'color:#04220f', 'border:0', 'cursor:pointer',
            'padding:0.4rem 0.8rem', 'border-radius:8px', 'font:600 0.8rem Inter,system-ui,sans-serif',
            'flex-shrink:0'
        ].join(';');
        btn.onclick = function () { window.location.reload(); };
        var x = document.createElement('button');
        x.type = 'button';
        x.textContent = '✕';
        x.setAttribute('aria-label', 'Dismiss');
        x.style.cssText = 'background:none;border:0;color:#94a3b8;cursor:pointer;font-size:0.9rem;flex-shrink:0;';
        x.onclick = function () { b.remove(); };
        b.appendChild(txt); b.appendChild(btn); b.appendChild(x);
        (document.body || document.documentElement).appendChild(b);
    }

    /* controllerchange also fires the very first time a worker takes control
       of a page that had none — a first visit, or a browser whose cache was
       cleared. Reloading then is pointless: the page in front of the user
       was just fetched from the network and is already current. */
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController) { hadController = true; return; }
        if (busy()) showReloadBanner();
        else window.location.reload();
    });

    function check(reg) {
        var now = Date.now();
        if (now - lastCheck < 30 * 1000) return;   // never hammer it
        lastCheck = now;
        try { reg.update(); } catch (e) { /* offline, or blocked — try again later */ }
    }

    navigator.serviceWorker.register('/sw.js').then(function (reg) {
        console.log('[PWA] SW registered:', reg.scope);

        /* THE MISSING LINE. Without this a counter PC that never navigates
           only re-checks once a day. */
        setInterval(function () { check(reg); }, CHECK_EVERY_MS);

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) return;
            if (Date.now() - lastCheck < FOCUS_THROTTLE) return;
            check(reg);
        });
        window.addEventListener('online', function () { check(reg); });

        reg.addEventListener('updatefound', function () {
            var nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', function () {
                if (nw.state === 'installed') nw.postMessage({ type: 'SKIP_WAITING' });
            });
        });
    }).catch(function (e) { console.warn('[PWA] SW failed:', e); });

    /* ── Which version is this? ───────────────────────────────────────
       Asked of the worker rather than written down here, so there is one
       number to bump on a deploy and no way for the two to disagree. Any
       element with id="mmVersion" or a data-mm-version attribute gets it,
       so a page opts in by putting a span where it wants it. */
    function paintVersion(v) {
        window.mmAppVersion = v;
        var els = [].slice.call(document.querySelectorAll('#mmVersion,[data-mm-version]'));
        els.forEach(function (el) { el.textContent = v; });
    }

    function askVersion() {
        var sw = navigator.serviceWorker.controller;
        if (!sw || !window.MessageChannel) return;
        try {
            var ch = new MessageChannel();
            ch.port1.onmessage = function (ev) {
                if (ev.data && ev.data.version) paintVersion(ev.data.version);
            };
            sw.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
        } catch (e) { /* not worth a broken page */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(askVersion, 300); });
    } else {
        setTimeout(askVersion, 300);
    }
    navigator.serviceWorker.addEventListener('controllerchange', function () { setTimeout(askVersion, 300); });
})();
