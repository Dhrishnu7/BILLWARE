/**
 * keyboard-nav.js — Billware Global Keyboard Navigation
 * -------------------------------------------------------
 * Makes every form page navigable without a mouse.
 *
 * Shortcuts:
 *  - Enter     → moves to next input field (never submits form by accident)
 *  - F9        → jumps focus to the first [type=submit] button
 *  - Alt + S   → triggers the first [type=submit] button
 *  - F2        → fires window.__kbAddRow() if defined (sales page only)
 *  - Esc       → closes any open modal overlay, otherwise clicks the Back button
 *
 * Works automatically on every page it is loaded into.
 * Mouse + click behaviour is fully preserved.
 */
(function () {
    'use strict';

    function isModalOpen() {
        return !!(
            document.querySelector('.modal-overlay.open') ||
            document.querySelector('.qa-modal-overlay.open')
        );
    }

    /* ── Enter key → Tab through form ───────────────── */
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;

        // Let pages use Ctrl/Cmd+Enter as their own shortcut (e.g. save the bill)
        if (e.ctrlKey || e.metaKey) return;

        // Let buttons do their own click (Space/Enter)
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'button' || tag === 'a') return;

        // Textareas: Enter should still create new lines
        if (tag === 'textarea') return;

        // Don't intercept inside modals — modals handle their own Enter
        if (isModalOpen()) return;

        e.preventDefault();

        // Gather all focusable, non-readonly, non-disabled inputs & selects
        const focusables = Array.from(
            document.querySelectorAll('input:not([type="hidden"]), select, textarea')
        ).filter(function (el) {
            return !el.readOnly &&
                   !el.disabled &&
                   el.tabIndex !== -1 &&
                   el.offsetParent !== null; // visible check
        });

        const idx = focusables.indexOf(e.target);
        if (idx === -1) return;

        if (idx < focusables.length - 1) {
            const next = focusables[idx + 1];
            next.focus();
            if (typeof next.select === 'function') next.select();
        } else {
            // Last field on the page — if a custom row-adder is set, call it
            if (typeof window.__kbAddRow === 'function') {
                window.__kbAddRow();
            }
        }
    });

    /* ── Global shortcuts (F2, F9, Alt+S, Esc) ──────── */
    document.addEventListener('keydown', function (e) {

        // Esc → close any open modal, otherwise go back
        if (e.key === 'Escape') {
            const modal =
                document.querySelector('.modal-overlay.open') ||
                document.querySelector('.qa-modal-overlay.open');
            if (modal) {
                modal.classList.remove('open');
                e.preventDefault();
                return;
            }
            const backBtn = document.querySelector('.back-btn');
            if (backBtn) {
                e.preventDefault();
                backBtn.click();
            }
            return;
        }

        // Don't fire shortcuts when typing inside inputs/textareas
        const tag = e.target.tagName.toLowerCase();
        const inField = ['input', 'textarea', 'select'].includes(tag);

        if (inField) return;

        // F2 → add a new row (sales page hook)
        if (e.key === 'F2') {
            e.preventDefault();
            if (typeof window.__kbAddRow === 'function') window.__kbAddRow();
            return;
        }

        // F9 → focus the Save / Submit button
        if (e.key === 'F9') {
            e.preventDefault();
            const btn =
                document.querySelector('button[type="submit"]') ||
                document.getElementById('saveBtn');
            if (btn) btn.focus();
            return;
        }

        // Alt + S → click the Save / Submit button
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            const btn =
                document.querySelector('button[type="submit"]') ||
                document.getElementById('saveBtn');
            if (btn && !btn.disabled) btn.click();
            return;
        }
    });

})();
