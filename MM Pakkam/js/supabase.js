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
async function dbAddCustomer(name, phone, address) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddCustomer: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const cName  = name.trim();
    const cPhone = phone.trim();
    const cAddr  = address?.trim() || '';

    // Check for existing record scoped to this user
    const { data: existing } = await _supabase.from('customers')
        .select('*').eq('name', cName).eq('phone', cPhone).eq('user_id', user).maybeSingle();
    if (existing) return { success: true, data: existing };

    // Try insert
    const { data, error } = await _supabase.from('customers')
        .insert({ name: cName, phone: cPhone, address: cAddr, user_id: user })
        .select();

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
async function dbDeleteCustomer(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteCustomer: no user, aborting.'); return false; }
    const { error } = await _supabase.from('customers').delete().eq('id', id).eq('user_id', user);
    return !error;
}

/* Upsert customer balance for Khata tracking */
async function dbUpdateCustomerBalance(name, phone, address, balance) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbUpdateCustomerBalance: no user, aborting.'); return { success: false }; }
    const cName  = (name || '').trim();
    const cPhone = (phone || '').trim();
    const cAddr  = (address || '').trim();
    const cBal   = parseFloat(balance) || 0;

    // Try to find existing customer. Uses .limit(1) instead of .maybeSingle()
    // because .maybeSingle() errors out (returning null data) if more than one
    // row matches the name — which silently fell through to the "create new"
    // branch below and inserted a duplicate customer instead of adding to the
    // existing balance, making a second credit sale to the same customer look
    // like it never reached the Khata page.
    const { data: existingRows, error: findErr } = await _supabase.from('customers')
        .select('*').eq('name', cName).eq('user_id', user).order('id', { ascending: true }).limit(1);
    if (findErr) { console.error('customer lookup:', findErr); return { success: false }; }
    const existing = existingRows?.[0] || null;

    if (existing) {
        // Update balance (add to existing outstanding)
        const newBal = (parseFloat(existing.balance) || 0) + cBal;
        const { error } = await _supabase.from('customers')
            .update({ balance: newBal })
            .eq('id', existing.id).eq('user_id', user);
        if (error) { console.error('balance update:', error); return { success: false }; }
        return { success: true };
    } else {
        // Create new customer with balance
        const { error } = await _supabase.from('customers')
            .insert({ name: cName, phone: cPhone, address: cAddr, balance: cBal, user_id: user });
        if (error) { console.error('customer insert with balance:', error); return { success: false }; }
        return { success: true };
    }
}

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
            const res = await dbUpdateCustomerBalance(record.name, record.phone, record.address, record.balance);
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

async function dbDeleteScheduleHDrug(name) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeleteScheduleHDrug: no user, aborting.'); return false; }
    const { error } = await _supabase.from('schedule_h_drugs')
        .delete().eq('user_id', user).eq('name', (name || '').trim());
    if (error) { console.error('schedule_h drug delete:', error); return false; }
    return true;
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
   photo to a Storage bucket and keep only its URL in image_data.
   Path is deterministic (`<tenant>/<rx_id>.jpg`) so re-saves overwrite
   cleanly and deletes are easy. Everything is best-effort: if the
   bucket isn't set up yet or the upload fails, callers fall back to the
   old inline-base64 behaviour, so nothing ever breaks. */
const RX_BUCKET = 'prescriptions';

