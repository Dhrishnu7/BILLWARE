/**
 * supabase.js — Supabase Client for Billware
 * DATA ISOLATION: Every read/write is HARD-SCOPED to the current user's username.
 * If user is not logged in, ALL functions return empty immediately — never expose other users' data.
 */

const SUPABASE_URL  = 'https://jwyyjdwlbgjijmwillow.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_sY9QwFEMckky9KDJoc1O_w_zN7qY0mo';

// Create and export a single shared client instance
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─────────────────────────────────────────────────────
   CURRENT USER HELPER
   Returns the username of the currently logged-in user.
   CRITICAL: Returns null if not logged in. All DB functions
   must HARD-STOP and return empty if this is null.
───────────────────────────────────────────────────── */
function _currentUser() {
    const session = (typeof mmGetSession === 'function') ? mmGetSession() : null;
    if (!session) return null;
    // Always use tenant_id for data scoping.
    // For owners: tenant_id = their own username.
    // For workers: tenant_id = their owner's username → they see the owner's data.
    return session.tenant_id || session.username;
}

/* ─────────────────────────────────────────────────────
   localStorage KEY SCOPING
   Prefix every localStorage key with the username so
   data never bleeds between users on the same device.
───────────────────────────────────────────────────── */
function _lsKey(key) {
    const user = _currentUser();
    return user ? `mm_${user}_${key}` : `mm_${key}`;
}

// Scoped localStorage helpers used by other pages
function mmLsGet(key) {
    try { return JSON.parse(localStorage.getItem(_lsKey(key)) || 'null'); } catch { return null; }
}
function mmLsSet(key, value) {
    try { localStorage.setItem(_lsKey(key), JSON.stringify(value)); } catch {}
}
function mmLsRemove(key) {
    try { localStorage.removeItem(_lsKey(key)); } catch {}
}

/* ─────────────────────────────────────────────────────
   LAZY SCRIPT LOADER
   Loads a heavy CDN library (xlsx, html2canvas, …) only when
   it's actually needed, instead of blocking every page load.
   Caches by URL so repeat calls resolve instantly. Once fetched,
   the service worker caches it for offline/next-time use.
───────────────────────────────────────────────────── */
window._mmScriptCache = window._mmScriptCache || {};
function mmLoadScript(src) {
    if (window._mmScriptCache[src]) return window._mmScriptCache[src];
    const p = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { delete window._mmScriptCache[src]; reject(new Error('Failed to load ' + src)); };
        document.head.appendChild(s);
    });
    window._mmScriptCache[src] = p;
    return p;
}
window.mmLoadScript = mmLoadScript;

/* ─────────────────────────────────────────────────────
   CUSTOMERS
───────────────────────────────────────────────────── */
async function dbGetCustomers() {
    const user = _currentUser();
    // HARD GUARD: Never return data if user unknown
    if (!user) { console.warn('[db] dbGetCustomers: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('customers').select('*').eq('user_id', user).order('name');
    if (error) { console.error('customers fetch:', error); return []; }
    return data;
}
async function dbAddCustomer(name, phone, address, gstin) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddCustomer: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const cName  = name.trim();
    const cPhone = phone.trim();
    const cAddr  = address?.trim() || '';
    // Optional, and blank for nearly every customer. It only matters for a
    // registered buyer (clinic, nursing home), whose invoices must be filed
    // B2B in GSTR-1. Needs migrations/add_customer_gstin.sql; if that has not
    // been run the column is missing and the write is retried without it, so
    // saving a customer never breaks over an un-run migration.
    const cGstin = (gstin || '').trim().toUpperCase();
    const _hasGstinCol = () => cGstin !== '';

    // Check for existing record scoped to this user
    let { data: existing } = await _supabase.from('customers')
        .select('*').eq('name', cName).eq('phone', cPhone).eq('user_id', user).maybeSingle();
    /* Case-insensitive fallback, for the same reason as dbUpdateCustomerBalance:
       the match above is case-SENSITIVE, so "ravi" against a stored "Ravi" on
       the same phone number fell through and inserted a duplicate. Name is
       compared case-insensitively, the PHONE still has to match exactly — two
       different people genuinely do share a first name, and the phone is what
       tells them apart. */
    if (!existing) {
        const { data: ciRows } = await _supabase.from('customers')
            .select('*').eq('phone', cPhone).eq('user_id', user).order('id', { ascending: true });
        const want = cName.toLowerCase();
        existing = (ciRows || []).find(r => String(r && r.name || '').trim().toLowerCase() === want) || null;
    }
    if (existing) {
        // Already there — the only thing that may have changed is the GSTIN.
        if (cGstin && existing.gstin !== cGstin) {
            const { error: gErr } = await _supabase.from('customers')
                .update({ gstin: cGstin }).eq('id', existing.id).eq('user_id', user);
            if (gErr) console.warn('[db] customer gstin update failed:', gErr.message);
            else existing.gstin = cGstin;
        }
        return { success: true, data: existing };
    }

    // Try insert
    const row = { name: cName, phone: cPhone, address: cAddr, user_id: user };
    if (_hasGstinCol()) row.gstin = cGstin;
    let { data, error } = await _supabase.from('customers').insert(row).select();
    // Column not added yet (migration not run) — retry without it rather than
    // losing the customer entirely.
    if (error && /column|schema cache|PGRST204/i.test(String(error.message || '')) && row.gstin !== undefined) {
        console.warn('[db] customers.gstin missing — run migrations/add_customer_gstin.sql');
        const legacy = Object.assign({}, row); delete legacy.gstin;
        ({ data, error } = await _supabase.from('customers').insert(legacy).select());
    }

    // If duplicate key (another tenant has same name+phone), upsert on conflict
    if (error && (error.code === '23505' || (error.message && error.message.includes('duplicate key')))) {
        console.warn('[db] dbAddCustomer: duplicate key, trying upsert fallback.');
        const { data: ups, error: upsErr } = await _supabase.from('customers')
            .upsert({ name: cName, phone: cPhone, address: cAddr, user_id: user },
                    { onConflict: 'name,phone', ignoreDuplicates: false })
            .select();
        if (upsErr) {
            // Last resort: just fetch whatever is already there for this user
            const { data: fallback } = await _supabase.from('customers')
                .select('*').eq('name', cName).eq('user_id', user).maybeSingle();
            return { success: true, data: fallback || null };
        }
        return { success: true, data: ups?.[0] || null };
    }

    if (error) { console.error('customer add:', error); return { success: false, message: error.message }; }
    return { success: true, data: data?.[0] || null };
}
/* Fill in the place-of-supply details an e-invoice needs (town + PIN).
   Separate from dbAddCustomer because it is edited long after the customer
   was created — usually from the e-invoice screen, where the missing field
   is what stopped the file being built.
   Needs migrations/add_einvoice_fields.sql. Until that is run the columns do
   not exist, and the write reports the fact instead of failing silently. */
async function dbUpdateCustomerPos(id, patch) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbUpdateCustomerPos: no user, aborting.'); return { success: false }; }
    const row = {};
    if (patch.address != null) row.address = String(patch.address).trim();
    if (patch.city    != null) row.city    = String(patch.city).trim();
    if (patch.pincode != null) row.pincode = String(patch.pincode).trim();
    if (patch.gstin   != null) row.gstin   = String(patch.gstin).trim().toUpperCase();
    if (!Object.keys(row).length) return { success: true };

    const { error } = await _supabase.from('customers').update(row).eq('id', id).eq('user_id', user);
    if (error) {
        if (/column|schema cache|PGRST204/i.test(String(error.message || ''))) {
            console.warn('[db] customers.city/pincode missing — run migrations/add_einvoice_fields.sql');
            return { success: false, message: 'Run migrations/add_einvoice_fields.sql in Supabase first.' };
        }
        console.error('customer pos update:', error);
        return { success: false, message: error.message };
    }
    return { success: true };
}
window.dbUpdateCustomerPos = dbUpdateCustomerPos;

async function dbDeleteCustomer(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteCustomer: no user, aborting.'); return false; }
    const { error } = await _supabase.from('customers').delete().eq('id', id).eq('user_id', user);
    return !error;
}

/* A stable id for one money movement, generated ONCE where the movement
   happens and reused on every retry of it. That reuse is the whole point: it
   is what lets the server recognise a retry of a write that actually landed. */
function mmOpId(prefix) {
    return (prefix || 'bal') + '-' + Date.now().toString(36) + '-' +
           Math.random().toString(36).slice(2, 10);
}
window.mmOpId = mmOpId;

/* Set once if the server has no mm_apply_balance_delta, so we stop asking on
   every credit sale. Cleared by a page reload, which is when someone who has
   just run the migration would look. */
let _mmBalanceRpcMissing = false;

/* Upsert customer balance for Khata tracking */
async function dbUpdateCustomerBalance(name, phone, address, balance, opId) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbUpdateCustomerBalance: no user, aborting.'); return { success: false }; }
    const cName  = (name || '').trim();
    const cPhone = (phone || '').trim();
    const cAddr  = (address || '').trim();
    const cBal   = parseFloat(balance) || 0;

    /* ── The idempotent path ────────────────────────────────────────────
       Everything below this block is read-modify-write: read the balance, add
       a delta, write it back. If that write COMMITS but the response is lost
       — shop wifi, a closed tab, a sleeping phone — the caller cannot tell it
       from a failure, queues the delta in pendingBalanceUpdates, and
       dbSyncPendingCustomerBalances applies it a SECOND time. One credit sale
       billed twice; one refund given twice. Same class as v300.

       No amount of client-side cleverness fixes that: the device genuinely
       cannot distinguish a lost response from a failed write. It has to be
       settled where the write happens, so mm_apply_balance_delta() moves the
       balance and records the op_id in ONE transaction and a repeat op_id is
       a no-op. It also takes FOR UPDATE, which fixes the lost update when two
       devices bill the same customer at once — PostgREST cannot express
       "balance = balance + x", which is why this arithmetic was in the
       browser to begin with.

       Only used when the caller supplied an op_id; a caller that has not been
       taught to keep one stable across retries would gain nothing. */
    if (opId && !_mmBalanceRpcMissing) {
        try {
            const { data, error } = await _supabase.rpc('mm_apply_balance_delta', {
                p_op_id: opId, p_name: cName, p_phone: cPhone, p_address: cAddr, p_delta: cBal
            });
            if (!error) {
                return { success: true, duplicate: !!(data && data.duplicate),
                         balance: data ? data.balance : undefined };
            }
            if (/PGRST202|could not find the function|does not exist|schema cache/i.test(String(error.message || ''))) {
                _mmBalanceRpcMissing = true;
                console.warn('[db] mm_apply_balance_delta not found — run migrations/add_balance_ops.sql. ' +
                             'Falling back to read-modify-write; a retried balance update can double-count until then.');
            } else {
                // A real failure (offline, permissions). Report it so the
                // caller queues a retry — do NOT fall through and write the
                // balance a second way, which is how a double-count starts.
                console.error('balance rpc:', error);
                return { success: false };
            }
        } catch (e) {
            console.error('balance rpc threw:', e);
            return { success: false };
        }
    }

    // Try to find existing customer. Uses .limit(1) instead of .maybeSingle()
    // because .maybeSingle() errors out (returning null data) if more than one
    // row matches the name — which silently fell through to the "create new"
    // branch below and inserted a duplicate customer instead of adding to the
    // existing balance, making a second credit sale to the same customer look
    // like it never reached the Khata page.
    const { data: existingRows, error: findErr } = await _supabase.from('customers')
        .select('*').eq('name', cName).eq('user_id', user).order('id', { ascending: true }).limit(1);
    if (findErr) { console.error('customer lookup:', findErr); return { success: false }; }
    let existing = existingRows?.[0] || null;

    /* The exact match above is case-SENSITIVE, and every local match in the app
       lowercases. Normally unreachable, because sales.html passes the *stored*
       name — but on a device with no local cache (a new phone, or the iOS
       ~7-day eviction that caused the original wipe) typing "ravi" for an
       existing "Ravi" matched nothing here and fell through to the insert
       below, creating a SECOND cloud row. Khata then paints two cards for one
       person, and settling one leaves the other still owing.

       Deliberately a FALLBACK rather than replacing the .eq() above: the exact
       match is one indexed lookup and covers virtually every call, so the extra
       fetch only happens when we were about to create a customer anyway.
       Compared in JS rather than with .ilike() because ilike treats % _ and *
       as wildcards, so a name containing one would match the wrong row. */
    if (!existing) {
        const { data: ciRows } = await _supabase.from('customers')
            .select('*').eq('user_id', user).order('id', { ascending: true });
        const want = cName.toLowerCase();
        existing = (ciRows || []).find(r => String(r && r.name || '').trim().toLowerCase() === want) || null;
    }

    if (existing) {
        // Update balance (add to existing outstanding). Clamped at zero: a
        // negative delta (sales return refunded to khata, a deleted credit bill)
        // must never drive the cloud below nothing owed. Every reader already
        // treats a negative balance as meaningless — dbGetKhataData filters
        // .gt('balance', 0) and khata.html filters balance > 0 — and the local
        // stores have always clamped, so an unclamped cloud value just made the
        // two disagree and left the merge below to paper over it.
        const newBal = Math.max(0, (parseFloat(existing.balance) || 0) + cBal);
        const { error } = await _supabase.from('customers')
            .update({ balance: newBal })
            .eq('id', existing.id).eq('user_id', user);
        if (error) { console.error('balance update:', error); return { success: false }; }
        return { success: true };
    } else {
        // Create new customer with balance
        const { error } = await _supabase.from('customers')
            .insert({ name: cName, phone: cPhone, address: cAddr, balance: Math.max(0, cBal), user_id: user });
        if (error) { console.error('customer insert with balance:', error); return { success: false }; }
        return { success: true };
    }
}

/* Move a customer's outstanding by `delta` in ALL THREE stores at once —
   Supabase, the unscoped mm_customers that sales.html writes, and the scoped
   mm_<user>_customers that khata's settle writes.

   Lowering only one store does not work here. _mmMergeCustomerBalances() and
   khata's own merge both keep the HIGHER of cloud and local (a sync must never
   lose money that is owed), so a reduction applied to one store is silently
   undone by the other on the next page load. Anything that reduces a balance
   has to reduce every copy of it. Clamped at zero, matched case-insensitively
   by name — the cloud lookup inside dbUpdateCustomerBalance is case-SENSITIVE,
   so pass the name exactly as it is stored. */
async function mmAdjustCustomerBalance(name, phone, address, delta, opId) {
    const nm = String(name || '').trim();
    const d  = parseFloat(delta) || 0;
    if (!nm || !d) return false;
    const key = nm.toLowerCase();
    /* Generated HERE, once, and carried onto the retry queue below, so the
       retry is recognisably the same money movement rather than a new one.
       A caller may pass its own to keep an id stable across a wider operation. */
    const op = opId || mmOpId('adj');

    const bumpLocal = (list) => {
        const c = (list || []).find(x => String(x && x.name || '').trim().toLowerCase() === key);
        if (c) c.balance = Math.max(0, (parseFloat(c.balance) || 0) + d);
        else if (d > 0) (list || []).push({ name: nm, phone: phone || '', address: address || '', balance: d });
        return list || [];
    };

    // Unscoped store — what sales.html writes and khata reads first.
    try {
        const raw = JSON.parse(localStorage.getItem('mm_customers') || '[]');
        localStorage.setItem('mm_customers', JSON.stringify(bumpLocal(raw)));
    } catch (e) { console.warn('[db] balance adjust (unscoped) failed:', e); }

    // Scoped store — only touched if it already knows this customer, so we do
    // not start populating a store nothing else writes.
    try {
        if (typeof mmLsGet === 'function' && typeof mmLsSet === 'function') {
            const scoped = mmLsGet('customers') || [];
            if (scoped.some(x => String(x && x.name || '').trim().toLowerCase() === key)) {
                mmLsSet('customers', bumpLocal(scoped));
            }
        }
    } catch (e) { console.warn('[db] balance adjust (scoped) failed:', e); }

    let ok = false;
    try {
        const res = await dbUpdateCustomerBalance(nm, phone || '', address || '', d, op);
        ok = !!(res && res.success);
    } catch (e) { console.warn('[db] balance adjust (cloud) failed:', e); }

    // Same retry queue the credit sale uses, so an offline adjustment is not lost.
    if (!ok && typeof mmLsGet === 'function' && typeof mmLsSet === 'function') {
        try {
            const q = mmLsGet('pendingBalanceUpdates') || [];
            q.push({ name: nm, phone: phone || '', address: address || '', balance: d, opId: op });
            mmLsSet('pendingBalanceUpdates', q);
        } catch (e) {}
    }
    return ok;
}
window.mmAdjustCustomerBalance = mmAdjustCustomerBalance;

// Retries any credit-sale balance update that failed to reach Supabase (offline,
// transient error, etc.) so the Khata page — which trusts Supabase's balance
// over localStorage's whenever a customer already exists there — doesn't keep
// showing a stale total forever. Same self-heal pattern as
// dbSyncPendingStockAdjustments(). Safe to call repeatedly.
async function dbSyncPendingCustomerBalances() {
    const pending = (typeof mmLsGet === 'function') ? (mmLsGet('pendingBalanceUpdates') || []) : [];
    if (!pending.length) return 0;

    let syncedCount = 0;
    const stillPending = [];
    for (const record of pending) {
        try {
            /* record.opId is what makes this retry safe: if the original write
               committed and only its response was lost, the server recognises
               the id and does nothing instead of applying the delta twice.
               A record queued before v371 carries no opId and keeps the old
               best-effort behaviour — there is nothing to match it against. */
            const res = await dbUpdateCustomerBalance(record.name, record.phone, record.address, record.balance, record.opId);
            if (res && res.success) syncedCount++;
            else stillPending.push(record);
        } catch (e) {
            stillPending.push(record);
        }
    }
    if (typeof mmLsSet === 'function') mmLsSet('pendingBalanceUpdates', stillPending);
    return syncedCount;
}
window.dbSyncPendingCustomerBalances = dbSyncPendingCustomerBalances;

/* Get all customers who have outstanding balance for Khata page */
async function dbGetKhataData() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetKhataData: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('customers')
        .select('*').eq('user_id', user).gt('balance', 0).order('balance', { ascending: false });
    if (error) { console.error('khata fetch:', error); return []; }
    return data || [];
}


