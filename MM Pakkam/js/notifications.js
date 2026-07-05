/**
 * Billware — Notification Engine v2
 * Categories:
 *   💊 medicines  — expiry & stock alerts (from purchases)
 *   📋 requests   — shop edit / extra worker request approvals
 *   📊 business   — daily sales summary
 *   📢 updates    — system announcements
 */

const MMNotifications = (() => {

    // ── Storage key per logged-in user ──
    const STORAGE_KEY = () => {
        try {
            const s = JSON.parse(
                localStorage.getItem('mm_auth_session') ||
                sessionStorage.getItem('mm_auth_session') || 'null'
            );
            return s ? `mm_notif_read_${s.tenant_id || s.username}` : 'mm_notif_read_anon';
        } catch { return 'mm_notif_read_anon'; }
    };

    function getReadIds() {
        try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY())) || []); }
        catch { return new Set(); }
    }

    function markRead(ids) {
        const existing = getReadIds();
        ids.forEach(id => existing.add(id));
        const arr = [...existing].slice(-1000);
        localStorage.setItem(STORAGE_KEY(), JSON.stringify(arr));
    }

    function markAllRead(notifications) {
        markRead(notifications.map(n => n.id));
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

    // ─────────────────────────────────────
    // 1. MEDICINES — Expiry & Stock Alerts
    // ─────────────────────────────────────
    function generateMedicineAlerts(purchases) {
        if (!purchases || !purchases.length) return [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const readIds = getReadIds();
        const results = [];

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

            // Stock alerts — REAL current stock. Gate to products that still have
            // a non-expired batch so we don't nag to reorder discontinued/expired lines.
            const current = stockOf(name);
            const qty = (current !== null) ? current : info.fallbackQty;
            if (!hasFreshBatch) return; // nothing sellable left to reorder — skip stock alert
            if (qty <= 0) {
                results.push(notif({ id: `stock_${name}_out`, category: 'medicines', type: 'out_of_stock', priority: 1, readIds,
                    title: `${name} — Out of Stock`, icon: '🚫', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', time: 'Stock update',
                    message: `Zero units remaining. Purchase more stock to avoid losing sales.`
                }));
            } else if (qty <= 10) {
                results.push(notif({ id: `stock_${name}_low`, category: 'medicines', type: 'low_stock', priority: 2, readIds,
                    title: `${name} — Low Stock`, icon: '⚠️', color: '#d97706', bg: '#fffbeb', border: '#fde68a', time: 'Stock update',
                    message: `Only <b>${qty} unit${qty!==1?'s':''}</b> left. Consider reordering soon.`
                }));
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
        sort,
        markRead,
        markAllRead,
        getReadIds
    };
})();
