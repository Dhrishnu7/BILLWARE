/* ══════════════════════════════════════════════════════════════════════
   MM Pakkam — In-website modal dialogs (replaces native alert/confirm/prompt)
   Provides promise-based:  mmAlert(msg, opts)  mmConfirm(msg, opts)  mmPrompt(msg, defaultVal, opts)
   Also overrides window.alert so plain alert() calls become styled popups.
   Self-contained: injects its own CSS + DOM, namespaced with `mmd-`.

   Options: { title, okText, cancelText, danger, variant, defaultValue,
              placeholder, emoji }
   `variant` is one of success | info | warn | danger | ask. It drives the
   icon, the icon tint and the primary button colour together, so a dialog
   can never show (say) a blue info glyph on a pink chip above a red button.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.__mmModalReady) return;
    window.__mmModalReady = true;

    // ── Icons ──
    // Inline stroke SVGs rather than emoji: emoji render differently on every
    // platform, carry their own colour (which fought the tinted chip behind
    // them) and always read as clip-art next to real UI type.
    var SVG = {
        success: '<path d="M20 6 9 17l-5-5"/>',
        info:    '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
        warn:    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        danger:  '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        ask:     '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
        edit:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
    };
    function iconSvg(name) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
             + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
             + (SVG[name] || SVG.info) + '</svg>';
    }

    // ── Styles ──
    var css = ''
      + '.mmd-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);'
      + 'backdrop-filter:blur(8px) saturate(120%);-webkit-backdrop-filter:blur(8px) saturate(120%);'
      + 'display:flex;align-items:center;justify-content:center;z-index:2147483000;opacity:0;'
      + 'pointer-events:none;transition:opacity .22s ease;padding:1.25rem;}'
      + '.mmd-overlay.mmd-open{opacity:1;pointer-events:auto;}'

      + '.mmd-card{background:#fff;border-radius:20px;width:100%;max-width:432px;'
      + 'border:1px solid rgba(15,23,42,.06);'
      + 'box-shadow:0 1px 2px rgba(15,23,42,.04),0 12px 28px -8px rgba(15,23,42,.18),0 40px 64px -32px rgba(15,23,42,.22);'
      + 'transform:scale(.96) translateY(10px);opacity:.6;'
      + 'transition:transform .26s cubic-bezier(.16,1,.3,1),opacity .2s ease;overflow:hidden;'
      + "font-family:'Inter',system-ui,-apple-system,sans-serif;"
      // Default accent (used by the confirm/prompt dialogs, which are the common case)
      + '--mmd-accent:#e11d48;--mmd-accent-2:#be123c;--mmd-tint:#fff1f2;--mmd-ring:rgba(225,29,72,.16);--mmd-ico:#e11d48;}'
      + '.mmd-overlay.mmd-open .mmd-card{transform:scale(1) translateY(0);opacity:1;}'

      // Semantic palettes — chip tint, glyph colour and button all move together.
      + '.mmd-card[data-v="success"]{--mmd-accent:#059669;--mmd-accent-2:#047857;--mmd-tint:#ecfdf5;--mmd-ring:rgba(5,150,105,.18);--mmd-ico:#059669;}'
      + '.mmd-card[data-v="info"]{--mmd-accent:#0f172a;--mmd-accent-2:#1e293b;--mmd-tint:#eff6ff;--mmd-ring:rgba(37,99,235,.16);--mmd-ico:#2563eb;}'
      + '.mmd-card[data-v="warn"]{--mmd-accent:#b45309;--mmd-accent-2:#92400e;--mmd-tint:#fffbeb;--mmd-ring:rgba(217,119,6,.2);--mmd-ico:#d97706;}'
      + '.mmd-card[data-v="danger"]{--mmd-accent:#dc2626;--mmd-accent-2:#b91c1c;--mmd-tint:#fef2f2;--mmd-ring:rgba(220,38,38,.18);--mmd-ico:#dc2626;}'
      + '.mmd-card[data-v="ask"]{--mmd-accent:#e11d48;--mmd-accent-2:#be123c;--mmd-tint:#fff1f2;--mmd-ring:rgba(225,29,72,.16);--mmd-ico:#e11d48;}'

      + '.mmd-hd{display:flex;align-items:center;gap:.8rem;padding:1.5rem 1.5rem .75rem;}'
      + '.mmd-ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;'
      + 'justify-content:center;flex-shrink:0;background:var(--mmd-tint);color:var(--mmd-ico);'
      + 'box-shadow:inset 0 0 0 1px var(--mmd-ring);font-size:1.15rem;line-height:1;}'
      + '.mmd-ico svg{width:21px;height:21px;display:block;}'
      + '.mmd-title{font-size:1.0625rem;font-weight:700;color:#0f172a;line-height:1.25;letter-spacing:-.011em;}'

      + '.mmd-bd{padding:0 1.5rem 1.35rem;font-size:.9rem;color:#475569;line-height:1.6;'
      + 'white-space:pre-wrap;word-break:break-word;}'
      + '.mmd-input{width:100%;margin-top:.95rem;font-family:inherit;font-size:.9rem;color:#0f172a;'
      + 'background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:11px;padding:.7rem .9rem;'
      + 'outline:none;box-sizing:border-box;transition:border-color .16s,box-shadow .16s,background .16s;}'
      + '.mmd-input:focus{border-color:var(--mmd-accent);background:#fff;box-shadow:0 0 0 3px var(--mmd-ring);}'

      // A quiet footer band anchors the buttons instead of letting them float.
      + '.mmd-ft{display:flex;gap:.6rem;justify-content:flex-end;padding:.9rem 1.5rem;'
      + 'background:#f8fafc;border-top:1px solid #eef2f7;}'
      + '.mmd-btn{font-family:inherit;font-size:.875rem;font-weight:600;border-radius:10px;'
      + 'padding:.6rem 1.15rem;cursor:pointer;border:1px solid transparent;'
      + 'transition:background .16s,border-color .16s,box-shadow .16s,transform .08s;'
      + 'letter-spacing:-.005em;}'
      + '.mmd-btn:active{transform:translateY(1px);}'
      + '.mmd-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--mmd-ring);}'
      + '.mmd-btn-cancel{background:#fff;color:#475569;border-color:#e2e8f0;'
      + 'box-shadow:0 1px 2px rgba(15,23,42,.04);}'
      + '.mmd-btn-cancel:hover{background:#f1f5f9;border-color:#cbd5e1;color:#334155;}'
      + '.mmd-btn-ok{background:var(--mmd-accent);color:#fff;box-shadow:0 1px 2px rgba(15,23,42,.12);}'
      + '.mmd-btn-ok:hover{background:var(--mmd-accent-2);}'

      + '@media(max-width:480px){.mmd-ft{flex-direction:column-reverse;padding:.9rem 1.25rem;}'
      + '.mmd-btn{width:100%;padding:.7rem 1rem;}.mmd-hd{padding:1.25rem 1.25rem .65rem;}'
      + '.mmd-bd{padding:0 1.25rem 1.15rem;}}'
      + '@media(prefers-reduced-motion:reduce){.mmd-overlay,.mmd-card{transition:none;}}';

    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    var overlay = null;
    var activeResolve = null;      // resolver for the currently-open dialog
    var getConfirmValue = null;    // fn → value when user confirms current dialog
    var getCancelValue = null;     // fn → value when user cancels/dismisses current dialog
    var lastFocused = null;        // element to restore focus to on close
    var prevBodyOverflow = '';

    /* ─────────────────────────────────────────────────────────────
       BACKING OUT IS NOT THE SAME AS ANSWERING

       Escape and a click on the backdrop used to resolve to the CANCEL
       value. That is right when the second button is a refusal
       ("Cancel", "Go back") — backing out and refusing are the same
       thing, and every existing call site relies on it.

       It is wrong when the second button is a real ANSWER. khata asked
       "Is Ravi's ₹500 per DAY or per MONTH?" with Per month / Per day
       as the two buttons, so pressing Escape — the universal "I have
       not decided" gesture — silently recorded Per day, the option
       that then multiplies by days worked. Three ways of declining to
       answer all committed the expensive answer.

       Two opt-in controls, both defaulting to the old behaviour so no
       existing dialog changes:

         dismiss: <value>    what Esc / backdrop resolve to, when that
                             must differ from the cancel BUTTON. Use
                             null for "no answer given".
         dismissible: false  Esc and backdrop do nothing at all. For
                             questions with no safe default, where the
                             only way out is to choose.

       A button click always means what the button says; only the
       ways of NOT choosing are affected.
    ───────────────────────────────────────────────────────────── */
    var getDismissValue = null;    // fn → value for Esc/backdrop, or null if not dismissible

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'mmd-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        document.body.appendChild(overlay);

        // Listeners attached ONCE (overlay + document persist for the app's life).
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay && activeResolve && getDismissValue) close(getDismissValue());
        });
        document.addEventListener('keydown', function (e) {
            if (!activeResolve) return;
            /* Enter is NOT a way of backing out — it activates the confirm
               button, which is an explicit choice, so it stays as it was even
               on a dialog that refuses to be dismissed. */
            if (e.key === 'Escape') { if (getDismissValue) { e.preventDefault(); close(getDismissValue()); } }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); close(getConfirmValue()); }
            else if (e.key === 'Tab') trapFocus(e);
        });
    }

    // Keep keyboard focus inside the dialog while it is open.
    function trapFocus(e) {
        var f = overlay.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function close(value) {
        if (!activeResolve) return;
        var r = activeResolve;
        activeResolve = null;
        getConfirmValue = null;
        getCancelValue = null;
        getDismissValue = null;
        overlay.classList.remove('mmd-open');
        try { document.body.style.overflow = prevBodyOverflow; } catch (e) {}
        setTimeout(function () { if (overlay && !activeResolve) overlay.innerHTML = ''; }, 240);
        try { if (lastFocused && lastFocused.focus) lastFocused.focus(); } catch (e) {}
        lastFocused = null;
        r(value);
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* Work out the tone of a plain alert from its own wording.
       There are ~58 call sites and almost none pass a variant, so without this
       a cheerful "Saved successfully!" would render with the same warning-ish
       chrome as a failure. Explicit opts.variant always wins over the guess. */
    function inferVariant(message) {
        var m = String(message || '');
        if (/✅|✔|🎉|success|successful|saved|updated|restored|completed|sent!|done!/i.test(m)) return 'success';
        if (/❌|⛔|error|failed|could not|couldn't|unable to|denied|invalid/i.test(m))         return 'danger';
        if (/⚠️|⚠|warning|careful|cannot be undone|permanently/i.test(m))                     return 'warn';
        return 'info';
    }

    var TITLES = { success: 'Done', danger: 'Something went wrong', warn: 'Heads up', info: 'Notice', ask: 'Please confirm' };
    var ICON_FOR = { success: 'success', danger: 'danger', warn: 'warn', info: 'info', ask: 'ask' };

    // kind: 'alert' | 'confirm' | 'prompt'
    function open(kind, message, opts) {
        opts = opts || {};
        ensureOverlay();
        /* If a dialog is already open, resolve it first so we never deadlock.
           Being shoved aside by another dialog is not an answer either, so
           prefer the dismiss value where one was set. Something must be
           resolved — a hung promise is worse than a wrong one — so a
           non-dismissible dialog still falls back to its cancel value here. */
        if (activeResolve) {
            close(getDismissValue ? getDismissValue()
                : getCancelValue ? getCancelValue() : undefined);
        }

        var isConfirm = kind === 'confirm';
        var isPrompt = kind === 'prompt';
        var danger = !!opts.danger;

        var variant = opts.variant ? opts.variant
                      : danger ? 'danger'
                      : (isConfirm || isPrompt) ? 'ask'
                      : inferVariant(message);

        var iconName = isPrompt && !opts.variant && !danger ? 'edit' : (ICON_FOR[variant] || 'info');
        var iconHtml = opts.emoji ? esc(opts.emoji) : iconSvg(iconName);

        /* A CONFIRM IS A QUESTION, NEVER AN ERROR REPORT.

           `danger: true` is how every destructive confirm in the app says
           "colour this red" — but TITLES.danger is 'Something went wrong',
           written for alerts. So "Delete this bill?", "Empty the Bin?" and
           "Clear ALL Sales & Purchases?" all appeared under a red heading
           claiming a failure had already happened. Nine dialogs across four
           pages, including the ones that delete the most.

           That framing is actively harmful on a destructive prompt: somebody
           who believes the app has just broken clicks the primary button to
           clear the error out of the way — and here that button confirms the
           deletion.

           Fixed once, here, rather than by passing a title at nine call sites,
           so the tenth destructive dialog somebody writes is right by default. */
        var title = opts.title != null ? opts.title
                    : isPrompt ? 'Enter value'
                    : isConfirm ? (variant === 'danger' ? 'Please confirm'
                                                        : (TITLES[variant] || 'Please confirm'))
                    : (TITLES[variant] || 'Notice');
        var okText = opts.okText || 'OK';
        var cancelText = opts.cancelText || 'Cancel';

        var inputHtml = isPrompt
            ? '<input class="mmd-input" id="mmdInput" type="text" value="' + esc(opts.defaultValue || '') + '" placeholder="' + esc(opts.placeholder || '') + '">'
            : '';
        var cancelBtn = (isConfirm || isPrompt)
            ? '<button type="button" class="mmd-btn mmd-btn-cancel" id="mmdCancel">' + esc(cancelText) + '</button>'
            : '';

        lastFocused = document.activeElement;
        try { prevBodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; } catch (e) {}

        overlay.innerHTML =
            '<div class="mmd-card" role="document" data-v="' + esc(variant) + '" aria-labelledby="mmdTitle" aria-describedby="mmdBody">'
          +   '<div class="mmd-hd"><div class="mmd-ico">' + iconHtml + '</div>'
          +     '<div class="mmd-title" id="mmdTitle">' + esc(title) + '</div></div>'
          +   '<div class="mmd-bd" id="mmdBody">' + esc(message) + inputHtml + '</div>'
          +   '<div class="mmd-ft">' + cancelBtn
          +     '<button type="button" class="mmd-btn mmd-btn-ok" id="mmdOk">' + esc(okText) + '</button>'
          +   '</div>'
          + '</div>';

        // Force reflow then open (for the enter transition).
        void overlay.offsetWidth;
        overlay.classList.add('mmd-open');

        var input = document.getElementById('mmdInput');
        var okBtn = document.getElementById('mmdOk');
        var cancelBtnEl = document.getElementById('mmdCancel');

        getConfirmValue = function () { return isPrompt ? (input ? input.value : '') : isConfirm ? true : undefined; };
        getCancelValue = function () { return isPrompt ? null : isConfirm ? false : undefined; };

        /* Esc / backdrop. Defaults to the cancel value, so every dialog that
           does not opt in behaves exactly as before. `dismissible: false`
           leaves this null, and the two listeners then ignore both gestures. */
        if (opts.dismissible === false) {
            getDismissValue = null;
        } else if (Object.prototype.hasOwnProperty.call(opts, 'dismiss')) {
            getDismissValue = function () { return opts.dismiss; };
        } else {
            getDismissValue = getCancelValue;
        }

        okBtn.addEventListener('click', function () { close(getConfirmValue()); });
        if (cancelBtnEl) cancelBtnEl.addEventListener('click', function () { close(getCancelValue()); });

        setTimeout(function () {
            if (input) { input.focus(); input.select(); }
            else if (okBtn) okBtn.focus();
        }, 60);

        return new Promise(function (resolve) { activeResolve = resolve; });
    }

    window.mmAlert = function (message, opts) { return open('alert', message, opts); };
    window.mmConfirm = function (message, opts) { return open('confirm', message, opts); };
    window.mmPrompt = function (message, defaultVal, opts) {
        opts = opts || {};
        if (defaultVal != null && opts.defaultValue == null) opts.defaultValue = defaultVal;
        return open('prompt', message, opts);
    };

    // Drop-in replacement for native alert() — styled, non-blocking.
    window.alert = function (message) { return open('alert', message, {}); };
})();