/* ─────────────────────────────────────────────────────
   PROMISE ORDERS (customer backorders)
   Lifecycle: pending → ordered → arrived → fulfilled.
   Scoped by user_id = _currentUser() like every other table.
───────────────────────────────────────────────────── */
async function dbAddPromiseOrder(order) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddPromiseOrder: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const { data, error } = await _supabase.from('promise_orders').insert({
        user_id:        user,
        customer_name:  (order.customerName  || '').trim(),
        customer_phone: (order.customerPhone || '').trim(),
        medicine_name:  (order.medicineName  || '').trim(),
        quantity:       Number(order.quantity) || 1,
        promise_date:   order.promiseDate || null,
        status:         order.status || 'pending',
    }).select();
    if (error) { console.error('promise order add:', error); return { success: false, message: error.message }; }
    return { success: true, data: data?.[0] || null };
}
window.dbAddPromiseOrder = dbAddPromiseOrder;

// status can be a single string ('pending'), an array (['pending','ordered']),
// or omitted/falsy to return ALL of this user's promise orders.
async function dbGetPromiseOrders(status) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetPromiseOrders: no user, aborting.'); return []; }
    let q = _supabase.from('promise_orders').select('*').eq('user_id', user);
    if (Array.isArray(status) && status.length) q = q.in('status', status);
    else if (typeof status === 'string' && status) q = q.eq('status', status);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) { console.error('promise orders fetch:', error); return []; }
    return data || [];
}
window.dbGetPromiseOrders = dbGetPromiseOrders;

