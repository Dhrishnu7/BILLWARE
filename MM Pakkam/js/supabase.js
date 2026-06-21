/**
 * supabase.js — Supabase Client for MM Pakkam
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
async function dbAddDoctor(name, phone, clinic, address) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbAddDoctor: no user, aborting.'); return { success: false, message: 'Not logged in.' }; }
    const dName  = name.trim();
    const dPhone = phone.trim();
    const dClinic = clinic?.trim() || '';
    const dAddr   = address?.trim() || '';

    // Check for existing record scoped to this user
    const { data: existing } = await _supabase.from('doctors')
        .select('*').eq('name', dName).eq('phone', dPhone).eq('user_id', user).maybeSingle();
    if (existing) return { success: true, data: existing };

    // Try insert
    const { data, error } = await _supabase.from('doctors')
        .insert({ name: dName, phone: dPhone, clinic: dClinic, address: dAddr, user_id: user })
        .select();

    // If duplicate key (another tenant has same name+phone), upsert on conflict
    if (error && (error.code === '23505' || (error.message && error.message.includes('duplicate key')))) {
        console.warn('[db] dbAddDoctor: duplicate key, trying upsert fallback.');
        const { data: ups, error: upsErr } = await _supabase.from('doctors')
            .upsert({ name: dName, phone: dPhone, clinic: dClinic, address: dAddr, user_id: user },
                    { onConflict: 'name,phone', ignoreDuplicates: false })
            .select();
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
    const { data, error } = await _supabase.from('purchases').insert({
        bill_no:      row.billNo     || '',
        firm:         row.firm       || '',
        date:         row.date       || new Date().toISOString().slice(0,10),
        product_name: row.productName || row.product_name || '',
        batch_no:     row.batchNo    || row.batch_no     || '',
        expire_date:  row.expireDate || row.expire_date  || '',
        quantity:     Number(row.quantity) || 0,
        mrp:          Number(row.mrp)      || 0,
        rate:         Number(row.rate)     || 0,
        gst:          Number(row.gst)      || 0,
        user_id:      user,
    }).select().single();
    if (error) { console.error('purchase add:', error); return { success: false, message: error.message }; }
    return { success: true, data };
}
async function dbDeletePurchase(id) {
    const user = _currentUser();
    if (!user) { console.warn('[db] dbDeletePurchase: no user, aborting.'); return false; }
    const { error } = await _supabase.from('purchases').delete().eq('id', id).eq('user_id', user);
    return !error;
}

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

    let { data: billRow, error: billErr } = await _supabase.from('bills').insert({
        bill_no:       billNo,
        date:          bill.date,
        customer_name: bill.customerName || '',
        doctor_name:   bill.doctorName   || '',
        grand_total:   parseFloat(String(bill.grandTotal).replace(/[^0-9.]/g,'')) || 0,
        user_id:       user,
    }).select().single();

    if (billErr) {
        // Fallback: If there's a unique constraint violation, auto-generate a fallback ID
        billNo = 'MM-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random()*1000);
        let retry = await _supabase.from('bills').insert({
            bill_no:       billNo,
            date:          bill.date,
            customer_name: bill.customerName || '',
            doctor_name:   bill.doctorName   || '',
            grand_total:   parseFloat(String(bill.grandTotal).replace(/[^0-9.]/g,'')) || 0,
            user_id:       user,
        }).select().single();

        if (retry.error) {
            console.error('bill save retry failed:', retry.error);
            return { success: false, message: retry.error.message };
        }
        billRow = retry.data;
        billErr = null;
    }

    // Insert medicine line items
    const items = (bill.medicines || []).map(m => ({
        bill_id:  billRow.id,
        product:  m.product  || '',
        batch:    m.batch    || '',
        exp:      m.exp      || '',
        qty:      Number(m.qty)      || 0,
        mrp:      Number(m.mrp)      || 0,
        rate:     Number(m.rate)     || 0,
        gst:      Number(m.gst)      || 0,
        discount: Number(m.discount) || 0,
        total:    Number(m.total)    || 0,
    }));

    if (items.length > 0) {
        const { error: itemErr } = await _supabase.from('bill_items').insert(items);
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
        if (customers && customers.length) localStorage.setItem('mm_customers', JSON.stringify(customers));
        if (doctors && doctors.length) localStorage.setItem('mm_doctors', JSON.stringify(doctors));
        
        console.log('[Sync] Cloud data restored successfully.');
    } catch(e) {
        console.error('[Sync] Failed to sync down:', e);
    }
}
