/* ══════════════════════════════════════════════════════════════════════
   MM Pakkam — In-website modal dialogs (replaces native alert/confirm/prompt)
   Provides promise-based:  mmAlert(msg, opts)  mmConfirm(msg, opts)  mmPrompt(msg, defaultVal, opts)
   Also overrides window.alert so plain alert() calls become styled popups.
   Self-contained: injects its own CSS + DOM, namespaced with `mmd-`.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.__mmModalReady) return;
    window.__mmModalReady = true;

    // ── Inject styles once ──
    var css = ''
      + '.mmd-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.55);'
      + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;'
      + 'align-items:center;justify-content:center;z-index:2147483000;opacity:0;'
      + 'pointer-events:none;transition:opacity .2s ease;padding:1rem;}'
      + '.mmd-overlay.mmd-open{opacity:1;pointer-events:auto;}'
      + '.mmd-card{background:#fff;border-radius:22px;width:100%;max-width:420px;'
      + 'box-shadow:0 25px 60px rgba(0,0,0,0.28);transform:scale(.94) translateY(14px);'
      + 'transition:transform .28s cubic-bezier(.175,.885,.32,1.275);overflow:hidden;'
      + "font-family:'Inter',system-ui,sans-serif;}"
      + '.mmd-overlay.mmd-open .mmd-card{transform:scale(1) translateY(0);}'
      + '.mmd-hd{display:flex;align-items:center;gap:.7rem;padding:1.3rem 1.6rem .4rem;}'
      + '.mmd-ico{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;'
      + 'justify-content:center;font-size:1.25rem;flex-shrink:0;}'
      + '.mmd-ico.info{background:#fff1f2;}.mmd-ico.warn{background:#fef3c7;}'
      + '.mmd-ico.danger{background:#fee2e2;}.mmd-ico.ask{background:#e0e7ff;}'
      + '.mmd-title{font-size:1.05rem;font-weight:800;color:#0f172a;line-height:1.2;}'
      + '.mmd-bd{padding:.6rem 1.6rem 1.1rem;font-size:.92rem;color:#475569;line-height:1.5;white-space:pre-wrap;word-break:break-word;}'
      + '.mmd-input{width:100%;margin-top:.9rem;font-family:inherit;font-size:.92rem;color:#0f172a;'
      + 'background:#fff1f2;border:1.5px solid #fecdd3;border-radius:10px;padding:.7rem 1rem;outline:none;box-sizing:border-box;transition:all .2s;}'
      + '.mmd-input:focus{border-color:#f43f5e;background:#fff;box-shadow:0 0 0 3px rgba(244,63,94,.12);}'
      + '.mmd-ft{display:flex;gap:.7rem;justify-content:flex-end;padding:0 1.6rem 1.4rem;}'
      + '.mmd-btn{font-family:inherit;font-size:.9rem;font-weight:700;border-radius:11px;'
      + 'padding:.65rem 1.4rem;cursor:pointer;border:1.5px solid transparent;transition:all .18s;}'
      + '.mmd-btn-cancel{background:#f1f5f9;color:#475569;border-color:#e2e8f0;}'
      + '.mmd-btn-cancel:hover{background:#e2e8f0;}'
      + '.mmd-btn-ok{background:linear-gradient(135deg,#f43f5e,#e11d48);color:#fff;box-shadow:0 4px 14px rgba(244,63,94,.3);}'
      + '.mmd-btn-ok:hover{filter:brightness(1.05);}'
      + '.mmd-btn-ok.danger{background:linear-gradient(135deg,#ef4444,#b91c1c);box-shadow:0 4px 14px rgba(220,38,38,.32);}'
      + '@media(max-width:480px){.mmd-ft{flex-direction:column-reverse;}.mmd-btn{width:100%;}}';
    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    var overlay = null;
    var activeResolve = null;      // resolver for the currently-open dialog
    var getConfirmValue = null;    // fn → value when user confirms current dialog
    var getCancelValue = null;     // fn → value when user cancels/dismisses current dialog

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'mmd-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        document.body.appendChild(overlay);

        // Listeners attached ONCE (overlay + document persist for the app's life).
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay && activeResolve && getCancelValue) close(getCancelValue());
        });
        document.addEventListener('keydown', function (e) {
            if (!activeResolve) return;
            if (e.key === 'Escape') { e.preventDefault(); close(getCancelValue()); }
            else if (e.key === 'Enter') { e.preventDefault(); close(getConfirmValue()); }
        });
    }

    function close(value) {
        if (!activeResolve) return;
        var r = activeResolve;
        activeResolve = null;
        getConfirmValue = null;
        getCancelValue = null;
        overlay.classList.remove('mmd-open');
        setTimeout(function () { if (overlay && !activeResolve) overlay.innerHTML = ''; }, 220);
        r(value);
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // kind: 'alert' | 'confirm' | 'prompt'
    function open(kind, message, opts) {
        opts = opts || {};
        ensureOverlay();
        // If a dialog is already open, resolve it first so we never deadlock.
        if (activeResolve) close(getCancelValue ? getCancelValue() : undefined);

        var isConfirm = kind === 'confirm';
        var isPrompt = kind === 'prompt';
        var danger = !!opts.danger;
        var iconClass = opts.icon ? opts.icon
                        : danger ? 'danger'
                        : isConfirm ? 'warn'
                        : isPrompt ? 'ask' : 'info';
        var emoji = opts.emoji ? opts.emoji
                    : danger ? '⚠️'
                    : isConfirm ? '❓'
                    : isPrompt ? '✏️' : 'ℹ️';
        var title = opts.title != null ? opts.title
                    : isConfirm || danger ? 'Please Confirm'
                    : isPrompt ? 'Enter Value' : 'Notice';
        var okText = opts.okText || 'OK';
        var cancelText = opts.cancelText || 'Cancel';

        var inputHtml = isPrompt
            ? '<input class="mmd-input" id="mmdInput" type="text" value="' + esc(opts.defaultValue || '') + '" placeholder="' + esc(opts.placeholder || '') + '">'
            : '';
        var cancelBtn = (isConfirm || isPrompt)
            ? '<button class="mmd-btn mmd-btn-cancel" id="mmdCancel">' + esc(cancelText) + '</button>'
            : '';

        overlay.innerHTML =
            '<div class="mmd-card" role="document">'
          +   '<div class="mmd-hd"><div class="mmd-ico ' + iconClass + '">' + emoji + '</div>'
          +     '<div class="mmd-title">' + esc(title) + '</div></div>'
          +   '<div class="mmd-bd">' + esc(message) + inputHtml + '</div>'
          +   '<div class="mmd-ft">' + cancelBtn
          +     '<button class="mmd-btn mmd-btn-ok' + (danger ? ' danger' : '') + '" id="mmdOk">' + esc(okText) + '</button>'
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
