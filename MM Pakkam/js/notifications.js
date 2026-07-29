/**
 * Billware — Notification Engine v2
 * Categories:
 *   💊 medicines  — expiry & stock alerts (from purchases)
 *   📋 requests   — shop edit / extra worker request approvals
 *   📊 business   — daily sales summary
 *   📢 updates    — system announcements
 */

const MMNotifications = (() => {

    // ── Storage keys per logged-in user ──
    // Go through mmGetSession(): reading localStorage first, as this used to,
    // returns a stale session left behind by a previous account when the current
    // one signed in without "remember me" — i.e. the wrong shop's inbox.
    const _tenant = () => {
        try {
            const s = (typeof mmGetSession === 'function')
                ? mmGetSession()
                : JSON.parse(sessionStorage.getItem('mm_auth_session')
                          || localStorage.getItem('mm_auth_session') || 'null');
            return s ? (s.tenant_id || s.username) : 'anon';
        } catch { return 'anon'; }
    };
    const STORAGE_KEY  = () => `mm_notif_read_${_tenant()}`;
    const CLEARED_KEY  = () => `mm_notif_cleared_${_tenant()}`;

    // Read messages auto-clear only after this long (≈6 months). The clock
    // starts when a message is marked read; unread messages never auto-clear.
    const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;

    // Read state is stored as { id: readAtISO } so we know WHEN each message was
    // read (needed for the 6-month auto-clear). Older builds stored a plain array
    // of ids with no timestamp — migrate that to the timestamped map, stamped
    // "now", so those messages stay visible and start a fresh 6-month clock
    // instead of vanishing. (Marking a message read no longer deletes it.)
    function getReadMap() {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY())); } catch { raw = null; }
        if (!raw) return {};
        if (Array.isArray(raw)) {
            const now = new Date().toISOString();
            const map = {};
            raw.forEach(id => { map[id] = now; });
            try { localStorage.setItem(STORAGE_KEY(), JSON.stringify(map)); } catch {}
            return map;
        }
        return raw;
    }

    function getReadIds() {
        return new Set(Object.keys(getReadMap()));
    }

    function markRead(ids) {
        const map = getReadMap();
        const now = new Date().toISOString();
        ids.forEach(id => { if (!map[id]) map[id] = now; }); // keep original read time
        let entries = Object.entries(map);
        if (entries.length > 1000) {                          // cap: keep 1000 most-recent
            entries.sort((a, b) => (a[1] < b[1] ? 1 : -1));
            entries = entries.slice(0, 1000);
        }
        const trimmed = {};
        entries.forEach(([k, v]) => { trimmed[k] = v; });
        localStorage.setItem(STORAGE_KEY(), JSON.stringify(trimmed));
    }

    function markAllRead(notifications) {
        markRead(notifications.map(n => n.id));
    }

    // ── Cleared (manually dismissed) messages — hidden from the inbox for good ──
    function getClearedIds() {
        try { return new Set(JSON.parse(localStorage.getItem(CLEARED_KEY())) || []); }
        catch { return new Set(); }
    }

    function addCleared(ids) {
        const set = getClearedIds();
        ids.forEach(id => set.add(id));
        const arr = [...set].slice(-2000);
        localStorage.setItem(CLEARED_KEY(), JSON.stringify(arr));
    }

    // True when a read message is old enough (>6 months) to auto-clear.
    function isReadExpired(id) {
        const t = getReadMap()[id];
        return t ? (Date.now() - new Date(t).getTime()) > SIX_MONTHS_MS : false;
    }

    // ─────────────────────────────────────
    // HELPER: build a notification object
    // ─────────────────────────────────────
    function notif({ id, category, type, priority, title, message, icon, color, bg, border, time, readIds }) {
        return {
            id, category, type, priority, title, message, icon, color, bg, border, time,
            isRead: readIds.has(id)
        };
    }

    // Per-item reorder level — MUST stay identical to the Inventory "To Buy" tab
    // (inventory.html): a manual override in mm_reorder_levels if the owner set one,
    // otherwise a smart default = ceil(30-day sales/day × 7). Keeping the two in
    // sync means the 🔔 Low Stock alert fires for EXACTLY the medicines on the
    // To Buy reorder list — no flat "10 units" cutoff that misses fast movers or
    // nags about slow ones.
    function _reorderCtx() {
        const WIN = 30;
        const cutoff = new Date(Date.now() - WIN * 86400000).toISOString().slice(0, 10);
        const sold = {};
        let bills = [];
        try { bills = JSON.parse(localStorage.getItem('mm_sales') || '[]'); } catch {}
        (bills || []).forEach(b => {
            if (b.isReturn) return;
            const d = String(b.date || '').slice(0, 10);
            if (d < cutoff) return;
            (b.medicines || []).forEach(m => {
                const k = (m.product || '').trim().toLowerCase();
                if (k) sold[k] = (sold[k] || 0) + (parseFloat(m.qty) || 0);
            });
        });
        let overrides = {};
        try { overrides = JSON.parse(localStorage.getItem('mm_reorder_levels') || '{}'); } catch {}
        return { sold, overrides, win: WIN };
    }

    function _reorderLevelFor(name, ctx) {
        const k = (name || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(ctx.overrides, k)) {
            return parseFloat(ctx.overrides[k]) || 0;
        }
        return Math.ceil(((ctx.sold[k] || 0) / ctx.win) * 7);
    }

    // ─────────────────────────────────────
    // 1. MEDICINES — Expiry & Stock Alerts
    // ─────────────────────────────────────
    function generateMedicineAlerts(purchases) {
        if (!purchases || !purchases.length) return [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const readIds = getReadIds();
        const results = [];
        const roCtx = _reorderCtx();   // reorder levels — same source as the To Buy tab

        // Use the ONE shared stock formula (js/supabase.js) so alerts reflect
        // REAL current stock = purchased − sold + adjustments. Summing raw
        // purchase quantities here (the old way) meant low/out-of-stock alerts
        // never fired for medicines that had actually been sold down, and expiry
        // alerts kept nagging about batches that were already sold out — the
        // "important notifications get missed / buried" bug. Falls back to the
        // raw purchased total only if the shared formula isn't loaded.
        const hasStockFn = (typeof window !== 'undefined' && typeof window.mmComputeStock === 'function');
        const stockOf = (name, batch) => {
            if (hasStockFn) { try { return Number(window.mmComputeStock(name, batch)) || 0; } catch (e) {} }
            return null; // signal "unknown"
        };

        // Group by product name → collect batches (with expiry) + raw fallback qty
        const stockMap = {};
        purchases.forEach(p => {
            const name = (p.product_name || p.productName || '').trim();
            if (!name) return;
            if (!stockMap[name]) stockMap[name] = { fallbackQty: 0, batches: [], seenBatch: new Set() };
            const qty  = Number(p.quantity || p.qty || 0);
            const pack = Number(p.pack) > 0 ? Number(p.pack) : 1;
            stockMap[name].fallbackQty += qty * pack;
            const expiry = p.expire_date || p.expireDate || p.exp;
            const batch  = p.batch_no || p.batchNo || p.batch || '—';
            if (expiry) {
                const key = String(batch).toLowerCase();
                if (!stockMap[name].seenBatch.has(key)) {   // de-dupe repeat purchases of same batch
                    stockMap[name].seenBatch.add(key);
                    stockMap[name].batches.push({ expiry, batch });
                }
            }
        });

        Object.entries(stockMap).forEach(([name, info]) => {
            let hasFreshBatch = false;

            // Expiry alerts — only for batches that STILL hold stock
            info.batches.forEach(b => {
                const expDate = new Date(b.expiry);
                if (isNaN(expDate)) return;
                expDate.setHours(0, 0, 0, 0);
                const daysLeft = Math.round((expDate - today) / 86400000);
                if (daysLeft >= 0) hasFreshBatch = true;
                if (daysLeft < -30 || daysLeft > 90) return; // outside alert window — skip (also avoids needless stock calls)

                // Skip batches already sold out — not actionable, and they bury the real alerts.
                const batchStock = stockOf(name, b.batch);
                if (batchStock !== null && batchStock <= 0) return;

                const expStr = expDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                if (daysLeft < 0) {
                    results.push(notif({ id: `exp_${name}_${b.batch}_expired`, category: 'medicines', type: 'expired', priority: 1, readIds,
                        title: `${name} — EXPIRED`, icon: '💀', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', time: expStr,
                        message: `Batch <b>${b.batch}</b> expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft)!==1?'s':''} ago. Remove from stock immediately.`
                    }));
                } else if (daysLeft <= 30) {
                    results.push(notif({ id: `exp_${name}_${b.batch}_30`, category: 'medicines', type: 'expiring_soon', priority: 2, readIds,
                        title: `${name} — Expiring in ${daysLeft} days`, icon: '🔴', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', time: expStr,
                        message: `Batch <b>${b.batch}</b> expires on ${expStr}. Consider selling or returning to supplier.`
                    }));
                } else {
                    results.push(notif({ id: `exp_${name}_${b.batch}_90`, category: 'medicines', type: 'expiring_notice', priority: 3, readIds,
                        title: `${name} — Expiry Notice`, icon: '🟡', color: '#ca8a04', bg: '#fefce8', border: '#fde68a', time: expStr,
                        message: `Batch <b>${b.batch}</b> expires on ${expStr} (${daysLeft} days). Plan accordingly.`
                    }));
                }
            });

            // Stock alerts — REAL current stock (purchased − sold + adjustments),
            // shown for EVERY product regardless of expiry data. (A previous
            // "only if it has a non-expired batch" gate silently hid low/out-of-
            // stock alerts for any medicine entered without an expiry date — the
            // "notifications sometimes miss low/out of stock" bug.)
            //
            // The Low-Stock trigger now uses each item's REORDER LEVEL — the exact
            // same number the Inventory → To Buy tab uses — instead of a flat 10.
            // So the bell flags precisely the medicines on your reorder list: it
            // won't miss a fast-mover that's low, and won't nag about a slow item
            // that's fine. Items with no reorder level (non-movers, level 0) aren't
            // on the To Buy list, so they get no stock nag here either.
            const current = stockOf(name);
            const qty = (current !== null) ? current : info.fallbackQty;
            const level = _reorderLevelFor(name, roCtx);
            if (level > 0) {
                if (qty <= 0) {
                    const buy = Math.max(1, Math.ceil(level * 2));
                    results.push(notif({ id: `stock_${name}_out`, category: 'medicines', type: 'out_of_stock', priority: 1, readIds,
                        title: `${name} — Out of Stock`, icon: '🚫', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', time: 'Reorder now',
                        message: `Zero units remaining. Suggested buy: <b>${buy}</b>. Open <b>Inventory → To Buy</b> to reorder before you lose sales.`
                    }));
                } else if (qty <= level) {
                    const buy = Math.max(1, Math.ceil((level * 2) - qty));
                    results.push(notif({ id: `stock_${name}_low`, category: 'medicines', type: 'low_stock', priority: 2, readIds,
                        title: `${name} — Low Stock`, icon: '⚠️', color: '#d97706', bg: '#fffbeb', border: '#fde68a', time: 'Reorder soon',
                        message: `Only <b>${qty} unit${qty!==1?'s':''}</b> left (reorder level ${level}). Suggested buy: <b>${buy}</b>. See <b>Inventory → To Buy</b>.`
                    }));
                }
            }
        });

        return results;
    }

    // ─────────────────────────────────────
    // 2. REQUESTS — Approval / Rejection
    // ─────────────────────────────────────
    function generateRequestAlerts(shopEditReqs, extraUserReqs, customerIssues) {
        const readIds = getReadIds();
        const results = [];

        // Shop edit requests
        (shopEditReqs || []).forEach(r => {
            if (r.status === 'approved') {
                results.push(notif({ id: `req_edit_${r.id}_approved`, category: 'requests', type: 'request_approved', priority: 1, readIds,
                    title: 'Shop Edit Request Approved ✅', icon: '✅', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0',
                    time: r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Recently',
                    message: `Super Admin approved your request to edit shop details. You can now update your shop profile.`
                }));
            } else if (r.status === 'rejected') {
                results.push(notif({ id: `req_edit_${r.id}_rejected`, category: 'requests', type: 'request_rejected', priority: 2, readIds,
                    title: 'Shop Edit Request Rejected ❌', icon: '❌', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5',
                    time: r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Recently',
                    message: `Your request to edit shop details was declined by Super Admin.${r.reason ? ` Reason: "${r.reason}"` : ''}`
                }));
            }
        });

        // Extra worker account requests
        (extraUserReqs || []).forEach(r => {
            if (r.status === 'approved') {
                results.push(notif({ id: `req_worker_${r.id}_approved`, category: 'requests', type: 'request_approved', priority: 1, readIds,
                    title: 'Extra Worker Account Approved ✅', icon: '👤', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0',
                    time: r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Recently',
                    message: `Super Admin approved an additional worker account for your shop. You can now create it in Manage Users.`
                }));
            } else if (r.status === 'rejected') {
                results.push(notif({ id: `req_worker_${r.id}_rejected`, category: 'requests', type: 'request_rejected', priority: 2, readIds,
                    title: 'Extra Worker Request Rejected ❌', icon: '👤', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5',
                    time: r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Recently',
                    message: `Your request for an extra worker account was declined.${r.reason ? ` Reason: "${r.reason}"` : ''}`
                }));
            }
        });

        // Customer Support issues resolved by admin
        (customerIssues || []).forEach(r => {
            if (r.status === 'resolved') {
                results.push(notif({ id: `req_support_${r.id}_resolved`, category: 'requests', type: 'request_approved', priority: 1, readIds,
                    title: 'Customer Support Resolved 🎧', icon: '🎧', color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd',
                    time: r.resolved_at ? new Date(r.resolved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Recently',
                    message: `Super Admin has resolved your support issue: "${(r.issue_text||'').substring(0, 50)}..."`
                }));
            }
        });

        return results;
    }

    // ─────────────────────────────────────
    // 3. BUSINESS — Sales Summary
    // ─────────────────────────────────────
    function generateBusinessAlerts(bills) {
        const readIds = getReadIds();
        const results = [];
        if (!bills || !bills.length) return results;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().split('T')[0];
        const todayStr = today.toISOString().split('T')[0];

        // Today's sales
        const todayBills = bills.filter(b => (b.date || '').startsWith(todayStr));
        const todayTotal = todayBills.reduce((s, b) => s + (Number(b.grand_total) || 0), 0);

        // Yesterday's sales
        const yestBills = bills.filter(b => (b.date || '').startsWith(yStr));
        const yestTotal = yestBills.reduce((s, b) => s + (Number(b.grand_total) || 0), 0);

        const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        const todayId = `sales_today_${todayStr}`;
        const yestId = `sales_yest_${yStr}`;

        if (todayBills.length > 0) {
            results.push(notif({ id: todayId, category: 'business', type: 'sales_today', priority: 1, readIds,
                title: `Today's Sales — ${fmt(todayTotal)}`, icon: '📈', color: '#0891b2', bg: '#f0f9ff', border: '#bae6fd',
                time: "Today",
                message: `You've made <b>${todayBills.length} bill${todayBills.length!==1?'s':''}</b> worth <b>${fmt(todayTotal)}</b> so far today. Keep it up!`
            }));
        }

        if (yestBills.length > 0) {
            const trend = todayBills.length > 0
                ? (todayTotal >= yestTotal ? ' 📈 Today is on track to match or beat yesterday!' : '')
                : '';
            results.push(notif({ id: yestId, category: 'business', type: 'sales_yesterday', priority: 2, readIds,
                title: `Yesterday's Summary — ${fmt(yestTotal)}`, icon: '📊', color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe',
                time: yesterday.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
                message: `Completed <b>${yestBills.length} bill${yestBills.length!==1?'s':''}</b> for a total of <b>${fmt(yestTotal)}</b>.${trend}`
            }));
        }

        return results;
    }

    // ─────────────────────────────────────
    // 4. UPDATES — System Announcements
    // ─────────────────────────────────────
    function generateSystemAlerts(announcements) {
        const readIds = getReadIds();
        const results = [];

        // Static built-in announcements
        const builtIn = [
            {
                id: 'sys_inbox_launch',
                title: '🔔 Inbox Notifications Launched!',
                message: 'You now have a smart notification inbox. Get alerts for expiring medicines, low stock, request approvals, and daily sales — all in one place.',
                icon: '🎉', color: '#0891b2', bg: '#f0f9ff', border: '#bae6fd',
                time: 'Jun 2026'
            }
        ];

        builtIn.forEach(a => {
            results.push(notif({ ...a, category: 'updates', type: 'system', priority: 3, readIds }));
        });

        // Dynamic announcements from Supabase (if table exists)
        (announcements || []).forEach(a => {
            const id = `sys_ann_${a.id}`;
            results.push(notif({ id, category: 'updates', type: 'announcement', priority: 1, readIds,
                title: a.title || 'Announcement',
                message: a.message || '',
                icon: a.icon || '📢', color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe',
                time: a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
            }));
        });

        return results;
    }

    // ─────────────────────────────────────
    // 5. PROMISE ORDERS — arrived & ready to sell
    // ─────────────────────────────────────
    function generatePromiseAlerts(orders) {
        const readIds = getReadIds();
        const results = [];
        const esc = v => String(v == null ? '' : v).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        (orders || []).forEach(o => {
            if (o.status !== 'arrived') return; // only nag about backorders whose stock has landed
            results.push(notif({
                id: `promise_ready_${o.id}`, category: 'medicines', type: 'promise_ready', priority: 1, readIds,
                title: `Promise Order Ready — ${esc(o.medicine_name)}`,
                icon: '📦', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', time: 'Ready to sell',
                message: `Stock arrived for <b>${esc(o.customer_name)}</b>'s order of <b>${esc(o.medicine_name)}</b> (Qty ${esc(o.quantity)}). Ready to sell — 📞 call ${esc(o.customer_phone) || 'them (no phone on file)'}.`
            }));
        });
        return results;
    }

    // ─────────────────────────────────────
    // 6. BACKUP — remind the shop to take a data backup
    // ─────────────────────────────────────
    // The last-backup time is stamped per-tenant by report.html's backupData()
    // as `mm_last_backup_<tenant>`. We only nag when there's data worth losing
    // and it's been a week+ (or never). The id carries a weekly bucket so a
    // still-overdue shop is reminded again at most once a week, not every day.
    function generateBackupAlerts(hasData) {
        if (!hasData) return [];               // nothing to back up yet — don't nag
        // Owner can switch backup reminders off site-wide (e.g. once on Supabase Pro).
        if (typeof mmBackupRemindersOn === 'function' && !mmBackupRemindersOn()) return [];
        const readIds = getReadIds();
        const DAY = 24 * 60 * 60 * 1000;
        let last = null;
        try { last = localStorage.getItem(`mm_last_backup_${_tenant()}`); } catch {}

        let daysSince = null;
        if (last) {
            const t = new Date(last).getTime();
            if (!isNaN(t)) daysSince = Math.floor((Date.now() - t) / DAY);
        }
        if (daysSince !== null && daysSince < 7) return [];  // backed up recently — quiet

        const weekBucket = Math.floor(Date.now() / (7 * DAY));
        let title, message, time;
        if (daysSince === null) {
            title = '💾 Back up your shop data';
            message = `You haven't taken a backup yet. Open <b>Report → Backup</b> to save a copy of your whole shop — customers &amp; khata balances, medicines, sales, purchases and more. Keep the file on your phone or Google Drive.`;
            time = 'Recommended';
        } else {
            title = `💾 Backup reminder — ${daysSince} days ago`;
            message = `Your last backup was <b>${daysSince} days ago</b>. Open <b>Report → Backup</b> to download a fresh copy so a lost phone or cleared browser can never wipe out your shop data.`;
            time = 'Data safety';
        }
        return [ notif({
            id: `backup_reminder_${weekBucket}`, category: 'business', type: 'backup_reminder', priority: 2, readIds,
            title, message, time, icon: '💾', color: '#0891b2', bg: '#f0f9ff', border: '#bae6fd'
        }) ];
    }

    // ─────────────────────────────────────
    // MASTER SORT — unread first, then priority
    // ─────────────────────────────────────
    function sort(arr) {
        return arr.sort((a, b) => {
            if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
            return a.priority - b.priority;
        });
    }

    return {
        generateMedicineAlerts,
        generateRequestAlerts,
        generateBusinessAlerts,
        generateSystemAlerts,
        generatePromiseAlerts,
        generateBackupAlerts,
        sort,
        markRead,
        markAllRead,
        getReadIds,
        getReadMap,
        getClearedIds,
        addCleared,
        isReadExpired,
        SIX_MONTHS_MS
    };
})();
