/* ══════════════════════════════════════════════════════════════════════
   combo.js — a keyboard-first replacement for <input list="...">

   WHY THIS EXISTS
   The medicine picker was a native <datalist>. It looks fine, but its
   keyboard behaviour is decided by the browser and differs between them:
   whether arrow keys open the list, whether the highlighted row is committed
   by Enter, and whether Enter also submits, are all browser choices. A fast
   pharmacy biller types three letters and expects to arrow down and press
   Enter WITHOUT LOOKING. With a datalist that is not reliable, so they end
   up watching the screen or reaching for the mouse — which is the whole of
   the "browser apps can't match legacy billing software" complaint.

   This gives identical behaviour everywhere:
       type      filter, best matches first
       ↑ / ↓     move the highlight
       Enter     commit the highlighted row, then carry on to the next field
       Tab       commit and move on
       Esc       close the list, keep what was typed
       click     commit

   HOW IT ATTACHES
   By delegation on the document, not per element. Sales rows are built with
   innerHTML at run time, so anything wired up per input would miss every row
   added later. On first focus of an <input list="x"> the `list` attribute is
   moved to data-mmlist — that suppresses the browser's own dropdown while
   keeping the <datalist> as the source of options, so the existing code that
   fills it (refreshGlobalMedicineList and friends) keeps working untouched.

   Opt out with data-nocombo on the input.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    if (window.mmCombo) return;

    var MAX_RENDER = 60;      // never paint more than this — 15,000+ medicines exist
    var cache = {};           // listId -> { items:[], lower:[], n }
    var box = null;           // the dropdown element (one, reused)
    var current = null;       // the input it is currently attached to
    var matches = [];
    var active = -1;

    /* ── options are read from the <datalist>, and cached ── */
    function getItems(listId) {
        var dl = document.getElementById(listId);
        if (!dl) return { items: [], lower: [] };
        var n = dl.children.length;
        var c = cache[listId];
        if (c && c.n === n) return c;             // unchanged since last time
        var items = [], lower = [];
        for (var i = 0; i < n; i++) {
            var o = dl.children[i];
            var v = o.value || o.textContent || '';
            if (!v) continue;
            items.push(v);
            lower.push(v.toLowerCase());
        }
        cache[listId] = { items: items, lower: lower, n: n };
        return cache[listId];
    }

    /* ── rank: what starts with the query beats what merely contains it ──
       Typing "dol" should put "Dolo 650" at the top, not "Paracetamol". */
    function filter(listId, q) {
        var data = getItems(listId);
        q = (q || '').trim().toLowerCase();
        var starts = [], contains = [], i;
        if (!q) {
            return data.items.slice(0, MAX_RENDER);
        }
        for (i = 0; i < data.lower.length; i++) {
            var pos = data.lower[i].indexOf(q);
            if (pos === 0) starts.push(data.items[i]);
            else if (pos > 0) contains.push(data.items[i]);
            if (starts.length >= MAX_RENDER) break;
        }
        return starts.concat(contains).slice(0, MAX_RENDER);
    }

    function ensureBox() {
        if (box) return box;
        var css = document.createElement('style');
        css.textContent =
            '.mmcombo{position:fixed;z-index:2147482000;background:#fff;border:1px solid #e2e8f0;' +
            'border-radius:12px;box-shadow:0 12px 28px -8px rgba(15,23,42,.25),0 2px 6px rgba(15,23,42,.06);' +
            "max-height:264px;overflow-y:auto;display:none;font-family:'Inter',system-ui,sans-serif;" +
            'padding:5px;-webkit-overflow-scrolling:touch;}' +
            '.mmcombo.open{display:block;}' +
            '.mmcombo-i{padding:8px 11px;border-radius:8px;font-size:.875rem;color:#0f172a;cursor:pointer;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35;}' +
            '.mmcombo-i:hover{background:#f1f5f9;}' +
            '.mmcombo-i.on{background:#fff1f2;color:#be123c;font-weight:600;}' +
            '.mmcombo-i b{color:#e11d48;font-weight:700;}' +
            '.mmcombo-i.on b{color:#be123c;}' +
            '.mmcombo-empty{padding:10px 11px;font-size:.82rem;color:#94a3b8;}';
        document.head.appendChild(css);
        box = document.createElement('div');
        box.className = 'mmcombo';
        box.setAttribute('role', 'listbox');
        document.body.appendChild(box);
        // Mousedown, not click: click fires after blur, by which time we have closed.
        box.addEventListener('mousedown', function (e) {
            var it = e.target.closest('.mmcombo-i');
            if (!it) return;
            e.preventDefault();
            commit(it.dataset.v);
        });
        return box;
    }

    function esc(s) {
        return String(s).replace(/[&<>]/g, function (c) {
            return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
        });
    }
    function mark(text, q) {
        if (!q) return esc(text);
        var i = text.toLowerCase().indexOf(q.toLowerCase());
        if (i < 0) return esc(text);
        return esc(text.slice(0, i)) + '<b>' + esc(text.slice(i, i + q.length)) + '</b>' + esc(text.slice(i + q.length));
    }

    function place() {
        if (!current || !box) return;
        var r = current.getBoundingClientRect();
        var w = Math.max(r.width, 240);
        box.style.width = w + 'px';
        box.style.left = Math.min(r.left, window.innerWidth - w - 8) + 'px';
        // Flip above when there is not enough room below.
        var below = window.innerHeight - r.bottom;
        if (below < 180 && r.top > below) {
            box.style.top = ''; box.style.bottom = (window.innerHeight - r.top + 4) + 'px';
        } else {
            box.style.bottom = ''; box.style.top = (r.bottom + 4) + 'px';
        }
    }

    function render(q) {
        ensureBox();
        if (!matches.length) { close(); return; }
        var html = '';
        for (var i = 0; i < matches.length; i++) {
            html += '<div class="mmcombo-i' + (i === active ? ' on' : '') + '" role="option" data-v="' +
                    esc(matches[i]).replace(/"/g, '&quot;') + '">' + mark(matches[i], q) + '</div>';
        }
        box.innerHTML = html;
        box.classList.add('open');
        place();
        scrollActive();
    }

    function scrollActive() {
        if (active < 0 || !box) return;
        var el = box.children[active];
        if (!el) return;
        var t = el.offsetTop, b = t + el.offsetHeight;
        if (t < box.scrollTop) box.scrollTop = t - 4;
        else if (b > box.scrollTop + box.clientHeight) box.scrollTop = b - box.clientHeight + 4;
    }

    function close() {
        if (box) { box.classList.remove('open'); box.innerHTML = ''; }
        matches = []; active = -1;
    }

    function commit(value) {
        if (!current || value == null) return;
        current.value = value;
        // Existing handlers (autoFillRow, updateRxDoctorWarning…) listen for
        // these, and a programmatic .value assignment fires neither on its own.
        current.dispatchEvent(new Event('input', { bubbles: true }));
        current.dispatchEvent(new Event('change', { bubbles: true }));
        close();
    }

    function listIdFor(el) {
        if (el.dataset.mmlist) return el.dataset.mmlist;
        var l = el.getAttribute('list');
        if (!l) return null;
        // Move it off the element so the browser stops drawing its own dropdown.
        el.dataset.mmlist = l;
        el.removeAttribute('list');
        el.setAttribute('autocomplete', 'off');
        return l;
    }

    function eligible(el) {
        return el && el.tagName === 'INPUT' && !el.disabled && !el.readOnly &&
               !el.hasAttribute('data-nocombo') &&
               (el.hasAttribute('list') || el.dataset.mmlist);
    }

    function open(el) {
        var listId = listIdFor(el);
        if (!listId) return;
        current = el;
        matches = filter(listId, el.value);
        active = matches.length ? 0 : -1;
        render(el.value);
    }

    document.addEventListener('focusin', function (e) {
        if (!eligible(e.target)) { if (current && e.target !== current) { current = null; close(); } return; }
        open(e.target);
    });

    document.addEventListener('input', function (e) {
        if (e.target !== current) { if (eligible(e.target)) open(e.target); return; }
        var listId = current.dataset.mmlist;
        matches = filter(listId, current.value);
        active = matches.length ? 0 : -1;
        render(current.value);
    });

    document.addEventListener('focusout', function (e) {
        if (e.target === current) setTimeout(function () {
            if (document.activeElement !== current) { current = null; close(); }
        }, 90);
    });

    /* Capture phase, deliberately: keyboard-nav.js listens on the bubble phase
       and moves focus to the next field on Enter. Running first lets us commit
       the highlighted medicine and then LET THAT HAPPEN — so one Enter both
       picks the drug and advances, which is what makes blind typing quick. */
    document.addEventListener('keydown', function (e) {
        if (!current || e.target !== current) return;
        var open_ = box && box.classList.contains('open');

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!open_) { open(current); return; }
            e.preventDefault();
            if (!matches.length) return;
            active += (e.key === 'ArrowDown' ? 1 : -1);
            if (active < 0) active = matches.length - 1;
            if (active >= matches.length) active = 0;
            render(current.value);
            return;
        }
        if (e.key === 'Escape') {
            if (open_) { e.preventDefault(); e.stopPropagation(); close(); }  // don't let Esc navigate back
            return;
        }
        if (e.key === 'Enter') {
            if (open_ && active >= 0 && matches[active]) commit(matches[active]);
            return;   // no stopPropagation — keyboard-nav moves to the next field
        }
        if (e.key === 'Tab') {
            if (open_ && active >= 0 && matches[active]) commit(matches[active]);
            return;
        }
    }, true);

    window.addEventListener('resize', place);
    window.addEventListener('scroll', function () { if (current) place(); }, true);

    window.mmCombo = {
        // Call after rewriting a <datalist> if the option COUNT did not change.
        invalidate: function (listId) {
            if (listId) delete cache[listId]; else cache = {};
        },
        close: close,
    };
})();