async function dbUpdatePromiseOrderStatus(id, status) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbUpdatePromiseOrderStatus: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const { error } = await _supabase.from('promise_orders')
        .update({ status }).eq('id', id).eq('user_id', user);
    if (error) { console.error('promise order status update:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbUpdatePromiseOrderStatus = dbUpdatePromiseOrderStatus;

/* ─────────────────────────────────────────────────────
   SCHEDULE H  (drug list + sales register)
   Both were previously localStorage-only, so they vanished
   whenever the browser cleared its storage (iOS ~7-day
   eviction, cache clear, new device/login). These give them
   a cloud backup, scoped by user_id like every other table.
───────────────────────────────────────────────────── */
// Drug list — returns an array of drug-name strings.
async function dbGetScheduleHDrugs() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetScheduleHDrugs: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('schedule_h_drugs')
        .select('name').eq('user_id', user).order('name');
    if (error) { console.error('schedule_h drugs fetch:', error); return []; }
    return (data || []).map(r => r.name).filter(Boolean);
}
window.dbGetScheduleHDrugs = dbGetScheduleHDrugs;

// Add one or many drug names. Ignores duplicates (unique on user_id+name).
async function dbAddScheduleHDrugs(names) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddScheduleHDrugs: no user, aborting.'); return { success: false }; }
    const list = (Array.isArray(names) ? names : [names])
        .map(n => (n || '').trim()).filter(Boolean);
    if (!list.length) return { success: true };
    const rows = list.map(name => ({ user_id: user, name }));
    const { error } = await _supabase.from('schedule_h_drugs')
        .upsert(rows, { onConflict: 'user_id,name', ignoreDuplicates: true });
    if (error) { console.error('schedule_h drugs add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddScheduleHDrugs = dbAddScheduleHDrugs;

/* ⚠️ THE DELETE MUST BE CASE-INSENSITIVE, AND IT MUST NOT LIE.
   Two things made the old one-line version silently useless:

   1. `.eq('name', …)` matches EXACTLY, but the unique index is `user_id,name`
      on plain text — which is case-sensitive — so the cloud can genuinely hold
      "Morphine" AND "MORPHINE" as two rows. Meanwhile _mmSyncScheduleDrugLists
      dedupes the local copy case-INsensitively and keeps whichever spelling it
      saw first. So the name on screen need not be the spelling in the cloud,
      and an exact delete then matches nothing.
   2. Deleting zero rows is NOT an error in PostgREST, so it returned `true`
      having removed nothing — and because those lists merge as a UNION of
      local ∪ cloud, the name reappeared on the next sync. The caller awaited
      a success that had not happened.

   So: find every case-variant, delete each by its EXACT stored spelling, and
   return false only on a real error. Matching client-side rather than with
   ilike on purpose — a drug name may contain % or _ ("Betnovate 0.1%"), which
   ilike would treat as wildcards and delete more than asked. */
async function _dbDeleteDrugByName(table, name) {
    const user = _currentUser();
    if (!user) { console.warn('[db] ' + table + ' delete: no user, aborting.'); return false; }
    const target = String(name || '').trim().toLowerCase();
    if (!target) return false;

    const { data: rows, error: readErr } = await _supabase.from(table)
        .select('name').eq('user_id', user);
    if (readErr) { console.error(table + ' read before delete:', readErr); return false; }

    const hits = (rows || []).filter(r => String(r.name || '').trim().toLowerCase() === target);
    // Absent from the cloud is the state we wanted. Nothing to resurrect it.
    if (!hits.length) return true;

    for (const h of hits) {
        const { error } = await _supabase.from(table)
            .delete().eq('user_id', user).eq('name', h.name);
        if (error) { console.error(table + ' drug delete:', error); return false; }
    }
    return true;
}

async function dbDeleteScheduleHDrug(name) {
    return await _dbDeleteDrugByName('schedule_h_drugs', name);
}
window.dbDeleteScheduleHDrug = dbDeleteScheduleHDrug;

async function dbClearScheduleHDrugs() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbClearScheduleHDrugs: no user, aborting.'); return false; }
    const { error } = await _supabase.from('schedule_h_drugs').delete().eq('user_id', user);
    if (error) { console.error('schedule_h drugs clear:', error); return false; }
    return true;
}
window.dbClearScheduleHDrugs = dbClearScheduleHDrugs;

/* Schedule X (narcotic) drug names — the shop's own list, since X drugs are
   few and the shop knows them. Mirrors the schedule_h_drugs helpers.
   Needs migrations/add_schedule_x_drugs_table.sql. */
async function dbGetScheduleXDrugs() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetScheduleXDrugs: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('schedule_x_drugs')
        .select('name').eq('user_id', user).order('name');
    if (error) { console.error('schedule_x drugs fetch:', error); return []; }
    return (data || []).map(r => r.name).filter(Boolean);
}
window.dbGetScheduleXDrugs = dbGetScheduleXDrugs;

async function dbAddScheduleXDrugs(names) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddScheduleXDrugs: no user, aborting.'); return { success: false }; }
    const list = (Array.isArray(names) ? names : [names]).map(n => (n || '').trim()).filter(Boolean);
    if (!list.length) return { success: true };
    const rows = list.map(name => ({ user_id: user, name }));
    const { error } = await _supabase.from('schedule_x_drugs')
        .upsert(rows, { onConflict: 'user_id,name', ignoreDuplicates: true });
    if (error) { console.error('schedule_x drugs add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddScheduleXDrugs = dbAddScheduleXDrugs;

// Same case-sensitivity and zero-row-lie problem as the H list, and this one
// is the NARCOTICS register — see _dbDeleteDrugByName above.
async function dbDeleteScheduleXDrug(name) {
    return await _dbDeleteDrugByName('schedule_x_drugs', name);
}
window.dbDeleteScheduleXDrug = dbDeleteScheduleXDrug;

/* ── Schedule H / X drug lists into the local cache ───────────────────────
   WHY THIS IS IN dbSyncCoreData AND NOT ONLY ON THE H PAGE.

   These two lists are what every screen uses to decide "is this a Schedule
   H drug?" — the till's H chip (sales.html:1491), the purchase flagger, the
   Inventory return classifier, the Report. All of them read the localStorage
   key directly.

   But the ONLY place that ever fetched them from the cloud was schedule-h.html.
   And _mmClearBusinessData() is deny-by-default, so a logout, an account
   switch, a cache clear or a new device wipes both lists. Nothing put them
   back until somebody happened to open the Schedule H page.

   In that window the till detects NO Schedule H drug, the H chip stays grey,
   and `_billHasScheduleH()` is false — so the sale is billed and the OUT
   entry is never written to the register. Silently. On the one document a
   drug inspector asks for. Found 2026-08-10 with both lists reading 0 on a
   shop that has 25 register entries.

   UNION, never overwrite: sales.html and purchase.html LEARN new H drugs
   locally and push them up, so a plain cloud->local copy would drop a name
   learned seconds ago that has not been pushed yet. Same merge the H page
   does, so the two cannot disagree.

   The backfill is gated on mmOwnsLocalData() for the same reason the H page
   gates it — pushing an unowned cache upward would move another shop's drug
   names into this shop's list. */
async function _mmSyncScheduleDrugLists() {
    const canBackfill = (typeof mmOwnsLocalData !== 'function') || mmOwnsLocalData();

    async function merge(key, fetchFn, addFn) {
        if (typeof fetchFn !== 'function') return;
        let cloud;
        try { cloud = await fetchFn(); } catch (e) { return; }   // leave local alone
        if (!Array.isArray(cloud)) return;
        let local = [];
        try { local = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
        if (!Array.isArray(local)) local = [];

        const seen = new Set();
        const union = [];
        [...local, ...cloud].forEach(n => {
            const k = String(n || '').trim().toLowerCase();
            if (k && !seen.has(k)) { seen.add(k); union.push(String(n).trim()); }
        });
        union.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
        if (union.length !== local.length || union.some((n, i) => n !== local[i])) {
            try { localStorage.setItem(key, JSON.stringify(union)); } catch (e) {}
        }

        const cloudSet = new Set(cloud.map(n => String(n || '').trim().toLowerCase()));
        const localOnly = local.filter(n => !cloudSet.has(String(n || '').trim().toLowerCase()));
        if (canBackfill && localOnly.length && typeof addFn === 'function') {
            addFn(localOnly).catch(() => {});
        }
    }

    await merge('mm_schedule_h_drugs', window.dbGetScheduleHDrugs, window.dbAddScheduleHDrugs);
    await merge('mm_schedule_x_drugs', window.dbGetScheduleXDrugs, window.dbAddScheduleXDrugs);
}
window._mmSyncScheduleDrugLists = _mmSyncScheduleDrugLists;

// Register entries. Maps the app's camelCase entry <-> the table's snake_case
// columns. entry.id (the app-generated string) is the primary key so re-syncs
// dedupe cleanly and never create doubles.
function _shEntryToRow(e, user) {
    return {
        entry_id:        e.id,
        user_id:         user,
        entry_type:      e.entryType || 'out',   // CRITICAL: IN/OUT must survive the round-trip
        date:            e.date || '',
        bill_no:         e.billNo || '',
        firm_name:       e.firmName || '',
        patient_name:    e.patientName || '',
        patient_address: e.patientAddress || '',
        doctor_name:     e.doctorName || '',
        doctor_reg_no:   e.doctorRegNo || '',
        doctor_address:  e.doctorAddress || '',
        drug_name:       e.drugName || '',
        batch_no:        e.batchNo || '',
        expire_date:     e.expireDate || '',
        pack:            e.pack || '',
        qty:             Number(e.qty) || 0,
        mrp:             Number(e.mrp) || 0,
        rate:            Number(e.rate) || 0,
        gst:             Number(e.gst) || 0,
        total:           Number(e.total) || 0,
        schedule_class:  e.scheduleClass || '',
        saved_at:        e.savedAt || new Date().toISOString(),
    };
}
function _shRowToEntry(r) {
    // Recover the IN/OUT type: prefer the stored column; for older rows saved
    // before entry_type existed, derive it — only IN (stock-received) entries
    // carry a firm/supplier name and have no patient, so that's a reliable tell.
    const entryType = r.entry_type
        || ((r.firm_name && !r.patient_name) ? 'in' : 'out');
    return {
        id:             r.entry_id,
        entryType:      entryType,
        date:           r.date || '',
        billNo:         r.bill_no || '',
        firmName:       r.firm_name || '',
        patientName:    r.patient_name || '',
        patientAddress: r.patient_address || '',
        doctorName:     r.doctor_name || '',
        doctorRegNo:    r.doctor_reg_no || '',
        doctorAddress:  r.doctor_address || '',
        drugName:       r.drug_name || '',
        batchNo:        r.batch_no || '',
        expireDate:     r.expire_date || '',
        pack:           r.pack || '',
        qty:            Number(r.qty) || 0,
        mrp:            Number(r.mrp) || 0,
        rate:           Number(r.rate) || 0,
        gst:            Number(r.gst) || 0,
        total:          Number(r.total) || 0,
        scheduleClass:  r.schedule_class || '',
        savedAt:        r.saved_at || '',
    };
}

async function dbGetScheduleHRegister() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetScheduleHRegister: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('schedule_h_register')
        .select('*').eq('user_id', user).order('saved_at', { ascending: true });
    if (error) { console.error('schedule_h register fetch:', error); return []; }
    return (data || []).map(_shRowToEntry);
}
window.dbGetScheduleHRegister = dbGetScheduleHRegister;

async function dbAddScheduleHEntry(entry) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddScheduleHEntry: no user, aborting.'); return { success: false }; }
    const row = _shEntryToRow(entry, user);
    let { error } = await _supabase.from('schedule_h_register')
        .upsert(row, { onConflict: 'entry_id' });
    // If the table hasn't had the newer columns added yet (migration not run),
    // Postgres/PostgREST reports a missing-column error — retry without them so
    // saves never silently fail. Type is still recovered on read via firm_name.
    if (error && /column|schema cache|PGRST204/i.test(String(error.message || ''))) {
        const legacy = Object.assign({}, row);
        delete legacy.entry_type; delete legacy.doctor_reg_no; delete legacy.schedule_class;
        ({ error } = await _supabase.from('schedule_h_register')
            .upsert(legacy, { onConflict: 'entry_id' }));
    }
    if (error) { console.error('schedule_h entry add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddScheduleHEntry = dbAddScheduleHEntry;

async function dbDeleteScheduleHEntry(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteScheduleHEntry: no user, aborting.'); return false; }
    const { error } = await _supabase.from('schedule_h_register')
        .delete().eq('user_id', user).eq('entry_id', id);
    if (error) { console.error('schedule_h entry delete:', error); return false; }
    return true;
}
window.dbDeleteScheduleHEntry = dbDeleteScheduleHEntry;

/* ─────────────────────────────────────────────────────
   PRESCRIPTIONS  (softcopy of paper prescriptions)
   Each row stores a downscaled image (base64 in `image_data`)
   plus tagging metadata so Schedule H sales can be tied to the
   doctor's prescription that authorized them. rx_id (the
   app-generated string) is the primary key so re-syncs dedupe
   cleanly, exactly like schedule_h_register. Scoped by user_id.
───────────────────────────────────────────────────── */
function _rxToRow(p, user) {
    return {
        rx_id:        p.id,
        user_id:      user,
        patient_name: p.patientName || '',
        doctor_name:  p.doctorName  || '',
        rx_date:      p.rxDate || null,
        medicines:    p.medicines || '',
        note:         p.note || '',
        image_data:   p.imageData || '',
        saved_at:     p.savedAt || new Date().toISOString(),
    };
}
function _rxRowToObj(r) {
    return {
        id:          r.rx_id,
        patientName: r.patient_name || '',
        doctorName:  r.doctor_name  || '',
        rxDate:      r.rx_date || '',
        medicines:   r.medicines || '',
        note:        r.note || '',
        imageData:   r.image_data || '',
        savedAt:     r.saved_at || '',
    };
}

/* ── Prescription image Storage helpers ──
   Instead of stuffing the base64 photo into the `image_data` text
   column (heavy — bloats the DB and slows every sync), we upload the
   photo to a PRIVATE Storage bucket and keep only its path in image_data.
   Path is deterministic (`<tenant>/<rx_id>.jpg`) so re-saves overwrite
   cleanly and deletes are easy. Everything is best-effort: if the
   bucket isn't set up yet or the upload fails, callers fall back to the
   old inline-base64 behaviour, so nothing ever breaks.

   These are prescription photos — patient name, doctor, medicines. The
   bucket must stay private: a public bucket serves objects to anyone who
   has the URL, with no login and no expiry. Render via
   dbPrescriptionImageSrc(), never getPublicUrl(). */
const RX_BUCKET = 'prescriptions';
// How long a signed photo link lives, and the cache lifetime uploads are
// stored with. Declared here because the uploader uses it too.
const RX_SIGNED_TTL = 3600;

// Upload a base64 JPEG data URL → returns the STORAGE PATH ("<tenant>/<rx>.jpg"),
// or null on any failure. It used to return a permanent public URL; that URL
// opened for anyone who had it, forever, with no login. We now store the path
// and mint a short-lived signed URL at render time (dbPrescriptionImageSrc).
async function dbUploadPrescriptionImage(rxId, dataUrl) {
    try {
        const user = _currentUser();
        if (!user || !_supabase || !rxId) return null;
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${user}/${rxId}.jpg`;
        // cacheControl matters more than it looks. These were uploaded with a
        // ONE YEAR cache header, and Supabase's CDN honours it — so after the
        // bucket was switched to private, the CDN kept serving the cached copy
        // of a patient's prescription to anyone with the URL (verified:
        // CF-Cache-Status: HIT while the origin returned 400). Keep it in step
        // with the signed-URL lifetime so a cached copy cannot outlive the link
        // that was allowed to fetch it.
        const { error } = await _supabase.storage.from(RX_BUCKET)
            .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: String(RX_SIGNED_TTL) });
        if (error) { console.warn('[db] rx image upload failed:', error.message); return null; }
        return path;
    } catch (e) { console.warn('[db] rx image upload error:', e); return null; }
}
window.dbUploadPrescriptionImage = dbUploadPrescriptionImage;

// Turn whatever is stored in a prescription's `imageData` into something an
// <img> can actually display. Three historical shapes have to keep working:
//   1. "data:image/jpeg;base64,…"  — oldest rows, inline photo. Used as-is.
//   2. "https://…/object/public/prescriptions/<tenant>/<rx>.jpg" — rows written
//      while the bucket was public. The path is extracted and re-signed, so
//      those rows keep rendering after the bucket is made private.
//   3. "<tenant>/<rx>.jpg" — current shape. Signed on demand.
// Signed links expire (default 1 hour), so a copied link stops working instead
// of being a permanent public handle on a patient's prescription.
const _rxSignedCache = new Map();   // path -> { url, expires }

function _rxStoragePath(imageData) {
    const s = String(imageData || '');
    if (!s || s.startsWith('data:')) return null;
    const marker = `/${RX_BUCKET}/`;
    const at = s.indexOf(marker);
    if (at >= 0) return s.slice(at + marker.length).split('?')[0];
    if (s.startsWith('http')) return null;            // some other URL — leave alone
    return s.replace(/^\/+/, '');
}

async function dbPrescriptionImageSrc(imageData) {
    const raw = String(imageData || '');
    if (!raw || raw.startsWith('data:')) return raw;
    const path = _rxStoragePath(raw);
    if (!path || !_supabase) return raw;
    const hit = _rxSignedCache.get(path);
    if (hit && hit.expires > Date.now()) return hit.url;
    try {
        const { data, error } = await _supabase.storage.from(RX_BUCKET)
            .createSignedUrl(path, RX_SIGNED_TTL);
        if (error || !data || !data.signedUrl) {
            console.warn('[db] rx signed url failed:', error && error.message);
            return raw;                                // fall back; never blank the image
        }
        // Re-sign a minute early so a link can't expire mid-view.
        _rxSignedCache.set(path, { url: data.signedUrl, expires: Date.now() + (RX_SIGNED_TTL - 60) * 1000 });
        return data.signedUrl;
    } catch (e) { console.warn('[db] rx signed url error:', e); return raw; }
}
window.dbPrescriptionImageSrc = dbPrescriptionImageSrc;

// Best-effort removal of a prescription's photo from Storage (no-op if absent).
async function dbDeletePrescriptionImage(rxId) {
    try {
        const user = _currentUser();
        if (!user || !_supabase || !rxId) return;
        await _supabase.storage.from(RX_BUCKET).remove([`${user}/${rxId}.jpg`]);
    } catch (e) { /* best-effort — old rows have no Storage file */ }
}
window.dbDeletePrescriptionImage = dbDeletePrescriptionImage;

async function dbGetPrescriptions() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetPrescriptions: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('prescriptions')
        .select('*').eq('user_id', user).order('saved_at', { ascending: false });
    if (error) { console.error('prescriptions fetch:', error); return []; }
    return (data || []).map(_rxRowToObj);
}
window.dbGetPrescriptions = dbGetPrescriptions;

async function dbAddPrescription(p) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddPrescription: no user, aborting.'); return { success: false }; }
    const { error } = await _supabase.from('prescriptions')
        .upsert(_rxToRow(p, user), { onConflict: 'rx_id' });
    if (error) { console.error('prescription add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddPrescription = dbAddPrescription;

async function dbDeletePrescription(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeletePrescription: no user, aborting.'); return false; }
    const { error } = await _supabase.from('prescriptions')
        .delete().eq('user_id', user).eq('rx_id', id);
    if (error) { console.error('prescription delete:', error); return false; }
    // Also clean up the photo in Storage (best-effort; no-op for old inline rows).
    dbDeletePrescriptionImage(id);
    return true;
}
window.dbDeletePrescription = dbDeletePrescription;

/* ─────────────────────────────────────────────────────
   DOCTORS
───────────────────────────────────────────────────── */
async function dbGetDoctors() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetDoctors: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('doctors').select('*').eq('user_id', user).order('name');
    if (error) { console.error('doctors fetch:', error); return []; }
    return data;
}
async function dbAddDoctor(name, phone, clinic, address, regNo) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddDoctor: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const dName  = name.trim();
    const dPhone = phone.trim();
    const dClinic = clinic?.trim() || '';
    const dAddr   = address?.trim() || '';
    const dReg    = (regNo || '').trim();

    // Detect the "reg_no column doesn't exist yet" error so we can fall back
    // gracefully. reg_no is an OPTIONAL column — run once in Supabase to enable
    // cloud sync of the doctor registration number:
    //   alter table doctors add column if not exists reg_no text;
    const _missingRegCol = e => !!e && (
        e.code === 'PGRST204' || e.code === '42703' ||
        (e.message && e.message.toLowerCase().includes('reg_no'))
    );

    // Check for existing record scoped to this user
    const { data: existing } = await _supabase.from('doctors')
        .select('*').eq('name', dName).eq('phone', dPhone).eq('user_id', user).maybeSingle();
    if (existing) {
        // Backfill the reg. no. on an existing doctor if we now have one and it was blank.
        if (dReg && !existing.reg_no) {
            try { await _supabase.from('doctors').update({ reg_no: dReg }).eq('id', existing.id).eq('user_id', user); } catch (_) {}
        }
        return { success: true, data: existing };
    }

    // Build the row; include reg_no only when provided.
    const base = { name: dName, phone: dPhone, clinic: dClinic, address: dAddr, user_id: user };
    let row = dReg ? { ...base, reg_no: dReg } : base;

    // Try insert
    let { data, error } = await _supabase.from('doctors').insert(row).select();

    // If the reg_no column isn't there yet, retry without it so the save still works.
    if (error && _missingRegCol(error) && row !== base) {
        row = base;
        ({ data, error } = await _supabase.from('doctors').insert(row).select());
    }

    // If duplicate key (another tenant has same name+phone), upsert on conflict
    if (error && (error.code === '23505' || (error.message && error.message.includes('duplicate key')))) {
        console.warn('[db] dbAddDoctor: duplicate key, trying upsert fallback.');
        let { data: ups, error: upsErr } = await _supabase.from('doctors')
            .upsert(row, { onConflict: 'name,phone', ignoreDuplicates: false })
            .select();
        if (upsErr && _missingRegCol(upsErr) && row !== base) {
            row = base;
            ({ data: ups, error: upsErr } = await _supabase.from('doctors')
                .upsert(row, { onConflict: 'name,phone', ignoreDuplicates: false })
                .select());
        }
        if (upsErr) {
            const { data: fallback } = await _supabase.from('doctors')
                .select('*').eq('name', dName).eq('user_id', user).maybeSingle();
            return { success: true, data: fallback || null };
        }
        return { success: true, data: ups?.[0] || null };
    }

    if (error) { console.error('doctor add:', error); return { success: false, message: error.message }; }
    return { success: true, data: data?.[0] || null };
}
async function dbDeleteDoctor(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteDoctor: no user, aborting.'); return false; }
    const { error } = await _supabase.from('doctors').delete().eq('id', id).eq('user_id', user);
    return !error;
}

/* ─────────────────────────────────────────────────────
   MEDICINES  (catalogue — scoped per account)
───────────────────────────────────────────────────── */
async function dbGetMedicines() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetMedicines: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('medicines').select('name').eq('user_id', user).order('name');
    if (error) { console.error('medicines fetch:', error); return []; }
    return data.map(m => m.name);
}
async function dbImportMedicines(nameArray) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbImportMedicines: no user, aborting.'); return false; }
    const cleanNames = [...new Set(nameArray.map(n => n.trim()).filter(Boolean))];

    // Fetch existing to avoid duplicates
    const { data: existing } = await _supabase.from('medicines').select('name').eq('user_id', user);
    const existingSet = new Set((existing || []).map(m => m.name.toLowerCase()));

    const toInsert = cleanNames
        .filter(n => !existingSet.has(n.toLowerCase()))
        .map(name => ({ name, user_id: user }));

    if (toInsert.length > 0) {
        const { error } = await _supabase.from('medicines').insert(toInsert);
        if (error) { console.error('medicine import:', error); return false; }
    }
    return true;
}

/* ─────────────────────────────────────────────────────
   BARCODES  (scanned code → product name, per account)
   Needs migrations/add_barcodes_table.sql run in Supabase.
   Cached to localStorage 'mm_barcodes' as { barcode: name } for
   instant, offline scanner lookups. Scoped by user_id like every
   other table; RLS keeps it tenant-isolated.
───────────────────────────────────────────────────── */
async function dbGetBarcodes() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetBarcodes: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('barcodes')
        .select('barcode,product_name').eq('user_id', user);
    if (error) { console.error('barcodes fetch:', error); return []; }
    return data || [];
}
window.dbGetBarcodes = dbGetBarcodes;

// Fetch all barcodes and refresh the local cache. Returns the { code: name } map.
async function dbSyncBarcodes() {
    const rows = await dbGetBarcodes();
    // MERGE cloud rows on top of any local-only links (union) instead of
    // overwriting. This keeps links made while the cloud table was missing or
    // offline — a plain overwrite would wipe them the moment another page loads.
    let map = {};
    try { map = JSON.parse(localStorage.getItem('mm_barcodes') || '{}'); } catch (e) { map = {}; }
    rows.forEach(r => { if (r.barcode) map[String(r.barcode)] = r.product_name || ''; });
    try { localStorage.setItem('mm_barcodes', JSON.stringify(map)); } catch (e) {}
    return map;
}
window.dbSyncBarcodes = dbSyncBarcodes;

// Read-through helper for scan handlers: local cache first (instant/offline).
function mmBarcodeLookup(code) {
    const c = String(code || '').trim();
    if (!c) return '';
    try { return (JSON.parse(localStorage.getItem('mm_barcodes') || '{}'))[c] || ''; }
    catch (e) { return ''; }
}
window.mmBarcodeLookup = mmBarcodeLookup;

// Link a barcode to a product name (upsert) + update the local cache.
async function dbAddBarcode(code, name) {
    const c = String(code || '').trim();
    const n = String(name || '').trim();
    if (!c || !n) return { success: false, message: 'Missing barcode or name.' };
    // Cache locally FIRST so the scan works instantly on this device even if the
    // cloud write fails (table missing / offline). A prior version returned early
    // on cloud error and never cached — losing the link entirely.
    try { const m = JSON.parse(localStorage.getItem('mm_barcodes') || '{}'); m[c] = n; localStorage.setItem('mm_barcodes', JSON.stringify(m)); } catch (e) {}
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddBarcode: no user, aborting cloud save.'); return { success: false, message: 'Not logged in.' }; }
    try {
        const { error } = await _supabase.from('barcodes')
            .upsert({ user_id: user, barcode: c, product_name: n, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,barcode' });
        if (error) { console.error('barcode add:', error); return { success: false, message: error.message }; }
    } catch (e) { console.error('barcode add:', e); return { success: false, message: String((e && e.message) || e) }; }
    return { success: true };
}
window.dbAddBarcode = dbAddBarcode;

async function dbDeleteBarcode(code) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteBarcode: no user, aborting.'); return false; }
    const c = String(code || '').trim();
    const { error } = await _supabase.from('barcodes').delete().eq('user_id', user).eq('barcode', c);
    if (error) { console.error('barcode delete:', error); return false; }
    try { const m = JSON.parse(localStorage.getItem('mm_barcodes') || '{}'); delete m[c]; localStorage.setItem('mm_barcodes', JSON.stringify(m)); } catch (e) {}
    return true;
}
window.dbDeleteBarcode = dbDeleteBarcode;

/* ─────────────────────────────────────────────────────
   PURCHASES
───────────────────────────────────────────────────── */
async function dbGetPurchases(fromDate, toDate) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetPurchases: no user, aborting.'); return []; }
    let query = _supabase.from('purchases').select('*').eq('user_id', user).order('date', { ascending: false });
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate)   query = query.lte('date', toDate);
    const { data, error } = await query;
    if (error) { console.error('purchases fetch:', error); return []; }
    return data;
}
async function dbAddPurchase(row) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddPurchase: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    // Note: avoid .single() here — it throws PGRST116 if RLS prevents read-back
    // even when the insert itself succeeded, causing a false "Saved Offline" error.
    const ed = row.expireDate || row.expire_date || '';
    const { error } = await _supabase.from('purchases').insert({
        bill_no:      row.billNo     || '',
        firm:         row.firm       || '',
        date:         row.date       || new Date().toISOString().slice(0,10),
        product_name: row.productName || row.product_name || '',
        batch_no:     row.batchNo    || row.batch_no     || '',
        // month input returns 'YYYY-MM' — Supabase date column needs 'YYYY-MM-DD'
        expire_date:  ed.length === 7 ? ed + '-01' : (ed || null),
        pack:         Number(row.pack) || 0,
        quantity:     Number(row.quantity) || 0,
        mrp:          Number(row.mrp)      || 0,
        rate:         Number(row.rate)     || 0,
        gst:          Number(row.gst)      || 0,
        hsn:          row.hsn || row.hsn_code || '',
        user_id:      user,
    });
    if (error) { console.error('purchase add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
async function dbDeletePurchase(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeletePurchase: no user, aborting.'); return false; }
    const { error } = await _supabase.from('purchases').delete().eq('id', id).eq('user_id', user);
    return !error;
}

/* ─────────────────────────────────────────────────────
   SUPPLIER PAYMENTS (accounts-payable ledger). A payment
   made to a supplier/firm. The balance you still owe is
   computed client-side: purchases − purchase-returns − payments.
   Needs migrations/add_supplier_payments_table.sql.
───────────────────────────────────────────────────── */
async function dbGetSupplierPayments() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetSupplierPayments: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('supplier_payments')
        .select('*').eq('user_id', user).order('pay_date', { ascending: false });
    if (error) { console.error('supplier payments fetch:', error); return []; }
    return (data || []).map(r => ({
        id: r.payment_id, firm: r.firm || '', amount: Number(r.amount) || 0,
        date: r.pay_date || '', note: r.note || '', savedAt: r.saved_at || '',
        paymentMode: r.payment_mode || 'Cash'
    }));
}
window.dbGetSupplierPayments = dbGetSupplierPayments;

async function dbAddSupplierPayment(p) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddSupplierPayment: no user, aborting.'); return { success: false }; }
    const row = {
        payment_id: p.id, user_id: user, firm: p.firm || '',
        amount: Number(p.amount) || 0, pay_date: p.date || new Date().toISOString().slice(0, 10),
        note: p.note || '', saved_at: p.savedAt || new Date().toISOString(),
        payment_mode: p.paymentMode || 'Cash'
    };
    let { error } = await _supabase.from('supplier_payments').upsert(row, { onConflict: 'payment_id' });
    /* Migration not run yet — drop the column and retry rather than losing the
       payment. Never drop more than the one the error names: a blanket retry
       would silently discard a real field. Same rule as dbSaveBill. */
    if (error && /payment_mode/i.test(String(error.message || ''))) {
        console.warn('[db] supplier_payments.payment_mode missing — run migrations/add_payment_modes.sql');
        const legacy = Object.assign({}, row); delete legacy.payment_mode;
        ({ error } = await _supabase.from('supplier_payments').upsert(legacy, { onConflict: 'payment_id' }));
    }
    if (error) { console.error('supplier payment add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddSupplierPayment = dbAddSupplierPayment;

async function dbDeleteSupplierPayment(id) {
    const user = _currentUser();
    if (!user) return false;
    const { error } = await _supabase.from('supplier_payments').delete().eq('payment_id', id).eq('user_id', user);
    return !error;
}
window.dbDeleteSupplierPayment = dbDeleteSupplierPayment;

/* ─────────────────────────────────────────────────────
   EXPENSES — the shop's running costs (rent, salaries, power,
   freight…). Without these every "profit" number in the app is
   really gross margin, because nothing is subtracted for the
   cost of operating. Needs migrations/add_expenses_table.sql.
───────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────
   GST SLABS
   The rates that actually exist. Medicines are 0/5/12/18; the others are
   listed so a shop selling non-medicine items is not wrongly flagged.
   Anything outside this set — 7.5%, 2%, 1.5% typed by hand into the GST box —
   is rejected by the GST portal, so a bill carrying one cannot be filed. It is
   far cheaper to catch that at the till than at the filing deadline.
───────────────────────────────────────────────────── */
const MM_GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];
function mmIsValidGstRate(r) {
    if (r === '' || r === null || r === undefined) return true;   // blank is fine
    const n = Number(r);
    return !isNaN(n) && MM_GST_SLABS.indexOf(n) >= 0;
}
/* Attach to a GST input: marks it red and warns once when the rate is not a
   real slab. Deliberately does NOT block typing — a half-typed "1" on the way
   to "12" would fight the user — it flags on blur, when they have finished. */
function mmWatchGstInput(el) {
    if (!el || el.dataset.gstWatched) return;
    el.dataset.gstWatched = '1';
    el.setAttribute('list', 'mmGstSlabList');
    el.addEventListener('blur', function () {
        const bad = !mmIsValidGstRate(el.value);
        el.style.borderColor = bad ? '#dc2626' : '';
        el.style.background  = bad ? '#fef2f2' : '';
        el.title = bad ? 'Not a real GST rate. Use 0, 5, 12 or 18 for medicines.' : '';
        if (bad && typeof showToast === 'function') {
            showToast('Check the GST rate', el.value + '% is not a GST slab. Medicines are 0, 5, 12 or 18%.');
        }
    });
}
/* One datalist for the whole page, so every GST box offers the real slabs. */
function mmInstallGstSlabList() {
    if (document.getElementById('mmGstSlabList')) return;
    const dl = document.createElement('datalist');
    dl.id = 'mmGstSlabList';
    dl.innerHTML = MM_GST_SLABS.map(r => `<option value="${r}">`).join('');
    document.body.appendChild(dl);
}
window.MM_GST_SLABS = MM_GST_SLABS;
window.mmIsValidGstRate = mmIsValidGstRate;
window.mmWatchGstInput = mmWatchGstInput;
window.mmInstallGstSlabList = mmInstallGstSlabList;

/* ─────────────────────────────────────────────────────
   HSN BACK-FILL
   HSN is mandatory in GSTR-1, and any bill raised before the shop started
   entering it has none. Fixing that one bill at a time is hopeless — a year
   of sales is thousands of lines — and deleting and re-entering bills is
   worse, because it puts gaps in the invoice-number series that GSTR-1's
   doc_issue section declares.

   So the fix is applied per PRODUCT, across its history:
     purchases   — the source sales read HSN from, so future bills self-fill
     bill_items  — past sales, ONLY where the HSN is blank, so a value the
                   shop entered deliberately is never overwritten

   Amounts, quantities and tax are untouched: this fills in a missing
   reporting code, it does not restate any bill.
───────────────────────────────────────────────────── */
const MM_COMMON_HSN = [
    ['30049099', 'Medicaments — general'],
    ['30041020', 'Penicillins / amoxicillin'],
    ['30041090', 'Other antibiotics'],
    ['30042090', 'Antibiotic formulations'],
    ['30045000', 'Vitamins'],
    ['30049011', 'Ayurvedic / herbal'],
    ['30051090', 'Dressings, bandages'],
    ['90183900', 'Syringes, needles, catheters'],
    ['90189099', 'Medical instruments'],
    ['21069099', 'Food / protein supplements'],
    ['33049990', 'Skin care, cosmetics'],
    ['34011190', 'Medicated soap'],
];
window.MM_COMMON_HSN = MM_COMMON_HSN;

async function dbSetProductHsn(productName, hsn) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const p = String(productName || '').trim();
    const h = String(hsn || '').trim();
    if (!p || !h) return { success: false, message: 'Product and HSN are both required.' };

    let purchases = 0, items = 0;
    try {
        // Purchases: match the name case-insensitively but exactly, so "Dolo 650"
        // does not also catch "Dolo 650 DT".
        const { data: pr, error: pErr } = await _supabase.from('purchases')
            .update({ hsn: h }).eq('user_id', user).ilike('product_name', p).select('id');
        if (pErr) console.warn('[db] hsn purchases update:', pErr.message);
        else purchases = (pr || []).length;
    } catch (e) { console.warn('[db] hsn purchases update failed:', e); }

    try {
        // bill_items has no user_id of its own — it hangs off bills — so collect
        // this shop's bill ids first and scope the update to them.
        const { data: bills } = await _supabase.from('bills').select('id').eq('user_id', user);
        const ids = (bills || []).map(b => b.id);
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const { data: bi, error: bErr } = await _supabase.from('bill_items')
                .update({ hsn: h })
                .in('bill_id', batch)
                .ilike('product', p)
                .or('hsn.is.null,hsn.eq.')          // blank only — never overwrite
                .select('id');
            if (bErr) { console.warn('[db] hsn bill_items update:', bErr.message); break; }
            items += (bi || []).length;
        }
    } catch (e) { console.warn('[db] hsn bill_items update failed:', e); }

    return { success: true, purchases, items };
}
window.dbSetProductHsn = dbSetProductHsn;

/* Correct the GST rate on an already-saved bill line.
   A rate like 7.5% or 2% does not exist, so a bill carrying one can never be
   filed — and until this existed the app reported the problem and offered no
   way to fix it, which is not help.

   ONLY the rate moves. The line total is what the customer actually paid and
   is left alone; changing the rate re-splits tax INSIDE that total (taxable
   value shifts, the amount received does not). Recomputing the total from the
   new rate would silently rewrite history and disagree with the printed bill.

   Scoped by bill number AND the wrong rate, so a correctly-rated line of the
   same medicine on the same bill is never touched. */
async function dbSetBillItemGst(billNo, product, fromRate, toRate) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const bn = String(billNo || '').trim();
    const p  = String(product || '').trim();
    if (!bn || !p) return { success: false, message: 'Bill number and product are both required.' };

    try {
        const { data: bills, error: bErr } = await _supabase.from('bills')
            .select('id').eq('user_id', user).eq('bill_no', bn);
        if (bErr) return { success: false, message: bErr.message };
        const ids = (bills || []).map(b => b.id);
        if (!ids.length) return { success: false, message: 'Bill ' + bn + ' not found in the cloud.' };

        const { data, error } = await _supabase.from('bill_items')
            .update({ gst: Number(toRate) || 0 })
            .in('bill_id', ids)
            .ilike('product', p)
            .eq('gst', Number(fromRate) || 0)
            .select('id');
        if (error) return { success: false, message: error.message };
        return { success: true, items: (data || []).length };
    } catch (e) {
        return { success: false, message: String(e && e.message ? e.message : e) };
    }
}
window.dbSetBillItemGst = dbSetBillItemGst;

const MM_EXPENSE_CATEGORIES = [
    'Rent', 'Salary', 'Electricity', 'Freight / Transport', 'Phone / Internet',
    'Repairs & Maintenance', 'Licence & Fees', 'Bank Charges', 'GST / Tax Paid',
    'Packing Material', 'Other'
];
window.MM_EXPENSE_CATEGORIES = MM_EXPENSE_CATEGORIES;

/* EVERY COLUMN THE WRITER SENDS MUST COME BACK. A mapper that lists fields
   silently drops anything added later — that is how entry_type turned IN
   entries into OUT ones, and how a credit sale came back as cash. The staff
   fields are only present once add_staff_tables.sql has run, so they are read
   defensively rather than assumed. */
function _expRowToObj(r) {
    return {
        id: r.expense_id, date: r.exp_date || '', category: r.category || 'Other',
        note: r.note || '', amount: Number(r.amount) || 0,
        paymentMode: r.payment_mode || 'Cash', savedAt: r.saved_at || '',
        staffId: r.staff_id || '', staffName: r.staff_name || '', payType: r.pay_type || '',
        days: Number(r.staff_days) || 0
    };
}

async function dbGetExpenses() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetExpenses: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('expenses')
        .select('*').eq('user_id', user).order('exp_date', { ascending: false });
    if (error) { console.error('expenses fetch:', error); return []; }
    return (data || []).map(_expRowToObj);
}
window.dbGetExpenses = dbGetExpenses;

async function dbSaveExpense(e) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbSaveExpense: no user, aborting.'); return { success: false }; }
    const row = {
        expense_id:   e.id,
        user_id:      user,
        exp_date:     e.date || new Date().toISOString().slice(0, 10),
        category:     e.category || 'Other',
        note:         e.note || '',
        amount:       Number(e.amount) || 0,
        payment_mode: e.paymentMode || 'Cash',
        saved_at:     e.savedAt || new Date().toISOString()
    };
    /* Salary payments are ordinary expenses carrying three extra columns —
       one money path, so the P&L, Day Book, Cash Flow and Tally all pick them
       up unchanged and cannot disagree with the staff report. */
    if (e.staffId)   row.staff_id   = e.staffId;
    if (e.staffName) row.staff_name = e.staffName;
    if (e.payType)   row.pay_type   = e.payType;
    if (e.days)      row.staff_days = Number(e.days) || 0;

    let { error } = await _supabase.from('expenses').upsert(row, { onConflict: 'expense_id' });
    /* Drop ONLY the column the error names and retry, so a shop that has not
       run add_staff_tables.sql still saves the expense instead of losing it.
       Dropping every unknown column blindly is how a payment_mode goes missing
       and a credit sale silently becomes a cash one (v315). */
    if (error && /column .* does not exist|Could not find the '.*' column/i.test(error.message || '')) {
        const named = (error.message.match(/'([a-z_]+)'|column "?([a-z_]+)"?/i) || [])
            .slice(1).find(Boolean);
        if (named && named in row) {
            delete row[named];
            ({ error } = await _supabase.from('expenses').upsert(row, { onConflict: 'expense_id' }));
        }
    }
    if (error) { console.error('expense save:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSaveExpense = dbSaveExpense;

/* ─────────────────────────────────────────────────────
   STAFF — who works here. Money is NOT here: a salary
   payment is an ordinary expense row carrying staffId /
   staffName / payType, so the P&L, Day Book, Cash Flow
   and Tally pick it up unchanged and cannot disagree
   with the staff report. Two money paths in one app is
   how a shop gets two answers for what it spent.
   Needs migrations/add_staff_tables.sql.
───────────────────────────────────────────────────── */
function _staffRowToObj(r) {
    return {
        id: r.staff_id, name: r.name || '', role: r.role || '', phone: r.phone || '',
        joined: r.joined || '', payBasis: r.pay_basis || '',
        payAmount: Number(r.pay_amount) || 0,
        active: r.active !== false, note: r.note || '', savedAt: r.saved_at || ''
    };
}

async function dbGetStaff() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetStaff: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('staff')
        .select('*').eq('user_id', user).order('name');
    if (error) { console.error('staff fetch:', error); return []; }
    return (data || []).map(_staffRowToObj);
}
window.dbGetStaff = dbGetStaff;

async function dbSaveStaff(s) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbSaveStaff: no user, aborting.'); return { success: false }; }
    const { error } = await _supabase.from('staff').upsert({
        staff_id:   s.id,
        user_id:    user,
        name:       (s.name || '').trim(),
        role:       s.role || '',
        phone:      s.phone || '',
        joined:     s.joined || null,
        pay_basis:  s.payBasis || '',
        pay_amount: Number(s.payAmount) || 0,
        active:     s.active !== false,
        note:       s.note || '',
        saved_at:   s.savedAt || new Date().toISOString()
    }, { onConflict: 'staff_id' });
    if (error) { console.error('staff save:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSaveStaff = dbSaveStaff;

async function dbDeleteStaff(id) {
    const user = _currentUser();
    if (!user) return false;
    const { error } = await _supabase.from('staff').delete().eq('staff_id', id).eq('user_id', user);
    if (error) { console.error('staff delete:', error); return false; }
    return true;
}
window.dbDeleteStaff = dbDeleteStaff;

/* Union-merge into the local cache, same rule as the Schedule H drug list
   (v347): a person added offline must survive a sync, and an empty cloud (or
   a missing table before the migration) must never wipe what is on the
   device. */
async function dbSyncStaff() {
    let cloud = [];
    try { cloud = await dbGetStaff(); } catch (e) { return _staffLocal(); }
    if (!Array.isArray(cloud) || !cloud.length) return _staffLocal();
    const local = _staffLocal();
    const byId = new Map();
    local.forEach(function (s) { if (s && s.id) byId.set(s.id, s); });
    cloud.forEach(function (s) { if (s && s.id) byId.set(s.id, s); });
    const merged = Array.from(byId.values())
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    try { localStorage.setItem('mm_staff', JSON.stringify(merged)); } catch (e) {}
    return merged;
}
function _staffLocal() {
    try { return JSON.parse(localStorage.getItem('mm_staff') || '[]') || []; } catch (e) { return []; }
}
window.dbSyncStaff = dbSyncStaff;

async function dbDeleteExpense(id) {
    const user = _currentUser();
    if (!user) return false;
    const { error } = await _supabase.from('expenses').delete().eq('expense_id', id).eq('user_id', user);
    if (error) { console.error('expense delete:', error); return false; }
    return true;
}
window.dbDeleteExpense = dbDeleteExpense;

/* Pull expenses down and refresh the local cache. Falls back to whatever is
   cached when offline or before the migration has been run, so the Report page
   never breaks over a missing table — it just shows no expenses. */
async function dbSyncExpenses() {
    let rows = [];
    try { rows = await dbGetExpenses(); } catch (e) { rows = []; }
    if (rows.length) {
        try { localStorage.setItem('mm_expenses', JSON.stringify(rows)); } catch (e) {}
        return rows;
    }
    try { return JSON.parse(localStorage.getItem('mm_expenses') || '[]'); } catch (e) { return []; }
}
window.dbSyncExpenses = dbSyncExpenses;

/* ─────────────────────────────────────────────────────
   CUSTOMER PAYMENTS (khata settlements). One row per payment
   a customer makes against their credit balance. Feeds the
   per-customer Statement (passbook) on the Accounts page.
   Needs migrations/add_customer_payments_table.sql.
───────────────────────────────────────────────────── */
async function dbGetCustomerPayments() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetCustomerPayments: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('customer_payments')
        .select('*').eq('user_id', user).order('pay_date', { ascending: false });
    if (error) { console.error('customer payments fetch:', error); return []; }
    return (data || []).map(r => ({
        id: r.payment_id, name: r.name || '', amount: Number(r.amount) || 0,
        date: r.pay_date || '', note: r.note || '', savedAt: r.saved_at || '',
        paymentMode: r.payment_mode || 'Cash'
    }));
}
window.dbGetCustomerPayments = dbGetCustomerPayments;

async function dbAddCustomerPayment(p) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddCustomerPayment: no user, aborting.'); return { success: false }; }
    const row = {
        payment_id: p.id, user_id: user, name: p.name || '',
        amount: Number(p.amount) || 0, pay_date: p.date || new Date().toISOString().slice(0, 10),
        note: p.note || '', saved_at: p.savedAt || new Date().toISOString(),
        payment_mode: p.paymentMode || 'Cash'
    };
    let { error } = await _supabase.from('customer_payments').upsert(row, { onConflict: 'payment_id' });
    // Migration not run — drop only the named column and retry. See dbAddSupplierPayment.
    if (error && /payment_mode/i.test(String(error.message || ''))) {
        console.warn('[db] customer_payments.payment_mode missing — run migrations/add_payment_modes.sql');
        const legacy = Object.assign({}, row); delete legacy.payment_mode;
        ({ error } = await _supabase.from('customer_payments').upsert(legacy, { onConflict: 'payment_id' }));
    }
    if (error) { console.error('customer payment add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddCustomerPayment = dbAddCustomerPayment;

async function dbDeleteCustomerPayment(id) {
    const user = _currentUser();
    if (!user) return false;
    const { error } = await _supabase.from('customer_payments').delete().eq('payment_id', id).eq('user_id', user);
    return !error;
}
window.dbDeleteCustomerPayment = dbDeleteCustomerPayment;

/* SUPPLIER MASTER — the shop's supplier list (name, GSTIN, phone, address).
   Purchases pick from this; the Supplier Ledger groups by it.
   Needs migrations/add_suppliers_table.sql. */
async function dbGetSuppliers() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetSuppliers: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('suppliers').select('*').eq('user_id', user).order('name');
    if (error) { console.error('suppliers fetch:', error); return []; }
    const rows = (data || []).map(r => ({
        name: r.name || '', gstin: r.gstin || '', phone: r.phone || '', address: r.address || '',
        opening: Number(r.opening_balance) || 0, openingDate: r.opening_date || ''
    }));
    /* Cached as a plain name→amount map because js/position.js is
       SYNCHRONOUS and pure: it reads localStorage and cannot await a fetch.
       Written on every read so the map cannot outlive the truth.

       Keyed on the supplier's REAL name, not a lowercased one: position.js
       feeds these keys straight into slot(), which both records the name for
       the merge tool and applies the shop's own merge map. A lowercased key
       would put "sun pharma" in front of the shop beside its own "Sun Pharma"
       and look like a duplicate it needed to fix. */
    _cacheSupplierOpenings(rows);
    return rows;
}
window.dbGetSuppliers = dbGetSuppliers;

function _cacheSupplierOpenings(rows) {
    try {
        const m = {};
        (rows || []).forEach(r => {
            const amt = Number(r.opening) || 0;
            if (amt) m[String(r.name || '').trim()] = amt;
        });
        localStorage.setItem('mm_supplier_openings', JSON.stringify(m));
    } catch (e) {}
}

/* `opening` is what the shop already owed this supplier before Billware.
   It is stored on the supplier and read ONLY by the balance formula — it
   never becomes a purchase (which would invent stock and input credit) and
   never becomes a payment (which would move money that did not move). */
async function dbAddSupplier(name, gstin, phone, address, opening, openingDate) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddSupplier: no user, aborting.'); return { success: false }; }
    const nm = (name || '').trim();
    if (!nm) return { success: false, message: 'Supplier name required.' };

    const base = {
        user_id: user, name: nm, gstin: (gstin || '').trim(),
        phone: (phone || '').trim(), address: (address || '').trim()
    };
    const row = Object.assign({}, base);
    const hasOpening = opening !== undefined && opening !== null && opening !== '';
    if (hasOpening) {
        row.opening_balance = Number(opening) || 0;
        if (openingDate) row.opening_date = openingDate;
    }

    /* Keep the figure on THIS device first, so the supplier ledger is right
       immediately even if the column does not exist yet or the shop is
       offline. Same order as dbAddBarcode: cache, then cloud. */
    if (hasOpening) {
        try {
            const m = JSON.parse(localStorage.getItem('mm_supplier_openings') || '{}');
            const amt = Number(opening) || 0;
            if (amt) m[nm] = amt; else delete m[nm];
            localStorage.setItem('mm_supplier_openings', JSON.stringify(m));
        } catch (e) {}
    }

    let { error } = await _supabase.from('suppliers').upsert(row, { onConflict: 'user_id,name' });
    /* Migration not run yet — drop ONLY the columns the error names and retry,
       rather than losing the supplier entirely. Never a blanket retry: that is
       how a payment_mode went missing and a credit sale became a cash one. */
    if (error && /opening_balance|opening_date/i.test(String(error.message || ''))) {
        console.warn('[db] suppliers.opening_balance missing — run migrations/add_supplier_opening.sql. ' +
                     'The opening is kept on this device until then.');
        ({ error } = await _supabase.from('suppliers').upsert(base, { onConflict: 'user_id,name' }));
    }
    if (error) { console.error('supplier add:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddSupplier = dbAddSupplier;

async function dbDeleteSupplier(name) {
    const user = _currentUser();
    if (!user) return false;
    const { error } = await _supabase.from('suppliers').delete().eq('user_id', user).eq('name', (name || '').trim());
    return !error;
}
window.dbDeleteSupplier = dbDeleteSupplier;

/* REORDER LEVELS — per-medicine "buy more when stock drops below this" override.
   Smart defaults are computed client-side from sales speed; this stores only the
   manual overrides the owner sets. Needs migrations/add_reorder_levels_table.sql. */
async function dbGetReorderLevels() {
    const user = _currentUser();
    if (!user) return [];
    const { data, error } = await _supabase.from('reorder_levels').select('*').eq('user_id', user);
    if (error) { console.error('reorder levels fetch:', error); return []; }
    return (data || []).map(r => ({ name: r.product_name || '', level: Number(r.level) || 0 }));
}
window.dbGetReorderLevels = dbGetReorderLevels;

async function dbSetReorderLevel(name, level) {
    const user = _currentUser();
    if (!user) return { success: false };
    const nm = (name || '').trim();
    if (!nm) return { success: false };
    const { error } = await _supabase.from('reorder_levels')
        .upsert({ user_id: user, product_name: nm, level: Number(level) || 0 }, { onConflict: 'user_id,product_name' });
    if (error) { console.error('reorder level save:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSetReorderLevel = dbSetReorderLevel;

async function dbDeleteReorderLevel(name) {
    const user = _currentUser();
    if (!user) return false;
    const { error } = await _supabase.from('reorder_levels').delete().eq('user_id', user).eq('product_name', (name || '').trim());
    return !error;
}
window.dbDeleteReorderLevel = dbDeleteReorderLevel;

/* ─────────────────────────────────────────────────────
   AUDIT LOG — who did what, when. Fire-and-forget: callers
   just do mmAudit('action', 'detail', 'ref'); it never throws
   and never blocks. Viewed on the Report page.
   Needs migrations/add_audit_log_table.sql.
───────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────
   GLOBAL APP CONFIG — a few site-wide key/value switches the
   owner flips from the Supabase Table Editor (no redeploy).
   Cached to localStorage so reads are synchronous.
   Needs migrations/add_app_config_table.sql.
───────────────────────────────────────────────────── */
async function dbSyncAppConfig() {
    try {
        const { data, error } = await _supabase.from('app_config').select('key,value');
        if (error) return;
        const map = {};
        (data || []).forEach(r => { if (r.key) map[r.key] = r.value; });
        localStorage.setItem('mm_app_config', JSON.stringify(map));
    } catch (e) { /* config is optional — never break the app */ }
}
window.dbSyncAppConfig = dbSyncAppConfig;

function mmConfig(key, dflt) {
    try { const m = JSON.parse(localStorage.getItem('mm_app_config') || '{}'); return (key in m) ? m[key] : dflt; }
    catch (e) { return dflt; }
}
window.mmConfig = mmConfig;

// Backup reminders on unless the owner set backup_reminders = 'off' (i.e. on Pro).
function mmBackupRemindersOn() { return String(mmConfig('backup_reminders', 'on')).toLowerCase() !== 'off'; }
window.mmBackupRemindersOn = mmBackupRemindersOn;

/* ─────────────────────────────────────────────────────
   WHICH TAX HEAD APPLIES — CGST+SGST, or IGST

   A supply to a registered buyer in ANOTHER state is an IGST supply at the
   buyer's place of supply. One rate, one head — 12% filed whole rather than
   split into two 6% halves. Same money either way, but the head is what the
   buyer's GSTR-2B matches against, so getting it wrong means their input
   credit does not reconcile with your invoice.

   The till had no notion of this at all: it billed and printed CGST+SGST on
   every sale. v309 taught all three EXPORTS the difference — GSTR-1 emits
   iamt, Tally posts one IGST ledger, the e-invoice always did — and then had
   to warn that the printed bill still disagreed with them. This is the root
   fix that warning was standing in for.

   Deliberately DERIVED, never stored on the bill: gstr1-export.js works it
   out live from the customer record, so a stored flag could drift out of step
   with what actually gets filed. One rule, computed the same way everywhere.
   The rule itself is copied from gstr1-export.js line for line — a registered
   buyer whose state code differs from the shop's.

   A walk-in is NOT inter-state even if they carry the goods away to another
   state: with no GSTIN the place of supply is where the goods are handed
   over, which is the shop. That is why a missing buyer GSTIN means intra.
───────────────────────────────────────────────────── */
function mmTaxHead(buyerGstin) {
    const buyer = String(buyerGstin || '').trim().toUpperCase();
    let shop = '';
    try {
        const sp = window.mmShopProfile || {};
        shop = String(sp.gstin || '').trim().toUpperCase();
        if (!shop && typeof mmLsGet === 'function') {
            const c = mmLsGet('profile') || {};
            shop = String(c.gstin || c.gst_no || '').trim().toUpperCase();
        }
    } catch (e) {}
    const shopPos  = shop.length  === 15 ? shop.slice(0, 2)  : '';
    const buyerPos = buyer.length === 15 ? buyer.slice(0, 2) : '';
    const interState = !!buyerPos && !!shopPos && buyerPos !== shopPos;
    return { interState: interState, pos: interState ? buyerPos : shopPos, buyerGstin: buyer };
}
window.mmTaxHead = mmTaxHead;

/* The buyer's GSTIN for a saved bill. By customer id first — that survives a
   typo or a later rename, which is why the id is stamped on the bill at save
   time — then by name for older bills that predate it. */
function mmBillBuyerGstin(bill) {
    if (!bill) return '';
    /* mmCustomerList, not mmCacheGet: the scoped customers store is a PARTIAL
       copy, and preferring it would hide the buyer whose GSTIN decides whether
       this bill files as B2B. */
    let list = [];
    try { list = mmCustomerList(); } catch (e) {}
    if (bill.customerId != null) {
        const byId = list.find(c => c && String(c.id) === String(bill.customerId));
        if (byId) return String(byId.gstin || '');
    }
    const nm = String(bill.customerName || bill.customer_name || '').trim().toLowerCase();
    if (!nm) return '';
    const hit = list.find(c => String(c && c.name || '').trim().toLowerCase() === nm);
    return hit ? String(hit.gstin || '') : '';
}
window.mmBillBuyerGstin = mmBillBuyerGstin;

/* ─────────────────────────────────────────────────────
   READ A LOCAL CACHE, FROM WHICHEVER KEY ACTUALLY HOLDS IT

   Two localStorage conventions grew side by side: a SCOPED one,
   mm_<tenant>_<name> via mmLsGet/mmLsSet, and an UNSCOPED one, mm_<name>,
   written directly. Some stores use one, some the other, and for `sales` and
   `purchases` the two halves never met — every writer used the unscoped key
   and every reader asked for the scoped one.

   Seven read sites across Report and Inventory, zero matching writes. Each
   had a fallback that looked like it covered exactly this:

       (typeof mmLsGet === 'function') ? (mmLsGet('sales') || [])
                                       : localStorage.getItem('mm_sales')

   but mmLsGet is ALWAYS defined, so the fallback was unreachable and every
   one of those reads returned []. The "instant paint from the local cache"
   on both pages painted nothing, both pages were blank offline, and a bill
   could not be found for reprinting without the network. Silent, because an
   empty cache is indistinguishable from a shop with no data yet.

   Prefers the scoped store when it holds anything — so this keeps working if
   a writer is moved to scoped later — and otherwise reads the key that is
   actually being written. Same shape as _custList() in report.html, which
   fixed the customers half of this in v310.
───────────────────────────────────────────────────── */
/* EVERY customer this device knows, from BOTH stores.

   mmCacheGet is wrong for customers and this is what it cost: it prefers the
   scoped store whenever that store holds anything, which assumes a store that
   exists is COMPLETE. mm_<user>_customers is not — only customers touched by a
   settlement or a balance adjustment are ever written there. So one settled
   customer in the scoped store masked the entire unscoped list, and the
   "Where You Stand" panel reported ONE account owing Rs 16 against a Khata
   page showing Rs 811.58 across several.

   Union, matched on lowercased name, unscoped first because that is the store
   dbSyncCoreData fills from the cloud and therefore the complete one. Anything
   the scoped store knows that it does not is appended rather than dropped. */
function mmCustomerList() {
    const out = [], seen = {};
    const take = (list) => {
        (list || []).forEach(c => {
            const k = String(c && c.name || '').trim().toLowerCase();
            if (!k || seen[k]) return;
            seen[k] = true; out.push(c);
        });
    };
    try { take(JSON.parse(localStorage.getItem('mm_customers') || '[]')); } catch (e) {}
    try { if (typeof mmLsGet === 'function') take(mmLsGet('customers') || []); } catch (e) {}
    return out;
}
window.mmCustomerList = mmCustomerList;

function mmCacheGet(name) {
    let scoped = null;
    try { if (typeof mmLsGet === 'function') scoped = mmLsGet(name); } catch (e) {}
    if (Array.isArray(scoped) && scoped.length) return scoped;
    try {
        const raw = JSON.parse(localStorage.getItem('mm_' + name) || '[]');
        if (Array.isArray(raw) && raw.length) return raw;
    } catch (e) {}
    return Array.isArray(scoped) ? scoped : [];
}
window.mmCacheGet = mmCacheGet;

/* ─────────────────────────────────────────────────────
   WHEN SOMETHING WAS SAVED — one place, and it never guesses

   Two rules, both learned from getting them wrong:

   1. A DATE IS NOT A TIME. '2026-08-05' parses as UTC midnight, which renders
      as 5:30 am in IST — a plausible-looking time printed on records that
      have no time at all. Anything without a 'T' returns EMPTY. A blank is
      honest; 5:30 am is a lie the shop cannot detect.

   2. Displayed in Asia/Kolkata explicitly, not in whatever the device thinks
      it is. Timestamps are stored as UTC ISO, so a laptop left on a foreign
      timezone would otherwise print a bill as taken at a time nobody in the
      shop recognises. The clock the shop runs on is IST.
───────────────────────────────────────────────────── */
function _mmRealTs(v) {
    const s = String(v == null ? '' : v);
    if (s.indexOf('T') < 1) return null;      // date-only, or empty
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

/* Same instant, shifted so the local getters read IST. India has no daylight
   saving, so a flat +5:30 is exact all year. Used as the fallback when an
   engine refuses the timeZone option — losing the time entirely would be a
   worse answer than computing it. */
function _mmIst(d) {
    return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000);
}

// '2:44 pm', or '' when there is no real timestamp to show.
function mmFmtTime(v) {
    const d = _mmRealTs(v);
    if (!d) return '';
    try { return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); }
    catch (e) {
        const i = _mmIst(d), h = i.getHours(), m = i.getMinutes();
        const h12 = (h % 12) || 12;
        return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'am' : 'pm');
    }
}

// '05 Aug 2026, 2:44 pm', or '' — for "saved on" lines.
function mmFmtDateTime(v) {
    const d = _mmRealTs(v);
    if (!d) return '';
    try {
        return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric',
                                           hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    } catch (e) { return ''; }
}
/* The date an invoice should PRINT — the day the bill is FOR, never the day
   it happened to be saved. Built from the date PARTS rather than
   new Date('2026-08-05'), which parses as UTC and prints as the 4th anywhere
   west of Greenwich and, more to the point here, is the same trap that turned
   a date into a 5:30 am time above. Falls back to the save timestamp only
   when there is no date at all. */
function mmInvoiceDate(bill) {
    const s = String((bill && bill.date) || '').slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
        try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch (e) { return s; }
    }
    const d = _mmRealTs(bill && bill.savedAt);
    if (!d) return s;
    try { return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); }
    catch (e) { return s; }
}

window.mmFmtTime = mmFmtTime;
window.mmFmtDateTime = mmFmtDateTime;
window.mmInvoiceDate = mmInvoiceDate;

function mmAudit(action, detail, ref) {
    try {
        const actor = (typeof mmCurrentUser === 'function' && mmCurrentUser())
            ? (mmCurrentUser().username || 'unknown') : 'unknown';
        const entry = {
            id: 'au_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            actor: actor, action: String(action || ''), detail: String(detail || ''),
            ref: String(ref || ''), at: new Date().toISOString()
        };
        try {
            let arr = JSON.parse(localStorage.getItem('mm_audit_log') || '[]');
            arr.unshift(entry);
            if (arr.length > 500) arr = arr.slice(0, 500);   // keep local light
            localStorage.setItem('mm_audit_log', JSON.stringify(arr));
        } catch (e) {}
        const user = _currentUser();
        if (user && typeof _supabase !== 'undefined') {
            _supabase.from('audit_log').insert({
                log_id: entry.id, user_id: user, actor: entry.actor,
                action: entry.action, detail: entry.detail, ref: entry.ref, at: entry.at
            }).then(function () {}, function () {});   // best-effort, ignore errors
        }
    } catch (e) { /* audit must never break the real action */ }
}
window.mmAudit = mmAudit;

/* ─────────────────────────────────────────────────────
   TILL COUNTS — what was actually in the drawer

   Needs migrations/add_till_counts_table.sql. Without it these fail quietly
   and the screen falls back to the local copy, which is the right degradation:
   a shop that has not run the migration can still count its till on the
   machine it counts it on.

   One row per shop per day, upserted — a second count for a day is a
   CORRECTION, not another count. Anything else would let a shop's cash be
   recorded twice by someone re-entering a figure they mistyped.
───────────────────────────────────────────────────── */
async function dbGetTillCounts(fromDay, toDay) {
    const user = _currentUser();
    if (!user) return [];
    let q = _supabase.from('till_counts').select('*').eq('user_id', user);
    if (fromDay) q = q.gte('day', fromDay);
    if (toDay)   q = q.lte('day', toDay);
    const { data, error } = await q.order('day', { ascending: false });
    if (error) { console.warn('[db] till counts fetch:', error.message); return []; }
    return (data || []).map(r => ({
        day: String(r.day || '').slice(0, 10),
        opening: Number(r.opening) || 0,
        counted: Number(r.counted) || 0,
        note: r.note || '',
        countedAt: r.counted_at || ''
    }));
}
window.dbGetTillCounts = dbGetTillCounts;

async function dbSaveTillCount(rec) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const day = String(rec && rec.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { success: false, message: 'Bad date.' };
    const row = {
        user_id: user, day: day,
        opening: Number(rec.opening) || 0,
        counted: Number(rec.counted) || 0,
        note: String(rec.note || ''),
        counted_at: new Date().toISOString()
    };
    const { error } = await _supabase.from('till_counts')
        .upsert(row, { onConflict: 'user_id,day' });
    if (error) { console.warn('[db] till count save:', error.message); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSaveTillCount = dbSaveTillCount;

/* ─────────────────────────────────────────────────────
   FINANCE ACCOUNTS — cash, bank, capital, loans, assets, deposits

   The right-hand side of the balance sheet, which no bill or purchase ever
   records. js/finance.js owns the arithmetic; this owns the storage.

   Everything here degrades to LOCAL-ONLY when migrations/add_finance_accounts.sql
   has not been run. That is deliberate and matches opening stock and till
   counts: the shop can enter its figures today and they will reach the server
   whenever the migration lands, instead of the screen being dead until then.
   A missing table must never look like a lost entry.
───────────────────────────────────────────────────── */
function _mmFinLocal(key, rows) {
    try { localStorage.setItem(key, JSON.stringify(rows || [])); } catch (e) {}
}
function _mmFinRead(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) { return []; }
}

/* ⚠️ REPLACING THE LOCAL COPY WITH THE CLOUD COPY DESTROYS OFFLINE WORK.
   dbSaveFinanceAccount and dbAddFinanceEntries both write LOCALLY FIRST and
   then attempt the cloud — deliberately, so the figures survive a missing
   migration. But if that cloud write failed (offline, RLS, a dropped
   connection) the row exists only on this device, and the next sync used to
   do a flat `localStorage.setItem(key, cloudRows)`.

   The guards already there only covered a null or EMPTY cloud. The dangerous
   case is the ORDINARY one: 20 entries in the cloud, a 21st recorded offline.
   The cloud array is non-empty, so it overwrote — and the EMI payment, the
   capital injection, the asset purchase simply vanished, taking the account
   balance back with it. Not "failed to upload": actively deleted.

   So: keep the cloud as the truth for anything it knows about, KEEP every
   local-only row, and push those rows up. Ids are stable and both writers
   upsert on them, so the backfill cannot duplicate. */
function _mmFinMerge(key, cloud, backfill) {
    if (!cloud || !cloud.length) return;   // null = no table; empty = leave local alone
    const local = _mmFinRead(key);
    const cloudIds = new Set(cloud.map(r => r && r.id).filter(Boolean));
    const localOnly = local.filter(r => r && r.id && !cloudIds.has(r.id));
    _mmFinLocal(key, cloud.concat(localOnly));
    if (localOnly.length && typeof backfill === 'function') {
        console.warn('[db] ' + key + ': ' + localOnly.length
                   + ' row(s) exist only on this device — pushing to the cloud.');
        try { Promise.resolve(backfill(localOnly)).catch(() => {}); } catch (e) {}
    }
}
window._mmFinMerge = _mmFinMerge;
window._mmFinRead  = _mmFinRead;

/* Doctors have the same hole as the finance rows, for the same reason.
   doctor.html and directory.html push a doctor into mm_doctors "as offline
   fallback" WHETHER OR NOT the cloud save succeeded, and the sync then did a
   flat `setItem('mm_doctors', cloudRows)` — so a doctor added while the cloud
   was unreachable was deleted by the next sync.

   Merged on name+phone rather than an id because the local rows carry no id
   ({name, phone, clinic, address}), and name+phone is already the identity
   this app uses for a doctor everywhere else — name alone was fixed years ago
   precisely because two doctors share a name. */
function _mmMergeDoctors(cloud) {
    if (!cloud || !cloud.length) return cloud;
    const key = d => String((d && d.name) || '').trim().toLowerCase()
              + '|' + String((d && d.phone) || '').trim();
    let local = [];
    try { local = JSON.parse(localStorage.getItem('mm_doctors') || '[]') || []; } catch (e) {}
    if (!Array.isArray(local) || !local.length) return cloud;

    const seen = new Set(cloud.map(key));
    const localOnly = local.filter(d => d && d.name && !seen.has(key(d)));
    if (!localOnly.length) return cloud;

    console.warn('[db] mm_doctors: ' + localOnly.length
               + ' doctor(s) exist only on this device — pushing to the cloud.');
    if (typeof dbAddDoctor === 'function') {
        localOnly.forEach(d => {
            try {
                dbAddDoctor(d.name || '', d.phone || '', d.clinic || '', d.address || '', d.regNo || '')
                    .catch(() => {});
            } catch (e) {}
        });
    }
    return cloud.concat(localOnly);
}
window._mmMergeDoctors = _mmMergeDoctors;

async function dbGetFinanceAccounts() {
    const user = _currentUser();
    if (!user) return [];
    const { data, error } = await _supabase.from('finance_accounts')
        .select('*').eq('user_id', user).order('kind', { ascending: true });
    if (error) { console.warn('[db] finance accounts fetch:', error.message); return null; }
    return (data || []).map(r => ({
        id: r.account_id,
        kind: r.kind || 'cash',
        name: r.name || '',
        opening: Number(r.opening) || 0,
        openingDate: String(r.opening_date || '').slice(0, 10),
        meta: r.meta || {},
        active: r.active !== false,
        savedAt: r.saved_at || ''
    }));
}
window.dbGetFinanceAccounts = dbGetFinanceAccounts;

async function dbSaveFinanceAccount(a) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    if (!a || !a.id) return { success: false, message: 'No account id.' };

    // Local first, so nothing depends on the migration having been run.
    const rows = _mmFinRead('mm_finance_accounts').filter(x => x && x.id !== a.id);
    rows.push(a);
    _mmFinLocal('mm_finance_accounts', rows);

    const { error } = await _supabase.from('finance_accounts').upsert({
        account_id: a.id, user_id: user,
        kind: a.kind, name: String(a.name || ''),
        opening: Number(a.opening) || 0,
        opening_date: a.openingDate || null,
        meta: a.meta || {},
        active: a.active !== false,
        saved_at: new Date().toISOString()
    }, { onConflict: 'account_id' });
    if (error) { console.warn('[db] finance account save:', error.message); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSaveFinanceAccount = dbSaveFinanceAccount;

/* Deleting an account takes its entries with it. Leaving them behind would
   leave movements pointing at nothing — invisible on every screen, but still
   summed by anything that reads the entries table directly. */
async function dbDeleteFinanceAccount(id) {
    const user = _currentUser();
    if (!user || !id) return false;
    _mmFinLocal('mm_finance_accounts', _mmFinRead('mm_finance_accounts').filter(x => x && x.id !== id));
    _mmFinLocal('mm_finance_entries',  _mmFinRead('mm_finance_entries').filter(x => x && x.accountId !== id));
    try {
        await _supabase.from('finance_entries').delete().eq('account_id', id).eq('user_id', user);
        const { error } = await _supabase.from('finance_accounts').delete().eq('account_id', id).eq('user_id', user);
        return !error;
    } catch (e) { return false; }
}
window.dbDeleteFinanceAccount = dbDeleteFinanceAccount;

async function dbGetFinanceEntries() {
    const user = _currentUser();
    if (!user) return [];
    const { data, error } = await _supabase.from('finance_entries')
        .select('*').eq('user_id', user).order('entry_date', { ascending: false });
    if (error) { console.warn('[db] finance entries fetch:', error.message); return null; }
    return (data || []).map(r => ({
        id: r.entry_id,
        accountId: r.account_id,
        date: String(r.entry_date || '').slice(0, 10),
        direction: Number(r.direction) === -1 ? -1 : 1,
        amount: Math.abs(Number(r.amount) || 0),
        interest: Math.abs(Number(r.interest) || 0),
        kind: r.kind || '',
        note: r.note || '',
        ref: r.ref || '',
        savedAt: r.saved_at || ''
    }));
}
window.dbGetFinanceEntries = dbGetFinanceEntries;

/* Takes an ARRAY, because a paired movement is two rows that must both land
   or neither. An EMI that reduced the loan but never left the bank is worse
   than one that was not recorded at all — the shop would be looking at money
   it does not have. Local write is atomic; the cloud upsert is one call. */
async function dbAddFinanceEntries(list) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const rows = (list || []).filter(e => e && e.id && e.accountId);
    if (!rows.length) return { success: false, message: 'Nothing to save.' };

    const existing = _mmFinRead('mm_finance_entries');
    const ids = new Set(rows.map(e => e.id));
    _mmFinLocal('mm_finance_entries', [...existing.filter(x => x && !ids.has(x.id)), ...rows]);

    const { error } = await _supabase.from('finance_entries').upsert(rows.map(e => ({
        entry_id: e.id, user_id: user, account_id: e.accountId,
        entry_date: e.date, direction: e.direction === -1 ? -1 : 1,
        amount: Math.abs(Number(e.amount) || 0),
        interest: Math.abs(Number(e.interest) || 0),
        kind: e.kind || '', note: String(e.note || ''), ref: e.ref || '',
        saved_at: new Date().toISOString()
    })), { onConflict: 'entry_id' });
    if (error) { console.warn('[db] finance entries save:', error.message); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbAddFinanceEntries = dbAddFinanceEntries;

/* ── Bank reconciliations ────────────────────────────────────────────
   The CONCLUSION of a reconciliation, not the statement behind it — see
   migrations/add_bank_reconciliations.sql for why the lines are not stored.
   Needs that migration; until it is run these resolve to "not available"
   and the screen says so rather than failing. */
async function dbSaveReconciliation(rec) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const { error } = await _supabase.from('bank_reconciliations').upsert({
        recon_id: rec.id, user_id: user, account_id: rec.accountId,
        from_date: rec.from || null, to_date: rec.to || null,
        statement_closing: Number(rec.statementClosing) || 0,
        book_balance: Number(rec.bookBalance) || 0,
        difference: Number(rec.difference) || 0,
        matched_count: Number(rec.matchedCount) || 0,
        bank_only_count: Number(rec.bankOnlyCount) || 0,
        book_only_count: Number(rec.bookOnlyCount) || 0,
        note: String(rec.note || ''), saved_at: new Date().toISOString()
    }, { onConflict: 'recon_id' });
    if (error) {
        if (/relation|does not exist|schema cache|PGRST205/i.test(String(error.message || ''))) {
            return { success: false, message: 'Run migrations/add_bank_reconciliations.sql in Supabase first.' };
        }
        console.error('reconciliation save:', error);
        return { success: false, message: error.message };
    }
    return { success: true };
}
window.dbSaveReconciliation = dbSaveReconciliation;

async function dbGetReconciliations(accountId) {
    const user = _currentUser();
    if (!user) return [];
    let q = _supabase.from('bank_reconciliations').select('*').eq('user_id', user);
    if (accountId) q = q.eq('account_id', accountId);
    const { data, error } = await q.order('to_date', { ascending: false }).limit(24);
    if (error) return [];          // table missing = simply no history yet
    return (data || []).map(r => ({
        id: r.recon_id, accountId: r.account_id, from: r.from_date || '', to: r.to_date || '',
        statementClosing: Number(r.statement_closing) || 0,
        bookBalance: Number(r.book_balance) || 0,
        difference: Number(r.difference) || 0,
        matchedCount: r.matched_count || 0,
        bankOnlyCount: r.bank_only_count || 0, bookOnlyCount: r.book_only_count || 0,
        note: r.note || '', savedAt: r.saved_at || ''
    }));
}
window.dbGetReconciliations = dbGetReconciliations;

/* Deletes by ref when there is one, so undoing an EMI removes BOTH halves.
   Deleting only the half the user clicked would leave the loan repaid and the
   bank never debited — a silent, self-inflicted reconciliation problem. */
async function dbDeleteFinanceEntry(entry) {
    const user = _currentUser();
    if (!user || !entry || !entry.id) return false;
    const all = _mmFinRead('mm_finance_entries');
    const doomed = entry.ref
        ? all.filter(x => x && x.ref === entry.ref).map(x => x.id)
        : [entry.id];
    _mmFinLocal('mm_finance_entries', all.filter(x => x && doomed.indexOf(x.id) === -1));
    try {
        const q = entry.ref
            ? _supabase.from('finance_entries').delete().eq('ref', entry.ref).eq('user_id', user)
            : _supabase.from('finance_entries').delete().eq('entry_id', entry.id).eq('user_id', user);
        const { error } = await q;
        return !error;
    } catch (e) { return false; }
}
window.dbDeleteFinanceEntry = dbDeleteFinanceEntry;

/* Opening debtors and creditors. Same shape and the same reasoning as
   dbSetOpeningStock — a shop that started mid-life was already owed money. */
async function dbSetOpeningBalances(debtors, creditors, asOfDate) {
    const user = _currentUser();
    try {
        localStorage.setItem('mm_opening_debtors', String(Number(debtors) || 0));
        localStorage.setItem('mm_opening_creditors', String(Number(creditors) || 0));
        localStorage.setItem('mm_opening_balances_date', asOfDate || '');
    } catch (e) {}
    if (!user) return { success: false, message: 'Not logged in.' };
    const { error } = await _supabase.from('shop_profiles').upsert({
        user_id: user,
        opening_debtors: Number(debtors) || 0,
        opening_creditors: Number(creditors) || 0,
        opening_balances_date: asOfDate || null,
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) { console.warn('[db] opening balances save:', error.message); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSetOpeningBalances = dbSetOpeningBalances;

async function dbGetAuditLog(limit) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetAuditLog: no user, aborting.'); return []; }
    const { data, error } = await _supabase.from('audit_log')
        .select('*').eq('user_id', user).order('at', { ascending: false }).limit(limit || 500);
    if (error) { console.error('audit log fetch:', error); return []; }
    return (data || []).map(r => ({
        id: r.log_id, actor: r.actor || '', action: r.action || '',
        detail: r.detail || '', ref: r.ref || '', at: r.at || ''
    }));
}
window.dbGetAuditLog = dbGetAuditLog;

/* ─────────────────────────────────────────────────────
   STOCK ADJUSTMENTS
   Manual corrections for damaged/lost stock or physical
   count mismatches. Does not touch purchase/sales records —
   only shifts the computed current-stock figure.
───────────────────────────────────────────────────── */
async function dbGetStockAdjustments() {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetStockAdjustments: no user, aborting.'); return []; }
    const { data, error } = await _supabase
        .from('stock_adjustments')
        .select('*')
        .eq('user_id', user)
        .order('created_at', { ascending: false });
    if (error) { console.error('stock adjustments fetch:', error); return []; }
    return data || [];
}
async function dbAddStockAdjustment(row) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddStockAdjustment: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const { data, error } = await _supabase.from('stock_adjustments').insert({
        product_name: row.productName || '',
        batch_no:     row.batchNo     || '',
        qty_before:   Number(row.qtyBefore) || 0,
        qty_after:    Number(row.qtyAfter)  || 0,
        qty_delta:    Number(row.qtyDelta)  || 0,
        reason:       row.reason || 'other',
        note:         row.note   || '',
        user_id:      user,
    }).select();
    if (error) { console.error('stock adjustment add:', error); return { success: false, message: error.message }; }
    return { success: true, data: data?.[0] || null };
}

/* Removes one stock adjustment — which is how a return is undone.

   Until now nothing in the app could delete one, so a return taken by
   mistake was permanent: the stock stayed wrong for ever and a credit note
   the shop never meant to issue kept turning up in the GSTR-1. Stock is
   computed as purchases − sales + adjustments, so deleting the row reverses
   its effect exactly, with no compensating entry to get wrong.

   The local cache is pruned too, so the change shows before the next sync. */
async function dbDeleteStockAdjustment(id) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    if (id === undefined || id === null || id === '') return { success: false, message: 'This entry has no id — it never reached the server.' };
    const { error } = await _supabase.from('stock_adjustments').delete().eq('id', id).eq('user_id', user);
    if (error) { console.error('stock adjustment delete:', error); return { success: false, message: error.message }; }
    try {
        if (typeof mmLsGet === 'function' && typeof mmLsSet === 'function') {
            const local = mmLsGet('stockAdjustments') || [];
            mmLsSet('stockAdjustments', local.filter(a => String(a.id) !== String(id)));
        }
    } catch (e) {}
    return { success: true };
}
window.dbDeleteStockAdjustment = dbDeleteStockAdjustment;

// Retries any stock adjustment that was saved locally but failed to reach
// Supabase (e.g. made before the 'stock_adjustments' table existed yet, or
// while offline). Safe to call repeatedly.
//
// Two sources are retried:
//  1. The explicit pending queue (new saves that failed after this retry
//     mechanism existed).
//  2. "Legacy" entries already sitting in the main stockAdjustments display
//     cache from before this mechanism existed — identifiable because a
//     cloud-confirmed row always has an `id`; a purely local one never got
//     one. Once pushed, the next full dbGetStockAdjustments() fetch replaces
//     the id-less local copy with the real cloud row, so nothing lingers.
/* Identity of an adjustment, used to tell "not yet in the cloud" from "already
   there under a different local shape". Handles both the snake_case cloud row
   and the camelCase local record. */
function _mmAdjKey(a) {
    if (!a) return '';
    const name  = String(a.product_name ?? a.productName ?? '').trim().toLowerCase();
    const batch = String(a.batch_no     ?? a.batchNo     ?? '').trim().toLowerCase();
    const delta = Number(a.qty_delta    ?? a.qtyDelta    ?? 0);
    const note  = String(a.note ?? '');
    return name + '|' + batch + '|' + delta + '|' + note;
}

async function dbSyncPendingStockAdjustments() {
    const user = _currentUser();
    if (!user) return 0;

    const pending  = (typeof mmLsGet === 'function') ? (mmLsGet('pendingStockAdjustments') || []) : [];
    const mainCache = (typeof mmLsGet === 'function') ? (mmLsGet('stockAdjustments') || []) : [];
    const legacyUnsynced = mainCache.filter(a => !a.id);

    if (!pending.length && !legacyUnsynced.length) return 0;

    /* NEITHER source proves the row is missing from the cloud. A pending entry
       may have been inserted just before the page died, and older builds cached
       an id-less copy even when the insert SUCCEEDED — so this function used to
       re-insert rows that were already there, on every page load, for ever. One
       sales return became three identical credit notes under a single CN
       number, inflating stock and the refund total in the P&L, GSTR-1 and
       Tally. Insert is not idempotent, so check before pushing: fetch what the
       cloud already holds and skip anything that matches. The note carries the
       credit-note number, which makes the key specific enough. If the check
       itself fails, push NOTHING — pushing blind is what caused the damage. */
    let already;
    try {
        const cloudRows = await dbGetStockAdjustments();
        already = new Set((cloudRows || []).map(_mmAdjKey));
    } catch (e) {
        console.warn('[db] adjustment dedupe check failed; nothing pushed this round.', e);
        return 0;
    }

    let syncedCount = 0;
    const stillPending = [];
    for (const record of pending) {
        if (already.has(_mmAdjKey(record))) continue;   // already in the cloud — drop it
        try {
            const res = await dbAddStockAdjustment(record);
            if (res && res.success) { syncedCount++; already.add(_mmAdjKey(record)); }
            else stillPending.push(record);
        } catch (e) {
            stillPending.push(record);
        }
    }
    if (typeof mmLsSet === 'function') mmLsSet('pendingStockAdjustments', stillPending);

    for (const legacy of legacyUnsynced) {
        if (already.has(_mmAdjKey(legacy))) continue;   // already in the cloud
        try {
            const res = await dbAddStockAdjustment({
                productName: legacy.product_name || legacy.productName,
                batchNo:     legacy.batch_no     || legacy.batchNo,
                qtyBefore:   legacy.qty_before    ?? legacy.qtyBefore,
                qtyAfter:    legacy.qty_after     ?? legacy.qtyAfter,
                qtyDelta:    legacy.qty_delta     ?? legacy.qtyDelta,
                reason:      legacy.reason,
                note:        legacy.note,
            });
            if (res && res.success) { syncedCount++; already.add(_mmAdjKey(legacy)); }
        } catch (e) { /* will retry again next load */ }
    }

    return syncedCount;
}
window.dbSyncPendingStockAdjustments = dbSyncPendingStockAdjustments;

/* ─────────────────────────────────────────────────────
   BILLS  (sales)
───────────────────────────────────────────────────── */
/* The next invoice number: one past the HIGHEST ever used, never a count.

   Counting the bills reissued a number the moment one was deleted. A shop with
   SS-002..SS-006 and SS-008 — six bills, because SS-007 had been deleted — got
   "SS-007" again for the next sale, and the sale after that would have been
   "SS-008", a number already on a bill. A duplicate invoice number is not a
   cosmetic problem: GST requires them unique and sequential, the portal rejects
   the WHOLE GSTR-1 upload over one (RET291107), and the two bills are
   indistinguishable afterwards.

   Taking the maximum also leaves a deleted bill's number as a permanent GAP,
   which is correct: the gap is then declared as a cancelled document in the
   GSTR-1 "documents issued" table rather than silently reused.

   Local bills are considered too, so a sale made offline cannot hand out a
   number the cloud has not heard about yet. */
async function dbNextBillNo() {
    const user = _currentUser();
    const prefix = window.mmShopProfile?.invoice_prefix || 'MM';
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$', 'i');
    let highest = 0;
    const consider = (no) => {
        const m = re.exec(String(no || '').trim());
        if (m) { const n = parseInt(m[1], 10); if (n > highest) highest = n; }
    };

    if (user) {
        // Only the one column, and only this prefix — the table can be large.
        const { data, error } = await _supabase
            .from('bills').select('bill_no')
            .eq('user_id', user).like('bill_no', prefix + '-%');
        if (error) console.warn('[db] dbNextBillNo:', error.message);
        else (data || []).forEach(r => consider(r.bill_no));
    }
    try {
        (JSON.parse(localStorage.getItem('mm_sales') || '[]') || [])
            .forEach(b => consider(b.billNo || b.bill_no));
    } catch (e) {}

    return prefix + '-' + String(highest + 1).padStart(3, '0');
}
async function dbGetBills(fromDate, toDate) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbGetBills: no user, aborting.'); return []; }
    let query = _supabase.from('bills').select('*, bill_items(*)').eq('user_id', user).order('date', { ascending: false });
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate)   query = query.lte('date', toDate);
    const { data, error } = await query;
    if (error) { console.error('bills fetch:', error); return []; }
    return data;
}
/* Bill number → id, for every bill the shop has. Two columns and nothing else.

   dbGetBills() selects '*, bill_items(*)', so using it to answer "which id is
   SS-006" drags every line of every bill the shop has ever written across the
   wire. That is a lot of milliseconds for a number. */
async function dbBillIdsByNo() {
    const user = _currentUser();
    if (!user) return {};
    const { data, error } = await _supabase.from('bills')
        .select('id, bill_no').eq('user_id', user);
    if (error) { console.warn('[db] bill id lookup:', error.message); return {}; }
    const map = {};
    (data || []).forEach(r => { const n = String(r.bill_no || ''); if (n) map[n] = r.id; });
    return map;
}
window.dbBillIdsByNo = dbBillIdsByNo;

/* Correct a bill's DATE, and nothing else.

   The only UPDATE on the bills table in the app, and deliberately the
   narrowest one possible. Until now a date was written once at insert and
   could never be changed — so a bill entered on the wrong day could only be
   repaired by deleting it and keying it again, which burns its invoice number
   and leaves a permanent gap that GSTR-1 then has to declare as a cancelled
   document. That is a heavy price for a slipped date box.

   Only the date moves. Amounts, lines, tax and the invoice number are all
   left alone, so nothing here can change what the bill says it sold or what
   it charged — the two things a correction must never touch silently.
   Callers are expected to audit the change; mmAudit is not called here so
   that the entry can name where the correction came from. */
async function dbUpdateBillDate(billId, newDate) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbUpdateBillDate: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const d = String(newDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { success: false, message: 'Date must be YYYY-MM-DD.' };
    const { error } = await _supabase.from('bills')
        .update({ date: d }).eq('id', billId).eq('user_id', user);
    if (error) { console.error('bill date update:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbUpdateBillDate = dbUpdateBillDate;

async function dbSaveBill(bill) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbSaveBill: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    let billNo = bill.billNo || await dbNextBillNo();

    // payment_mode preserves Cash/Credit across the cloud round-trip. Built as a
    // helper so we can drop it and retry if the column isn't there yet (pre-migration).
    const _billRow = (no, withPM, withSA) => {
        const p = {
            bill_no:       no,
            date:          bill.date,
            customer_name: bill.customerName || '',
            doctor_name:   bill.doctorName   || '',
            grand_total:   parseFloat(String(bill.grandTotal).replace(/[^0-9.]/g,'')) || 0,
            user_id:       user,
        };
        // Only sent when we actually have one, so a shop that has not run
        // migrations/add_bill_customer_id.sql is unaffected.
        if (bill.customerId != null) p.customer_id = bill.customerId;
        if (withPM) p.payment_mode = bill.paymentMode || 'cash';
        /* The moment the bill was taken, as distinct from the date it is FOR.
           A back-dated bill is a real thing, so the two are not the same
           field and one must never be derived from the other.

           null and undefined mean different things here. undefined is a fresh
           sale — nobody passed a time, so now IS the time. null is a caller
           that looked and found none (restoreFromBin, on a bill older than
           this column), and it must stay empty: stamping "now" would claim
           the bill was taken at the moment it was restored. */
        if (withSA) p.saved_at = (bill.savedAt === null) ? null
                               : (bill.savedAt || new Date().toISOString());
        return p;
    };
    let _withPM = true, _withSA = true;
    // Use .select() array form — NOT .single() — to avoid PGRST116 false errors
    // when RLS allows insert but restricts read-back.
    let { data: billRows, error: billErr } = await _supabase.from('bills').insert(_billRow(billNo, _withPM, _withSA)).select();
    /* The table may not have these columns yet (migration not run). Drop only
       the one the error actually names — dropping both would cost a shop that
       HAS payment_mode its payment mode just because it lacks saved_at, and
       that silently turns every credit sale into a cash one. */
    if (billErr && /column|schema cache|PGRST204/i.test(String(billErr.message || ''))) {
        const msg = String(billErr.message || '');
        if (/saved_at/i.test(msg))          _withSA = false;
        else if (/payment_mode/i.test(msg)) _withPM = false;
        else { _withSA = false; _withPM = false; }
        ({ data: billRows, error: billErr } = await _supabase.from('bills').insert(_billRow(billNo, _withPM, _withSA)).select());
        // One column named, the other still missing — drop what is left.
        if (billErr && /column|schema cache|PGRST204/i.test(String(billErr.message || ''))) {
            _withSA = false; _withPM = false;
            ({ data: billRows, error: billErr } = await _supabase.from('bills').insert(_billRow(billNo, _withPM, _withSA)).select());
        }
    }
    let billRow = billRows?.[0] || null;

    if (billErr || !billRow) {
        // Fallback: If there's a unique constraint violation, auto-generate a fallback ID
        billNo = 'MM-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random()*1000);
        let retry = await _supabase.from('bills').insert(_billRow(billNo, _withPM, _withSA)).select();

        if (retry.error || !retry.data?.[0]) {
            console.error('bill save retry failed:', retry.error);
            return { success: false, message: retry.error?.message || 'Bill insert returned no data' };
        }
        billRow = retry.data[0];
        billErr = null;
    }

    // Insert medicine line items
    const items = (bill.medicines || []).map(m => ({
        bill_id:  billRow.id,
        product:  m.product  || '',
        batch:    m.batch    || '',
        exp:      m.exp      || '',
        pack:     Number(m.pack)     || 0,
        qty:      Number(m.qty)      || 0,
        mrp:      Number(m.mrp)      || 0,
        rate:     Number(m.rate)     || 0,
        gst:      Number(m.gst)      || 0,
        discount: Number(m.discount) || 0,
        total:    Number(m.total)    || 0,
        hsn:      m.hsn || '',
    }));

    if (items.length > 0) {
        let { error: itemErr } = await _supabase.from('bill_items').insert(items);
        // bill_items may not have the pack column yet — retry without it.
        if (itemErr && /column|schema cache|PGRST204/i.test(String(itemErr.message || ''))) {
            const legacy = items.map(it => { const c = Object.assign({}, it); delete c.pack; return c; });
            ({ error: itemErr } = await _supabase.from('bill_items').insert(legacy));
        }
        if (itemErr) console.error('bill_items save:', itemErr);
    }

    return { success: true, data: { ...billRow, bill_no: billNo } };
}
async function dbDeleteBill(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteBill: no user, aborting.'); return false; }
    const { error } = await _supabase.from('bills').delete().eq('id', id).eq('user_id', user);
    return !error;
}

/* ─────────────────────────────────────────────────────
   REPORT HELPERS
───────────────────────────────────────────────────── */
async function dbGetReportData(fromDate, toDate) {
    const [bills, purchases] = await Promise.all([
        dbGetBills(fromDate, toDate),
        dbGetPurchases(fromDate, toDate),
    ]);
    return { bills, purchases };
}

/* ─────────────────────────────────────────────────────
   CORE DATA SYNC — single source of truth
   Refreshes customers, doctors, medicines, purchases AND
   bills from Supabase into localStorage in one call.

   Use this on every page instead of hand-rolling your own
   Promise.all list of what to fetch — that's exactly how the
   "sales page shows stale batch stock" bug happened: sales.html
   synced purchases but forgot bills, so its stock-per-batch math
   (purchased − sold) never saw sales made elsewhere and quietly
   showed full stock on emptied batches. One shared, tested function
   means no page can silently omit a data type again.

   Returns true if the sync completed, false if it failed (caller
   should treat existing localStorage as an acceptable fallback).
───────────────────────────────────────────────────── */
// Merge cloud customer rows over the existing local mm_customers WITHOUT losing
// a customer's credit balance. Overwriting mm_customers blindly with the cloud
// list was resetting balances — and dropping whole customers off the Khata page —
// whenever the cloud `balance` was null, 0, or stale (a balance write that never
// persisted to Supabase). That made a customer's dues collapse to just the
// latest bill on the next page load.
// Rule: keep the HIGHER of the cloud and local balance. A sync should never
// REDUCE an amount that's owed; the cloud value only wins when it's actually
// ahead (e.g. a newer credit sale made on another device). Same-device
// settlements lower both stores together, so they still take effect.
// Match by name+phone, then name-only.
function _mmMergeCustomerBalances(cloudCustomers) {
    let localList = [];
    try { localList = JSON.parse(localStorage.getItem('mm_customers') || '[]'); } catch (e) {}
    const findLocal = (c) => {
        const nm = (c.name || '').trim().toLowerCase();
        const ph = (c.phone || '').trim();
        return localList.find(l => (l.name || '').trim().toLowerCase() === nm && (l.phone || '').trim() === ph)
            || localList.find(l => (l.name || '').trim().toLowerCase() === nm);
    };
    const merged = cloudCustomers.map(c => {
        const cloudBal = (c.balance !== null && c.balance !== undefined && c.balance !== '')
            ? (parseFloat(c.balance) || 0) : 0;
        const local = findLocal(c);
        const localBal = local ? (parseFloat(local.balance) || 0) : 0;
        return { ...c, balance: Math.max(cloudBal, localBal) };
    });
    // CRITICAL: keep customers that exist ONLY locally (their cloud write hasn't
    // landed — failed/offline). Returning just the cloud list here DELETED those
    // customers from mm_customers on every sync, which is why an older customer
    // vanished from the Khata page as soon as a newer one synced. Union, never prune.
    const cloudNames = new Set(cloudCustomers.map(c => (c.name || '').trim().toLowerCase()));
    localList.forEach(l => {
        if (!cloudNames.has((l.name || '').trim().toLowerCase())) merged.push(l);
    });
    return merged;
}

/* Supabase's { bill_no, bill_items: [...] } → the flat { billNo, medicines: [] }
   shape every page's stock, report and export logic reads.

   THIS MUST BE THE ONLY PLACE BILLS ARE SHAPED. It used to be inline in
   dbSyncCoreData while dbSyncDown wrote the RAW rows straight to mm_sales on
   login. Nothing crashed, because the two shapes use different key names and
   every reader simply skipped the raw ones — so the damage was silent: bills
   were stored TWICE, and the "preserve local-only bills" rule below could
   never delete the raw copies (they have no billNo, so they never match a
   cloud bill and always look like unsynced offline work). A shop with 70 bills
   carried 140 records for months. Same lesson as the customer merge above:
   one shared, tested shaping function — never a second hand-rolled copy. */
function _mmNormalizeBills(rows) {
    return (rows || []).map(b => ({
        billNo:       b.bill_no,
        date:         b.date,
        customerName: b.customer_name || '',
        customerId:   b.customer_id != null ? b.customer_id : null,
        doctorName:   b.doctor_name   || '',
        grandTotal:   b.grand_total,
        paymentMode:  b.payment_mode || 'cash',
        medicines:    (b.bill_items || []).map(m => ({
            product:  m.product  || '',
            batch:    m.batch    || '',
            exp:      m.exp      || '',
            pack:     m.pack     || 0,
            qty:      m.qty      || 0,
            mrp:      m.mrp      || 0,
            rate:     m.rate     || 0,
            gst:      m.gst      || 0,
            discount: m.discount || 0,
            total:    m.total    || 0,
            hsn:      m.hsn      || '',
        })),
        /* The bill's real save time, NOT its date.

           This used to be `savedAt: b.date`, which destroyed the timestamp on
           every cloud round-trip: sales.html stamps a proper ISO time at save,
           and the first sync replaced it with a bare '2026-08-05'. Every
           screen that shows a bill's time then parsed that as UTC MIDNIGHT and
           printed 5:30 am — the IST offset, on every bill ever taken, looking
           entirely plausible.

           Order matters. The cloud column wins when it is there; otherwise any
           real timestamp still sitting in the local cache is kept, so a device
           that took the bill keeps the true time even before
           migrations/add_bill_saved_at.sql has been run. Failing both, it is
           left EMPTY — a bill with no known time must show no time at all
           rather than a fabricated one. */
        savedAt: b.saved_at || _mmLocalSavedAt(b.bill_no) || ''
    }));
}

/* The save time this device already knows for a bill, if it is a real
   timestamp. Date-only values are rejected on purpose: they are what the old
   `savedAt: b.date` left behind, and treating one as a time is the bug. */
function _mmLocalSavedAt(billNo) {
    const no = String(billNo || '');
    if (!no) return '';
    try {
        const list = JSON.parse(localStorage.getItem('mm_sales') || '[]');
        const hit = list.find(b => b && String(b.billNo) === no);
        const t = hit && String(hit.savedAt || '');
        return (t && t.indexOf('T') > 0) ? t : '';
    } catch (e) { return ''; }
}

async function dbSyncCoreData() {
    const user = _currentUser();
    if (!user) return false;
    try {
        // Push any stock adjustment that got stuck locally (e.g. saved before
        // the 'stock_adjustments' table existed, or while offline) BEFORE
        // fetching, so this same sync picks it up for every device right away.
        try { await dbSyncPendingStockAdjustments(); } catch (e) { console.warn('[db] pending stock adjustment retry failed:', e); }
        try { await dbSyncPendingCustomerBalances(); } catch (e) { console.warn('[db] pending customer balance retry failed:', e); }

        /* Schedule H/X drug lists. Every page's H detection reads these from
           localStorage, the wipe is deny-by-default, and only schedule-h.html
           ever refilled them — so an H sale could skip the register entirely.
           Awaited BEFORE the till can bill: sales.html gates autoFillRow on
           window.mmCoreSyncPromise, so finishing here is what makes the H chip
           light on the first row of the first bill after a login. */
        try { await _mmSyncScheduleDrugLists(); } catch (e) { console.warn('[db] schedule drug list sync failed:', e); }

        const [customers, doctors, medicines, purchases, bills, adjustments,
               finAccounts, finEntries] = await Promise.all([
            dbGetCustomers(),
            dbGetDoctors(),
            dbGetMedicines(),
            dbGetPurchases(),
            dbGetBills(),
            dbGetStockAdjustments(),
            /* Finance lives here rather than in a fetch of its own because
               every page that shows a balance reads the same cache, and a
               partial hand-rolled fetch list is how screens end up disagreeing.
               Both resolve to null (not []) when the table is missing, which
               is the signal to leave the local copy alone. */
            dbGetFinanceAccounts().catch(() => null),
            dbGetFinanceEntries().catch(() => null),
        ]);

        /* null = the table is not there yet (migration not run) — keep what is
           on the device. An empty array from a table that DOES exist is also
           left alone, matching every other store below: the shop may have
           entered figures offline and the cloud simply has not seen them. */
        /* Union-merged, not overwritten — see _mmFinMerge. A flat overwrite
           here deleted anything recorded while the cloud was unreachable.
           The account backfill loops because dbSaveFinanceAccount takes one
           account; the entry backfill takes the array in a single call. */
        _mmFinMerge('mm_finance_accounts', finAccounts,
            rows => Promise.all(rows.map(a => dbSaveFinanceAccount(a).catch(() => {}))));
        _mmFinMerge('mm_finance_entries', finEntries,
            rows => dbAddFinanceEntries(rows));

        if (customers && customers.length) localStorage.setItem('mm_customers', JSON.stringify(_mmMergeCustomerBalances(customers)));
        if (doctors && doctors.length)     localStorage.setItem('mm_doctors', JSON.stringify(_mmMergeDoctors(doctors)));
        if (medicines && medicines.length) localStorage.setItem('mm_medicine_list', JSON.stringify(medicines));
        if (purchases && purchases.length) localStorage.setItem('mm_purchases', JSON.stringify(purchases));
        if (adjustments && adjustments.length) mmLsSet('stockAdjustments', adjustments);

        if (bills && bills.length) {
            const normalized = _mmNormalizeBills(bills);
            const cloudBillNos  = new Set(normalized.map(b => b.billNo));
            const existingLocal = JSON.parse(localStorage.getItem('mm_sales') || '[]');

            /* WHICH LOCAL BILLS SURVIVE A SYNC — and why this is not a guess.

               This used to keep every local bill the cloud did not have, on the
               reasoning that it must be offline work waiting to upload. But a
               bill that was DELETED on the server looks exactly the same:
               present locally, absent in the cloud. So it was preserved, every
               sync, for ever. Deleting a bill appeared to work and the bill
               came back — still counted in stock, the P&L, GSTR-1 and Tally.
               Found in testing when five duplicate bills refused to die.

               Offline bills are not a guess: sales.html queues them under
               mm_<user>_pending_sales when the save fails, and
               dbSyncPendingOfflineData() uploads them from there. So THAT is
               the authority. Local-but-not-in-cloud AND not in the queue means
               deleted, and it goes. */
            const pendingNos = new Set();
            try {
                [`mm_${user}_pending_sales`, 'mm_pending_sales'].forEach(k => {
                    (JSON.parse(localStorage.getItem(k) || '[]') || []).forEach(b => {
                        const no = b && (b.billNo || b.bill_no);
                        if (no) pendingNos.add(no);
                    });
                });
            } catch (e) {}

            const localOnly = existingLocal.filter(b =>
                b && b.billNo && !cloudBillNos.has(b.billNo) && pendingNos.has(b.billNo));
            const removed = existingLocal.filter(b =>
                b && b.billNo && !cloudBillNos.has(b.billNo) && !pendingNos.has(b.billNo)).length;
            if (removed > 0) console.log('[Sync] dropped', removed, 'bill(s) deleted on the server');
            localStorage.setItem('mm_sales', JSON.stringify([...normalized, ...localOnly]));
        }

        return true;
    } catch (e) {
        console.warn('[db] dbSyncCoreData failed, keeping existing localStorage:', e);
        return false;
    }
}
window.dbSyncCoreData = dbSyncCoreData;

/* ─────────────────────────────────────────────────────
   STOCK CALCULATION — single source of truth
   current stock = purchased − sold + manual adjustments

   Every page that needs "how much of X (optionally batch Y)
   do we have" MUST call this instead of writing its own
   purchased-minus-sold formula. That duplication is exactly
   how sales.html and inventory.html disagreed: inventory's
   "Adjust Stock" feature corrected the number there, but
   sales.html had its own separate copy of the math that had
   never heard of adjustments and kept showing the raw
   purchased-minus-sold figure. One formula, used everywhere,
   means a correction made anywhere is seen everywhere.

   batchNo omitted/empty → whole-product total.
───────────────────────────────────────────────────── */
// Shared helper: builds per-batch (purchased - sold + batch-specific
// adjustment) for a product, plus the total from "whole product" (no batch)
// adjustments. Whole-product adjustments get attributed to whichever single
// batch actually holds the stock (the "dominant" batch) — if there's more
// than one batch genuinely holding stock, attributing to just one would be
// a guess, so it's left aggregate-only in that case (matches how
// inventory.html's table treats it too — keep both in sync if this changes).
function _mmBatchBreakdown(name) {
    const purchases = JSON.parse(localStorage.getItem('mm_purchases') || '[]');
    const sales      = JSON.parse(localStorage.getItem('mm_sales') || '[]');
    const adjustments = (typeof mmLsGet === 'function') ? (mmLsGet('stockAdjustments') || []) : [];

    // Per-batch purchase totals + expiry, so untagged sales can fall back to
    // FIFO (oldest-expiry batch depletes first) — same algorithm as
    // inventory.html/report.html's buildStockData(). Must stay in sync with
    // those or Sales and Inventory will disagree on a batch's stock again.
    const batchMap = {}; // batchKeyLower -> { batch, exp, totalIn, current }
    purchases.forEach(p => {
        const pName = (p.productName || p.product_name || '').trim().toLowerCase();
        if (pName !== name) return;
        const pBatch = (p.batchNo || p.batch_no || '').trim();
        const exp  = String(p.expireDate || p.expire_date || '');
        const qty  = parseFloat(p.quantity) || 0;
        const pack = parseFloat(p.pack) || 1;
        const bk = (pBatch || '_no_batch_').toLowerCase();
        if (!batchMap[bk]) batchMap[bk] = { batch: pBatch, exp, totalIn: 0, current: 0 };
        batchMap[bk].totalIn += qty * pack;
        if (exp && exp > (batchMap[bk].exp || '')) batchMap[bk].exp = exp;
    });

    // Sales: total qty sold (out) plus qty tagged to a specific batch.
    let out = 0;
    const taggedForProduct = {}; // batchKeyLower -> tagged qty
    sales.forEach(s => {
        (s.medicines || []).forEach(m => {
            const mName = (m.product || '').trim().toLowerCase();
            if (mName !== name) return;
            const qty = parseFloat(m.qty) || 0;
            out += qty;
            const mBatch = (m.batch || '').trim().toLowerCase();
            if (mBatch) taggedForProduct[mBatch] = (taggedForProduct[mBatch] || 0) + qty;
        });
    });

    // Deduct sales tagged to a specific batch first (what the cashier actually
    // picked); untagged sales fall back to FIFO across the remaining batches.
    const batches = Object.values(batchMap).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
    let taggedAccounted = 0;
    batches.forEach(b => {
        const bk = (b.batch || '_no_batch_').toLowerCase();
        const tagged = Math.min(b.totalIn, taggedForProduct[bk] || 0);
        b.current = b.totalIn - tagged;
        taggedAccounted += tagged;
    });
    let remaining = Math.max(0, out - taggedAccounted);
    batches.forEach(b => {
        if (remaining <= 0) return;
        const deducted = Math.min(b.current, remaining);
        b.current -= deducted;
        remaining -= deducted;
    });

    const batchTotals = {}; // batchKeyLower -> remaining (purchased - sold + batch-specific adj)
    batches.forEach(b => { batchTotals[(b.batch || '').toLowerCase()] = b.current; });

    let wholeProductDelta = 0, wholeProductRows = 0;
    adjustments.forEach(a => {
        const aName = String(a.product_name || a.productName || '').trim().toLowerCase();
        if (aName !== name) return;
        const aBatch = String(a.batch_no || a.batchNo || '').trim().toLowerCase();
        const delta  = parseFloat(a.qty_delta ?? a.qtyDelta) || 0;
        if (aBatch) batchTotals[aBatch] = (batchTotals[aBatch] || 0) + delta;
        else { wholeProductDelta += delta; wholeProductRows++; }
    });

    // Which batch(es) actually hold stock? If exactly one, it's unambiguous
    // and absorbs the whole-product adjustment; if more than one, don't guess.
    const holders = Object.keys(batchTotals).filter(bk => batchTotals[bk] > 0);
    const dominantBatch = holders.length === 1 ? holders[0]
        : (Object.keys(batchTotals).length === 1 ? Object.keys(batchTotals)[0] : null);

    return { batchTotals, wholeProductDelta, wholeProductRows, dominantBatch };
}

function mmComputeStock(productName, batchNo) {
    const name = String(productName || '').trim().toLowerCase();
    if (!name) return 0;
    const batch = String(batchNo || '').trim().toLowerCase();
    const { batchTotals, wholeProductDelta, dominantBatch } = _mmBatchBreakdown(name);

    if (!batch) {
        return Object.values(batchTotals).reduce((s, v) => s + v, 0) + wholeProductDelta;
    }
    let result = batchTotals[batch] || 0;
    if (batch === dominantBatch) result += wholeProductDelta;
    return result;
}
window.mmComputeStock = mmComputeStock;

// Same math as mmComputeStock(), but returns the full breakdown instead of
// just the final number — for on-screen debugging when a stock number looks
// wrong and we need to see exactly what it's made of.
function mmComputeStockDebug(productName, batchNo) {
    const name = String(productName || '').trim().toLowerCase();
    const batch = String(batchNo || '').trim().toLowerCase();
    const { batchTotals, wholeProductDelta, wholeProductRows, dominantBatch } = _mmBatchBreakdown(name);

    const batchOnly = batchTotals[batch] || 0;
    const wholeApplies = !!batch && batch === dominantBatch && wholeProductDelta !== 0;
    const result = !batch
        ? Object.values(batchTotals).reduce((s, v) => s + v, 0) + wholeProductDelta
        : batchOnly + (wholeApplies ? wholeProductDelta : 0);

    return {
        productName, batchNo: batchNo || '(whole product)',
        batchOnlyTotal: batchOnly,
        wholeProductDelta, wholeProductRows,
        wholeProductApplied: !batch || wholeApplies,
        dominantBatch,
        pendingAdjustments: (typeof mmLsGet === 'function') ? (mmLsGet('pendingStockAdjustments') || []).length : 0,
        result
    };
}
window.mmComputeStockDebug = mmComputeStockDebug;

async function dbDeleteAllBills() {
    try {
        const user = _currentUser();
        if (!user) return { ok: false, msg: 'Not logged in.' };
        const { data: rows, error: fetchErr } = await _supabase.from('bills').select('id').eq('user_id', user);
        if (fetchErr) return { ok: false, msg: 'Fetch IDs failed: ' + fetchErr.message };
        if (!rows || rows.length === 0) return { ok: true };
        const ids = rows.map(r => r.id);
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const { error } = await _supabase.from('bills').delete().in('id', batch);
            if (error) return { ok: false, msg: 'Bills delete failed: ' + error.message };
        }
        return { ok: true };
    } catch(e) { return { ok: false, msg: e.message }; }
}

async function dbDeleteAllPurchases() {
    try {
        const user = _currentUser();
        if (!user) return { ok: false, msg: 'Not logged in.' };
        const { data: rows, error: fetchErr } = await _supabase.from('purchases').select('id').eq('user_id', user);
        if (fetchErr) return { ok: false, msg: 'Fetch IDs failed: ' + fetchErr.message }; 
        if (!rows || rows.length === 0) return { ok: true };
        const ids = rows.map(r => r.id);
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const { error } = await _supabase.from('purchases').delete().in('id', batch);
            if (error) return { ok: false, msg: 'Purchases delete failed: ' + error.message };
        }
        return { ok: true };
    } catch(e) { return { ok: false, msg: e.message }; }
}

/* ─────────────────────────────────────────────────────
   OFFLINE DATA MIGRATION
   Only migrates data scoped to the current user.
   Uses SCOPED keys (mm_{user}_sales) — never global keys.
───────────────────────────────────────────────────── */
(async function autoMigrateOfflineData() {
    const user = _currentUser();
    if (!user) return;

    const migratedKey = 'mm_offline_migrated_' + user;
    if (localStorage.getItem(migratedKey) === 'true') return;

    // CRITICAL: Only read from THIS user's scoped keys.
    // Never read global keys like 'mm_sales' — those could belong to any account.
    const rawSales     = JSON.parse(localStorage.getItem(`mm_${user}_sales`)     || '[]');
    const rawPurchases = JSON.parse(localStorage.getItem(`mm_${user}_purchases`) || '[]');

    if (rawSales.length === 0 && rawPurchases.length === 0) {
        localStorage.setItem(migratedKey, 'true');
        return;
    }

    try {
        const { count: billsCount }     = await _supabase.from('bills').select('*', { count: 'exact', head: true }).eq('user_id', user);
        const { count: purchasesCount } = await _supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('user_id', user);

        if ((billsCount || 0) === 0 && (purchasesCount || 0) === 0) {
            console.log("[Migration] Found scoped offline data. Migrating to Supabase...");
            for (const p of rawPurchases) {
                await dbAddPurchase({
                    billNo: p.billNo || p.bill_no,
                    firm: p.firm,
                    date: p.date,
                    productName: p.productName || p.product_name || p.product,
                    batchNo: p.batchNo || p.batch_no || p.batch,
                    expireDate: p.expireDate || p.expire_date || p.exp,
                    quantity: p.quantity || p.qty,
                    mrp: p.mrp,
                    rate: p.rate,
                    gst: p.gst
                });
            }
            for (const b of rawSales) {
                await dbSaveBill({
                    billNo: b.billNo || b.bill_no,
                    date: b.date,
                    customerName: b.customerName || b.customer_name,
                    doctorName: b.doctorName || b.doctor_name,
                    grandTotal: b.grandTotal || b.grand_total,
                    medicines: b.medicines || b.bill_items || []
                });
            }
            console.log("[Migration] Done.");
        }
        localStorage.setItem(migratedKey, 'true');
    } catch(e) {
        console.error("[Migration] Failed:", e);
    }
})();

/* ─────────────────────────────────────────────────────
   OFFLINE PENDING SYNC
   Syncs queued offline saves — uses SCOPED keys only.
   Returns { salesSynced, purchasesSynced } for UI feedback.
───────────────────────────────────────────────────── */
async function dbSyncPendingOfflineData() {
    const user = _currentUser();
    if (!user) return { salesSynced: 0, purchasesSynced: 0 };

    // CRITICAL: Use scoped keys — never global 'mm_pending_sales'
    const pendingSalesKey     = `mm_${user}_pending_sales`;
    const pendingPurchasesKey = `mm_${user}_pending_purchases`;
    let salesSynced = 0, purchasesSynced = 0;

    // Recover any legacy items queued under the OLD unscoped keys (older builds of
    // purchase.html wrote offline purchases to global 'mm_pending_purchases'). Fold
    // them into the scoped keys so they get synced instead of being orphaned/lost.
    try {
        [['mm_pending_sales', pendingSalesKey], ['mm_pending_purchases', pendingPurchasesKey]].forEach(([legacyKey, scopedKey]) => {
            const legacy = JSON.parse(localStorage.getItem(legacyKey) || '[]');
            if (legacy.length) {
                const cur = JSON.parse(localStorage.getItem(scopedKey) || '[]');
                localStorage.setItem(scopedKey, JSON.stringify(cur.concat(legacy)));
                localStorage.removeItem(legacyKey);
            }
        });
    } catch (e) { console.warn('[Offline Sync] legacy key migration failed:', e); }

    // Sync pending sales
    try {
        const pendingSales = JSON.parse(localStorage.getItem(pendingSalesKey) || '[]');
        if (pendingSales.length > 0) {
            console.log(`[Offline Sync] Syncing ${pendingSales.length} pending sales...`);
            let remaining = [];
            for (const bill of pendingSales) {
                const res = await dbSaveBill(bill);
                if (!res.success) {
                    console.error('[Offline Sync] Failed to sync bill:', bill.billNo, res.message);
                    remaining.push(bill);
                } else {
                    salesSynced++;
                }
            }
            localStorage.setItem(pendingSalesKey, JSON.stringify(remaining));
        }
    } catch(e) { console.error('[Offline Sync] Sales sync failed:', e); }

    // Sync pending purchases
    try {
        const pendingPurchases = JSON.parse(localStorage.getItem(pendingPurchasesKey) || '[]');
        if (pendingPurchases.length > 0) {
            console.log(`[Offline Sync] Syncing ${pendingPurchases.length} pending purchases...`);
            let remaining = [];
            for (const p of pendingPurchases) {
                const res = await dbAddPurchase(p);
                if (!res.success) {
                    console.error('[Offline Sync] Failed to sync purchase:', p.productName, res.message);
                    remaining.push(p);
                } else {
                    purchasesSynced++;
                }
            }
            localStorage.setItem(pendingPurchasesKey, JSON.stringify(remaining));
        }
    } catch(e) { console.error('[Offline Sync] Purchases sync failed:', e); }

    return { salesSynced, purchasesSynced };
}

// Expose globally for the offline banner and other pages to call
window.dbSyncPendingOfflineData = dbSyncPendingOfflineData;

// Run once on page load to catch any pending data from a previous offline session
dbSyncPendingOfflineData();


/* ─────────────────────────────────────────────────────
   SHOP PROFILE  (per-user store details for invoices)
───────────────────────────────────────────────────── */
async function dbGetShopProfile() {
    const user = _currentUser();
    if (!user) return null;
    const { data, error } = await _supabase
        .from('shop_profiles')
        .select('*')
        .eq('user_id', user)
        .maybeSingle();
    if (error) { console.error('shop profile fetch:', error); return null; }
    return data;
}

// Sets ONLY the khata credit limit (per-shop) without touching the rest of the
// profile. Needs shop_profiles.credit_limit (migrations/add_credit_limit_column.sql).
async function dbSetCreditLimit(limit) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const { error } = await _supabase.from('shop_profiles')
        .upsert({ user_id: user, credit_limit: Number(limit) || 0, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { console.error('credit limit save:', error); return { success: false, message: error.message }; }
    return { success: true };
}
window.dbSetCreditLimit = dbSetCreditLimit;

/* Opening stock — the owner's own valuation of the goods on the shelves when
   the shop started keeping records here. Written on its own, like the credit
   limit above, so saving it from the Accounts view cannot blank out a profile
   the shop set up months ago.

   The Accounts view computes opening and closing stock from the purchase
   history. That is right for a shop whose history goes back far enough, and
   too low for one that started mid-life — it was already holding goods no
   purchase record ever saw, so gross profit comes out too high. A physical
   count beats a computation over incomplete data, so this figure wins when it
   exists and the report says which one it used.
   Needs migrations/add_opening_stock.sql. */
async function dbSetOpeningStock(value, asOfDate) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const { error } = await _supabase.from('shop_profiles').upsert({
        user_id: user,
        opening_stock: Number(value) || 0,
        opening_stock_date: asOfDate || null,
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) { console.error('opening stock save:', error); return { success: false, message: error.message }; }
    try {
        localStorage.setItem('mm_opening_stock', String(Number(value) || 0));
        localStorage.setItem('mm_opening_stock_date', asOfDate || '');
    } catch (e) {}
    return { success: true };
}
window.dbSetOpeningStock = dbSetOpeningStock;

/* Reads the cached figure first so the P&L renders instantly and still works
   offline, then refreshes from the profile in the background. Never throws:
   before the migration is run this simply reports "not entered". */
async function dbSyncOpeningStock() {
    let cached = { value: 0, date: '' };
    try {
        cached.value = parseFloat(localStorage.getItem('mm_opening_stock')) || 0;
        cached.date  = localStorage.getItem('mm_opening_stock_date') || '';
    } catch (e) {}
    try {
        const p = await dbGetShopProfile();
        if (p && p.opening_stock !== undefined) {
            cached.value = Number(p.opening_stock) || 0;
            cached.date  = p.opening_stock_date || '';
            try {
                localStorage.setItem('mm_opening_stock', String(cached.value));
                localStorage.setItem('mm_opening_stock_date', cached.date);
            } catch (e) {}
        }
        /* The other two opening figures ride along on the same profile read.
           A second round trip for two numbers that arrive in the same row
           would be a request the shop pays for in latency and nothing else. */
        if (p && p.opening_debtors !== undefined) {
            try {
                localStorage.setItem('mm_opening_debtors', String(Number(p.opening_debtors) || 0));
                localStorage.setItem('mm_opening_creditors', String(Number(p.opening_creditors) || 0));
                localStorage.setItem('mm_opening_balances_date', p.opening_balances_date || '');
            } catch (e) {}
        }
    } catch (e) {}
    return cached;
}
window.dbSyncOpeningStock = dbSyncOpeningStock;

// The shop's own town + PIN, which the profile form never asked for and which
// an e-invoice cannot be built without. Written on its own — same reason as
// the credit limit above — so saving them from the e-invoice screen cannot
// blank out an address the shop set up months ago.
// Needs migrations/add_einvoice_fields.sql.
async function dbSetShopPos(city, pincode) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const { error } = await _supabase.from('shop_profiles')
        .upsert({ user_id: user, city: String(city || '').trim(),
                  pincode: String(pincode || '').trim(),
                  updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
        if (/column|schema cache|PGRST204/i.test(String(error.message || ''))) {
            return { success: false, message: 'Run migrations/add_einvoice_fields.sql in Supabase first.' };
        }
        console.error('shop pos save:', error);
        return { success: false, message: error.message };
    }
    return { success: true };
}
window.dbSetShopPos = dbSetShopPos;

/* Where each payment mode's money lands: { upi: '<accountId>', ... }.
   Written on its own for the same reason as the credit limit and the POS
   fields above — saving it from the Cash & Capital tab must not blank an
   address the shop set up months ago.

   Also updates the two LOCAL copies of the profile, because js/daybook.js
   reads the routing on its very next load and the whole point of this screen
   is that the effect is visible immediately. The profile exists in two shapes
   on one device — snake_case from the cloud row, camelCase from localStorage —
   so both are written. Needs migrations/add_payment_routing.sql. */
async function dbSetPaymentRouting(map) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const clean = {};
    Object.keys(map || {}).forEach(k => {
        const v = map[k];
        // Only a real destination is stored. A blank means "the primary till",
        // and storing '' for that would be a second way of saying the default.
        if (typeof v === 'string' && v.trim()) clean[String(k).toLowerCase()] = v.trim();
    });
    const { error } = await _supabase.from('shop_profiles')
        .upsert({ user_id: user, payment_routing: clean,
                  updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
        if (/column|schema cache|PGRST204/i.test(String(error.message || ''))) {
            return { success: false, message: 'Run migrations/add_payment_routing.sql in Supabase first.' };
        }
        console.error('payment routing save:', error);
        return { success: false, message: error.message };
    }
    try {
        if (window.mmShopProfile) {
            window.mmShopProfile.payment_routing = clean;
            window.mmShopProfile.paymentRouting  = clean;
        }
        const raw = localStorage.getItem('mm_shop_profile');
        if (raw) {
            const o = JSON.parse(raw) || {};
            o.payment_routing = clean; o.paymentRouting = clean;
            localStorage.setItem('mm_shop_profile', JSON.stringify(o));
        }
    } catch (e) { console.warn('[db] routing local update failed:', e); }
    return { success: true, routing: clean };
}
window.dbSetPaymentRouting = dbSetPaymentRouting;

async function dbSaveShopProfile(profile) {
    const user = _currentUser();
    if (!user) return { success: false, message: 'Not logged in.' };
    const { error } = await _supabase
        .from('shop_profiles')
        .upsert({
            user_id:        user,
            shop_name:      profile.shopName      || '',
            address_line1:  profile.addressLine1  || '',
            address_line2:  profile.addressLine2  || '',
            phone:          profile.phone         || '',
            /* ⚠️ ANOTHER HAND-WRITTEN FIELD LIST. Anything absent here is
               written as blank, silently. Three were already missing and are
               added now: city and pincode (an e-invoice or e-way bill cannot be
               built without them, so a restored shop could not file), and
               linked_shop. district/state joined them with the Insights tab.
               This is the same family as restoreFromBin dropping paymentMode,
               then the khata balance, then savedAt, then customerId — add the
               column HERE whenever one is added to shop_profiles. */
            city:           profile.city          || '',
            pincode:        profile.pincode       || '',
            district:       profile.district      || '',
            state:          profile.state         || '',
            linked_shop:    profile.linkedShop    || '',
            dl_no:          profile.dlNo          || '',
            gstin:          profile.gstin         || '',
            invoice_prefix: profile.invoicePrefix || 'MM',
            terms:          profile.terms         || '',
            footer_msg:     profile.footerMsg     || '',
            updated_at:     new Date().toISOString(),
        }, { onConflict: 'user_id' });
    if (error) { console.error('shop profile save:', error); return { success: false, message: error.message }; }
    return { success: true };
}

/* ─────────────────────────────────────────
   SYNC DOWN FROM CLOUD (On Login)
───────────────────────────────────────── */
async function dbSyncDown() {
    const user = _currentUser();
    if (!user) return;
    try {
        console.log('[Sync] Fetching cloud data down to local storage...');
        const [purchases, bills, customers, doctors] = await Promise.all([
            dbGetPurchases(),
            dbGetBills(),
            dbGetCustomers(),
            dbGetDoctors()
        ]);
        
        if (purchases && purchases.length) localStorage.setItem('mm_purchases', JSON.stringify(purchases));
        // Through the SAME shaper dbSyncCoreData uses. Writing the raw rows here
        // is what doubled every shop's bill list — see _mmNormalizeBills.
        if (bills && bills.length) localStorage.setItem('mm_sales', JSON.stringify(_mmNormalizeBills(bills)));
        if (customers && customers.length) localStorage.setItem('mm_customers', JSON.stringify(_mmMergeCustomerBalances(customers)));
        if (doctors && doctors.length) localStorage.setItem('mm_doctors', JSON.stringify(_mmMergeDoctors(doctors)));

        console.log('[Sync] Cloud data restored successfully.');
    } catch(e) {
        console.error('[Sync] Failed to sync down:', e);
    }
}

// ==========================================
// PASSWORD RESET REQUESTS
// ==========================================
// Handled entirely by the mm-admin Edge Function now — see mmAdminCall() in
// js/auth.js ('reset_request' / 'reset_complete', and the sa_* actions for the
// superadmin side). The old dbCreatePasswordResetRequest / dbGetPendingResetRequests /
// dbUpdateResetRequest / dbCheckResetPin / dbMarkResetCompleted helpers were
// removed: password_reset_requests holds plaintext PINs, so browsers no longer
// have any grant on that table and these calls would only 401.