// Upload a base64 JPEG data URL → returns a public URL, or null on any failure.
async function dbUploadPrescriptionImage(rxId, dataUrl) {
    try {
        const user = _currentUser();
        if (!user || !_supabase || !rxId) return null;
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${user}/${rxId}.jpg`;
        const { error } = await _supabase.storage.from(RX_BUCKET)
            .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error) { console.warn('[db] rx image upload failed:', error.message); return null; }
        const { data } = _supabase.storage.from(RX_BUCKET).getPublicUrl(path);
        return (data && data.publicUrl) || null;
    } catch (e) { console.warn('[db] rx image upload error:', e); return null; }
}
window.dbUploadPrescriptionImage = dbUploadPrescriptionImage;

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
async function dbSyncPendingStockAdjustments() {
    const user = _currentUser();
    if (!user) return 0;

    const pending  = (typeof mmLsGet === 'function') ? (mmLsGet('pendingStockAdjustments') || []) : [];
    const mainCache = (typeof mmLsGet === 'function') ? (mmLsGet('stockAdjustments') || []) : [];
    const legacyUnsynced = mainCache.filter(a => !a.id);

    if (!pending.length && !legacyUnsynced.length) return 0;

    let syncedCount = 0;
    const stillPending = [];
    for (const record of pending) {
        try {
            const res = await dbAddStockAdjustment(record);
            if (res && res.success) syncedCount++;
            else stillPending.push(record);
        } catch (e) {
            stillPending.push(record);
        }
    }
    if (typeof mmLsSet === 'function') mmLsSet('pendingStockAdjustments', stillPending);

    for (const legacy of legacyUnsynced) {
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
            if (res && res.success) syncedCount++;
        } catch (e) { /* will retry again next load */ }
    }

    return syncedCount;
}
window.dbSyncPendingStockAdjustments = dbSyncPendingStockAdjustments;

/* ─────────────────────────────────────────────────────
   BILLS  (sales)
───────────────────────────────────────────────────── */
async function dbNextBillNo() {
    const user = _currentUser();
    if (!user) return 'MM-001';
    // Count this user's existing bills to generate next number
    const { count } = await _supabase
        .from('bills')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user);
    // Use shop profile invoice prefix if available, fallback to 'MM'
    const prefix = window.mmShopProfile?.invoice_prefix || 'MM';
    return prefix + '-' + String((count || 0) + 1).padStart(3, '0');
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
async function dbSaveBill(bill) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbSaveBill: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    let billNo = bill.billNo || await dbNextBillNo();

    // payment_mode preserves Cash/Credit across the cloud round-trip. Built as a
    // helper so we can drop it and retry if the column isn't there yet (pre-migration).
    const _billRow = (no, withPM) => {
        const p = {
            bill_no:       no,
            date:          bill.date,
            customer_name: bill.customerName || '',
            doctor_name:   bill.doctorName   || '',
            grand_total:   parseFloat(String(bill.grandTotal).replace(/[^0-9.]/g,'')) || 0,
            user_id:       user,
        };
        if (withPM) p.payment_mode = bill.paymentMode || 'cash';
        return p;
    };
    let _withPM = true;
    // Use .select() array form — NOT .single() — to avoid PGRST116 false errors
    // when RLS allows insert but restricts read-back.
    let { data: billRows, error: billErr } = await _supabase.from('bills').insert(_billRow(billNo, _withPM)).select();
    // Table may not have payment_mode yet (migration not run) — retry without it.
    if (billErr && /column|schema cache|PGRST204/i.test(String(billErr.message || ''))) {
        _withPM = false;
        ({ data: billRows, error: billErr } = await _supabase.from('bills').insert(_billRow(billNo, _withPM)).select());
    }
    let billRow = billRows?.[0] || null;

    if (billErr || !billRow) {
        // Fallback: If there's a unique constraint violation, auto-generate a fallback ID
        billNo = 'MM-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random()*1000);
        let retry = await _supabase.from('bills').insert(_billRow(billNo, _withPM)).select();

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

async function dbSyncCoreData() {
    const user = _currentUser();
    if (!user) return false;
    try {
        // Push any stock adjustment that got stuck locally (e.g. saved before
        // the 'stock_adjustments' table existed, or while offline) BEFORE
        // fetching, so this same sync picks it up for every device right away.
        try { await dbSyncPendingStockAdjustments(); } catch (e) { console.warn('[db] pending stock adjustment retry failed:', e); }
        try { await dbSyncPendingCustomerBalances(); } catch (e) { console.warn('[db] pending customer balance retry failed:', e); }

        const [customers, doctors, medicines, purchases, bills, adjustments] = await Promise.all([
            dbGetCustomers(),
            dbGetDoctors(),
            dbGetMedicines(),
            dbGetPurchases(),
            dbGetBills(),
            dbGetStockAdjustments(),
        ]);

        if (customers && customers.length) localStorage.setItem('mm_customers', JSON.stringify(_mmMergeCustomerBalances(customers)));
        if (doctors && doctors.length)     localStorage.setItem('mm_doctors', JSON.stringify(doctors));
        if (medicines && medicines.length) localStorage.setItem('mm_medicine_list', JSON.stringify(medicines));
        if (purchases && purchases.length) localStorage.setItem('mm_purchases', JSON.stringify(purchases));
        if (adjustments && adjustments.length) mmLsSet('stockAdjustments', adjustments);

        if (bills && bills.length) {
            // Normalize Supabase's { bill_items: [...] } shape into the
            // flat { medicines: [...] } shape every page's stock/name logic expects.
            const normalized = bills.map(b => ({
                billNo:       b.bill_no,
                date:         b.date,
                customerName: b.customer_name || '',
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
                savedAt: b.date
            }));
            // Preserve any bill saved locally that hasn't reached the cloud yet
            // (offline/pending sync) — the cloud copy wins once it exists.
            const cloudBillNos  = new Set(normalized.map(b => b.billNo));
            const existingLocal = JSON.parse(localStorage.getItem('mm_sales') || '[]');
            const localOnly     = existingLocal.filter(b => !cloudBillNos.has(b.billNo));
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
        if (bills && bills.length) localStorage.setItem('mm_sales', JSON.stringify(bills));
        if (customers && customers.length) localStorage.setItem('mm_customers', JSON.stringify(_mmMergeCustomerBalances(customers)));
        if (doctors && doctors.length) localStorage.setItem('mm_doctors', JSON.stringify(doctors));
        
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
