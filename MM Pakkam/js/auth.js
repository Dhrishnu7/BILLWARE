/**
 * auth.js — Billware Authentication Module
 * Users stored in Supabase (mm_users table) — works across ALL devices and deployments.
 * Session stored in localStorage/sessionStorage (device-specific by design).
 */

/* ─────────────────────────────────────────
   Pure-JS SHA-256  (works on file://, http://, https://)
───────────────────────────────────────────*/
function _sha256(str) {
    function safe_add(x, y) {
        var lsw = (x & 0xFFFF) + (y & 0xFFFF);
        var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    }
    function S(X, n) { return (X >>> n) | (X << (32 - n)); }
    function R(X, n) { return (X >>> n); }
    function Ch(x, y, z) { return ((x & y) ^ ((~x) & z)); }
    function Maj(x, y, z) { return ((x & y) ^ (x & z) ^ (y & z)); }
    function Sigma0(x) { return (S(x, 2) ^ S(x, 13) ^ S(x, 22)); }
    function Sigma1(x) { return (S(x, 6) ^ S(x, 11) ^ S(x, 25)); }
    function Gamma0(x) { return (S(x, 7) ^ S(x, 18) ^ R(x, 3)); }
    function Gamma1(x) { return (S(x, 17) ^ S(x, 19) ^ R(x, 10)); }

    var K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    var bytes = [];
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 128) { bytes.push(c); }
        else if (c < 2048) { bytes.push((c >> 6) | 192, (c & 63) | 128); }
        else { bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128); }
    }
    var l = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push(0,0,0,0, (l>>>24)&0xFF, (l>>>16)&0xFF, (l>>>8)&0xFF, l&0xFF);

    var W = [], H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    for (var b = 0; b < bytes.length; b += 64) {
        for (var j = 0; j < 16; j++)
            W[j] = (bytes[b+j*4]<<24)|(bytes[b+j*4+1]<<16)|(bytes[b+j*4+2]<<8)|bytes[b+j*4+3];
        for (var j = 16; j < 64; j++)
            W[j] = safe_add(safe_add(Gamma1(W[j-2]), W[j-7]), safe_add(Gamma0(W[j-15]), W[j-16]));
        var a=H[0],bh=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for (var j = 0; j < 64; j++) {
            var T1 = safe_add(safe_add(safe_add(safe_add(h,Sigma1(e)),Ch(e,f,g)),K[j]),W[j]);
            var T2 = safe_add(Sigma0(a),Maj(a,bh,c));
            h=g; g=f; f=e; e=safe_add(d,T1); d=c; c=bh; bh=a; a=safe_add(T1,T2);
        }
        H[0]=safe_add(a,H[0]); H[1]=safe_add(bh,H[1]); H[2]=safe_add(c,H[2]); H[3]=safe_add(d,H[3]);
        H[4]=safe_add(e,H[4]); H[5]=safe_add(f,H[5]); H[6]=safe_add(g,H[6]); H[7]=safe_add(h,H[7]);
    }
    return H.map(n => (n >>> 0).toString(16).padStart(8,'0')).join('');
}

/* ─────────────────────────────────────────
   Supabase Config (same project as supabase.js)
───────────────────────────────────────────*/
const _AUTH_SUPABASE_URL = 'https://jwyyjdwlbgjijmwillow.supabase.co';
const _AUTH_SUPABASE_KEY = 'sb_publishable_sY9QwFEMckky9KDJoc1O_w_zN7qY0mo';
const MM_SESSION_KEY  = 'mm_auth_session';
const MM_REMEMBER_KEY = 'mm_auth_remember';

// Lazy Supabase client — returns existing _supabase global or creates a new one
function _authDB() {
    if (typeof _supabase !== 'undefined' && _supabase) return _supabase;
    if (typeof supabase !== 'undefined' && supabase && supabase.createClient) {
        return supabase.createClient(_AUTH_SUPABASE_URL, _AUTH_SUPABASE_KEY);
    }
    return null;
}

/* ─────────────────────────────────────────
   Password Hashing
───────────────────────────────────────────*/
async function mmHashPassword(password) {
    return _sha256(password);
}

/* ─────────────────────────────────────────
   User Store — Supabase (mm_users table)
   Falls back to localStorage if Supabase unavailable.
───────────────────────────────────────────*/

// localStorage fallback helpers
function _localGetUsers() {
    try { return JSON.parse(localStorage.getItem('mm_auth_users') || '[]'); }
    catch { return []; }
}
function _localSaveUsers(users) {
    try { localStorage.setItem('mm_auth_users', JSON.stringify(users)); } catch {}
}

async function mmGetUsers() {
    const db = _authDB();
    if (db) {
        try {
            const { data, error } = await db.from('mm_users').select('*');
            if (!error && data) {
                // ⚠️ IMPORTANT: Supabase is the ONLY source of truth when reachable.
                // DO NOT merge local users — deleted accounts must stay deleted.
                // Simply update local cache to match the DB exactly.
                _localSaveUsers(data);
                return data;
            }
            console.warn('[auth] Supabase mm_users fetch failed:', error?.message || error);
        } catch (e) {
            console.warn('[auth] Supabase unreachable, using localStorage:', e.message);
        }
    }
    // Only use localStorage when Supabase is completely unreachable (offline)
    return _localGetUsers();
}

async function mmHasUsers() {
    const users = await mmGetUsers();
    return users.length > 0;
}

// Upsert a single user record to Supabase (and localStorage as backup)
async function _saveUser(userObj) {
    // Build a stable composite id so two stores can have the same username
    if (!userObj.id) {
        const tid = userObj.tenant_id || userObj.username;
        userObj.id = tid + ':' + userObj.username;
    }
    const db = _authDB();
    if (db) {
        try {
            // Strategy 1: upsert on composite 'id' (preferred)
            const { error: e1 } = await db.from('mm_users')
                .upsert({ ...userObj }, { onConflict: 'id' });
            if (!e1) {
                _syncLocal(userObj);
                return true;
            }
            console.warn('[auth] upsert(id) failed:', e1.message, '— trying upsert(username)');

            // Strategy 2: upsert on 'username' (old DB schema)
            const { error: e2 } = await db.from('mm_users')
                .upsert({ ...userObj }, { onConflict: 'username' });
            if (!e2) {
                _syncLocal(userObj);
                return true;
            }
            console.warn('[auth] upsert(username) failed:', e2.message, '— trying insert');

            // Strategy 3: plain insert (handles case where row doesn't exist yet)
            const { error: e3 } = await db.from('mm_users').insert({ ...userObj });
            if (!e3) {
                _syncLocal(userObj);
                return true;
            }
            console.warn('[auth] insert failed:', e3.message, '— saving to localStorage only');
        } catch (e) {
            console.warn('[auth] Supabase save error:', e.message);
        }
    }
    // localStorage fallback
    _syncLocal(userObj);
    return false;
}

function _syncLocal(userObj) {
    const local = _localGetUsers();
    const idx = local.findIndex(u => u.id === userObj.id ||
        u.username.toLowerCase() === userObj.username.toLowerCase() &&
        (u.tenant_id || u.username) === (userObj.tenant_id || userObj.username));
    if (idx >= 0) local[idx] = userObj; else local.push(userObj);
    _localSaveUsers(local);
}

async function _deleteUser(username, tenantId) {
    // Build the stable id to target the exact record
    const tid = tenantId || username;
    const id  = tid + ':' + username;
    const db = _authDB();
    if (db) {
        try {
            // Try to delete by id first (new format)
            await db.from('mm_users').delete().eq('id', id);
            // Also delete any old-format record matching just username (migration cleanup)
            await db.from('mm_users').delete().eq('username', username).eq('tenant_id', tid);
        } catch {}
    }
    _localSaveUsers(_localGetUsers().filter(u => u.id !== id && u.username.toLowerCase() !== username.toLowerCase()));
}

/* ─────────────────────────────────────────
   Session  (always localStorage/sessionStorage — per-device by design)
───────────────────────────────────────────*/
function mmGetSession() {
    const remember = localStorage.getItem(MM_REMEMBER_KEY) === 'true';
    const raw = remember
        ? localStorage.getItem(MM_SESSION_KEY)
        : sessionStorage.getItem(MM_SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
}

function mmSaveSession(user, remember) {
    // tenant_id: for owners it's their own username; for workers it's their owner's username
    const session = {
        username:  user.username,
        role:      user.role,
        tenant_id: user.tenant_id || user.username,  // owners are their own tenant
        token:     user.token, // Store active session token
        loginTime: Date.now()
    };
    if (remember) {
        localStorage.setItem(MM_REMEMBER_KEY, 'true');
        localStorage.setItem(MM_SESSION_KEY, JSON.stringify(session));
    } else {
        localStorage.removeItem(MM_REMEMBER_KEY);
        sessionStorage.setItem(MM_SESSION_KEY, JSON.stringify(session));
    }
}

function mmClearSession() {
    sessionStorage.removeItem(MM_SESSION_KEY);
    localStorage.removeItem(MM_SESSION_KEY);
    localStorage.removeItem(MM_REMEMBER_KEY);

    // Clear all offline business data to prevent data leakage across accounts
    const keysToClear = [
        'mm_purchases', 'mm_sales', 'mm_customers', 'mm_doctors', 
        'mm_pending_purchases', 'mm_pending_sales', 'report_bin', 
        'mm_schedule_h_register', 'mm_schedule_h_drugs', 'mm_medicines'
    ];
    keysToClear.forEach(k => localStorage.removeItem(k));
}

/* ─────────────────────────────────────────
   Auth Guards  (async — await on each page)
───────────────────────────────────────────*/

/**
 * Redirect to login.html if not logged in.
 * Returns the current session object if logged in.
 */
async function mmRequireAuth() {
    const session = mmGetSession();
    if (!session) {
        if (!window.location.pathname.endsWith('login.html') &&
            !window.location.pathname.endsWith('setup.html')) {
            // Check if any users exist; if not, send to setup
            const hasUsers = await mmHasUsers();
            window.location.replace(hasUsers ? 'login.html' : 'setup.html');
        }
        return null;
    }

    // Validate the token on page load
    await _validateSession(session);
    
    // Auto-migrate legacy data in background
    _autoMigrateLocalDataToSupabase(session);

    // Load shop profile for dynamic branding (non-blocking)
    window.mmShopProfile = null;
    if (typeof dbGetShopProfile === 'function') {
        try { window.mmShopProfile = await dbGetShopProfile(); } catch(e) {}
    }
    // Apply shop branding to this page
    mmInjectShopBranding();
    
    // Start background monitor (every 10s)
    if (!window._mmSessionMonitor) {
        window._mmSessionMonitor = setInterval(async () => {
            const currentSession = mmGetSession();
            if (currentSession) await _validateSession(currentSession);
        }, 10000);
    }

    return session;
}

/**
 * Dynamically update the navbar logo and page title with the shop's own branding.
 * Falls back to 'Billware' for accounts without a shop profile.
 */
function mmInjectShopBranding() {
    const profile = window.mmShopProfile;
    const shopName = profile?.shop_name || 'Billware';
    // Build initials from first 2 words
    const initials = shopName.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'BW';

    // Update navbar logo icon (the short 2-letter badge)
    // const logoIcon = document.querySelector('.logo-icon');
    // if (logoIcon) logoIcon.textContent = initials;

    // Update navbar logo full name
    const logoText = document.querySelector('.logo-text');
    if (logoText) logoText.textContent = shopName;

    // Update browser tab title
    const currentTitle = document.title;
    if (currentTitle.includes('|')) {
        const pageSection = currentTitle.split('|')[0].trim();
        document.title = pageSection + ' | ' + shopName;
    } else {
        document.title = shopName;
    }
}

// Helper to check DB and force logout if account was deleted, rejected, or token changed
async function _validateSession(session) {
    try {
        const db = _authDB();
        if (!db) return; // No Supabase — offline, don't log out

        // Fetch directly from Supabase (not localStorage fallback) to get true DB state
        const { data: users, error } = await db.from('mm_users').select('*');
        if (error || !users) return; // Supabase error — don't accidentally log out

        // If Supabase returned data but user is NOT found → account was DELETED
        const tenantId = session.tenant_id || session.username;
        const dbUser = users.find(u =>
            u.username === session.username &&
            ((u.tenant_id || u.username) === tenantId)
        );

        if (!dbUser) {
            // Account deleted from admin portal — force logout immediately
            mmClearSession();
            alert('⚠️ Your account has been removed. You have been signed out.');
            window.location.replace('login.html');
            return;
        }

        // Account exists but was rejected after login
        if (dbUser.approval_status === 'rejected') {
            mmClearSession();
            alert('❌ Your account has been rejected by the administrator. You have been signed out.');
            window.location.replace('login.html');
            return;
        }

        // Another device forcefully logged in — token mismatch
        if (dbUser.active_session_token && (!session.token || dbUser.active_session_token !== session.token)) {
            mmClearSession();
            alert('📱 You have been logged out because this account was signed in from another device.');
            window.location.replace('login.html');
        }
    } catch(e) {
        // Ignore network errors — never log out offline users accidentally
    }
}

/**
 * Redirect to index.html if logged-in user is not the owner.
 */
async function mmRequireOwner() {
    const session = await mmRequireAuth();
    if (session && session.role !== 'owner') {
        window.location.replace('index.html');
        return null;
    }
    return session;
}

/* ─────────────────────────────────────────
   Public API
───────────────────────────────────────────*/

/** Returns { username, role } of current user, or null */
function mmCurrentUser() {
    return mmGetSession();
}

/** Login. Returns { success, message, forceRequired } */
// Establishes a real Supabase Auth session via the mm-login Edge Function so
// database requests carry a verified identity (required for tenant-isolation RLS).
// Best-effort & additive: any failure is swallowed and the legacy login still works.
async function _mmEstablishAuthSession(username, password) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(`${_AUTH_SUPABASE_URL}/functions/v1/mm-login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': _AUTH_SUPABASE_KEY,
                'Authorization': `Bearer ${_AUTH_SUPABASE_KEY}`,
            },
            body: JSON.stringify({ username, password }),
            signal: controller.signal,
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data && data.access_token && data.refresh_token) {
            const client = _authDB();
            if (client && client.auth && client.auth.setSession) {
                await client.auth.setSession({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                });
            }
            return true;
        }
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function mmLogin(username, password, remember, force = false) {
    try {
        const hash = await mmHashPassword(password);
        
        // --- STEP 1: Always check Supabase first (source of truth) ---
        const db = _authDB();
        let user = null;
        let supabaseReachable = false;

        if (db) {
            try {
                const { data, error } = await db.from('mm_users').select('*');
                if (!error && data) {
                    supabaseReachable = true;
                    // Update local cache with latest DB state
                    _localSaveUsers(data);
                    user = data.find(u =>
                        u.username.toLowerCase() === username.trim().toLowerCase() &&
                        u.passwordHash === hash
                    );
                    // If Supabase is reachable but user not found → credentials invalid or account deleted
                    if (!user) {
                        return { success: false, message: 'Invalid username or password.' };
                    }
                }
            } catch(e) {
                console.warn('[auth] Supabase unreachable during login, falling back to localStorage');
            }
        }

        // --- STEP 2: Fallback to localStorage only if Supabase is unreachable (offline) ---
        if (!supabaseReachable) {
            const localUsers = _localGetUsers();
            user = localUsers.find(u =>
                u.username.toLowerCase() === username.trim().toLowerCase() &&
                u.passwordHash === hash
            );
            if (!user) return { success: false, message: 'Invalid username or password.' };
        }

        // Check approval status
        if (user.approval_status === 'pending') {
            return { success: false, message: '⏳ Your account is pending approval. Please wait for admin confirmation before signing in.' };
        }
        if (user.approval_status === 'rejected') {
            return { success: false, message: '❌ Your account request was rejected. Please contact the administrator.' };
        }
        // Ensure tenant_id is always set (migrate old records on the fly)
        if (!user.tenant_id) user.tenant_id = user.username;


        // --- Single Device Lockout Logic ---
        if (user.active_session_token && !force) {
            // Check if the token belongs to the CURRENT device. If yes, allow.
            const existingSession = mmGetSession();
            if (!existingSession || existingSession.token !== user.active_session_token) {
                return { 
                    success: false, 
                    message: 'Account already logged in on another device.',
                    forceRequired: true 
                };
            }
        }

        // Generate new session token and save to DB
        const newToken = Date.now().toString(36) + Math.random().toString(36).substr(2);
        user.active_session_token = newToken;
        await _saveUser(user);

        user.token = newToken; // attach token to session
        mmSaveSession(user, remember);

        // ── Secure tenant session (Supabase Auth). Additive; never blocks login. ──
        try { await _mmEstablishAuthSession(username, password); }
        catch (e) { console.warn('[auth] secure session not established (using legacy):', e); }

        // Auto-migrate legacy data in background without blocking login
        _autoMigrateLocalDataToSupabase(user);
        
        return { success: true, user };
    } catch (err) {
        console.error('[auth] mmLogin error:', err);
        return { success: false, message: 'Sign-in failed. Please try again.' };
    }
}

/** Logout */
async function mmLogout() {
    const session = mmGetSession();
    if (session) {
        // Clear active session from DB
        const users = await mmGetUsers();
        const user = users.find(u => u.username === session.username && u.tenant_id === session.tenant_id);
        if (user && user.active_session_token === session.token) {
            user.active_session_token = null;
            await _saveUser(user);
        }
    }
    // Also end the Supabase Auth session (best-effort).
    try { const c = _authDB(); if (c && c.auth && c.auth.signOut) await c.auth.signOut(); } catch (e) {}
    mmClearSession();
    window.location.replace('login.html');
}

/**
 * Get all users belonging to the current store (tenant).
 * Owner accounts = global. Workers = scoped per owner (tenant_id).
 */
async function mmGetTenantUsers() {
    const session  = mmGetSession();
    const tenantId = session ? (session.tenant_id || session.username) : null;
    const all = await mmGetUsers();
    if (!tenantId) return all;
    // Return users whose tenant_id matches, OR legacy users with no tenant_id that match username
    return all.filter(u =>
        u.tenant_id === tenantId ||
        (!u.tenant_id && u.username === tenantId) // legacy owner record
    );
}

/** Create a new store owner account. Every account is fully isolated. Returns { success, message } */
async function mmCreateOwner(username, password, shopInfo = null) {
    // Owner usernames must be globally unique (needed for unambiguous login)
    const users = await mmGetUsers();
    if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
        return { success: false, message: 'This username is already taken. Please choose a different one.' };
    }
    const hash = await mmHashPassword(password);
    // tenant_id for an owner = their own username (they ARE the tenant root)
    // approval_status = 'pending' until super admin approves
    const user = { username: username.trim(), passwordHash: hash, role: 'owner', tenant_id: username.trim(), createdAt: Date.now(), approval_status: 'pending', payment_status: 'unpaid' };
    await _saveUser(user);

    if (shopInfo) {
        const db = _authDB();
        if (db) {
            await db.from('shop_profiles').upsert({
                user_id: username.trim(),
                shop_name: shopInfo.shopName,
                phone: shopInfo.phone,
                address_line1: shopInfo.addressLine1 || '',
                address_line2: shopInfo.addressLine2 || '',
                dl_no: shopInfo.dlNo || '',
                gstin: shopInfo.gstin || ''
            });
        }
    }

    return { success: true, pending: true };
}

/** Add a worker to the current owner's store. Username unique within this store only. */
async function mmAddWorker(username, password) {
    const session  = mmGetSession();
    const tenantId = session ? (session.tenant_id || session.username) : null;
    // Only check uniqueness within THIS store's users, not globally
    const tenantUsers = await mmGetTenantUsers();
    if (tenantUsers.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
        return { success: false, message: 'This username already exists in your store.' };
    }
    const hash = await mmHashPassword(password);
    await _saveUser({ username: username.trim(), passwordHash: hash, role: 'worker', tenant_id: tenantId, createdAt: Date.now() });
    return { success: true };
}

/** Add an additional owner-role user within the current store. */
async function mmAddOwner(username, password) {
    const session  = mmGetSession();
    const tenantId = session ? (session.tenant_id || session.username) : null;
    // Check uniqueness within THIS store only
    const tenantUsers = await mmGetTenantUsers();
    if (tenantUsers.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
        return { success: false, message: 'This username already exists in your store.' };
    }
    const hash = await mmHashPassword(password);
    await _saveUser({ username: username.trim(), passwordHash: hash, role: 'owner', tenant_id: tenantId, createdAt: Date.now() });
    return { success: true };
}

/** Delete a user by username (owner function) */
async function mmDeleteUser(username) {
    const session  = mmGetSession();
    const tenantId = session ? (session.tenant_id || session.username) : username;
    await _deleteUser(username, tenantId);
}

/**
 * Permanently delete the entire account:
 * - Wipes ALL Supabase data for this tenant (bills, purchases, medicines, customers, doctors)
 * - Deletes all user records (owner + workers) for this tenant from mm_users
 * - Clears all tenant-scoped localStorage keys
 * - Logs out and redirects to setup page
 * Returns { success, message }
 */
async function mmDeleteAccountPermanently() {
    const session  = mmGetSession();
    if (!session || session.role !== 'owner') return { success: false, message: 'Only the owner can delete an account.' };
    const tenantId = session.tenant_id || session.username;

    try {
        // ── 1. Delete all Supabase data for this tenant ──
        // We use direct _supabase calls (not the helper fns) to avoid re-checking user
        const db = (typeof _supabase !== 'undefined') ? _supabase : null;
        if (db) {
            // Delete bill_items first (foreign key child of bills)
            const { data: bills } = await db.from('bills').select('id').eq('user_id', tenantId);
            if (bills && bills.length > 0) {
                const billIds = bills.map(b => b.id);
                for (let i = 0; i < billIds.length; i += 100) {
                    await db.from('bill_items').delete().in('bill_id', billIds.slice(i, i+100));
                }
            }
            // Delete bills
            await db.from('bills').delete().eq('user_id', tenantId);
            // Delete purchases
            await db.from('purchases').delete().eq('user_id', tenantId);
            // Delete medicines
            await db.from('medicines').delete().eq('user_id', tenantId);
            // Delete customers
            await db.from('customers').delete().eq('user_id', tenantId);
            // Delete doctors
            await db.from('doctors').delete().eq('user_id', tenantId);
        }

        // ── 2. Delete all user accounts for this tenant ──
        const allUsers = await mmGetUsers();
        const tenantUsers = allUsers.filter(u =>
            u.tenant_id === tenantId ||
            u.username  === tenantId  // owner record (old format)
        );
        for (const u of tenantUsers) {
            await _deleteUser(u.username, tenantId);
        }

        // ── 3. Clear all localStorage keys for this tenant ──
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.includes(`_${tenantId}_`)) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        // ── 4. Clear session and redirect ──
        mmClearSession();
        return { success: true };
    } catch (err) {
        console.error('[auth] mmDeleteAccountPermanently error:', err);
        return { success: false, message: 'Something went wrong: ' + err.message };
    }
}

/** Reset a user's password. Returns { success, message } */
async function mmResetPassword(username, newPassword) {
    const users = await mmGetUsers();
    const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return { success: false, message: 'User not found.' };
    user.passwordHash = await mmHashPassword(newPassword);
    await _saveUser(user);
    return { success: true };
}

/** Rename a user. Returns { success, message } */
async function mmRenameUser(oldUsername, newUsername) {
    const users  = await mmGetUsers();
    const session = mmGetSession();
    const tenantId = session ? (session.tenant_id || session.username) : null;
    const trimmed = newUsername.trim();
    if (trimmed.length < 3) return { success: false, message: 'Username must be at least 3 characters.' };
    // Check uniqueness within the same tenant
    const tenantUsers = await mmGetTenantUsers();
    if (tenantUsers.find(u => u.username.toLowerCase() === trimmed.toLowerCase() &&
                              u.username.toLowerCase() !== oldUsername.toLowerCase())) {
        return { success: false, message: 'Username already taken in this store.' };
    }
    const user = users.find(u => u.username.toLowerCase() === oldUsername.toLowerCase() &&
                                  (u.tenant_id === tenantId || u.username === tenantId));
    if (!user) return { success: false, message: 'User not found.' };

    // Delete old record (by old id), save with new name
    await _deleteUser(oldUsername, tenantId);
    user.username = trimmed;
    user.id = (user.tenant_id || tenantId) + ':' + trimmed;  // recalc id
    await _saveUser(user);

    // Update session if renaming the currently logged-in user
    if (session && session.username.toLowerCase() === oldUsername.toLowerCase()) {
        session.username = trimmed;
        const remember = localStorage.getItem(MM_REMEMBER_KEY) === 'true';
        if (remember) localStorage.setItem(MM_SESSION_KEY, JSON.stringify(session));
        else sessionStorage.setItem(MM_SESSION_KEY, JSON.stringify(session));
    }
    return { success: true };
}

/* ─────────────────────────────────────────
   Navbar User-Info Injection
───────────────────────────────────────────*/
function mmInjectUserBar() {
    const session = mmGetSession();
    if (!session) return;

    if (!document.getElementById('mm-auth-styles')) {
        const style = document.createElement('style');
        style.id = 'mm-auth-styles';
        style.textContent = `
            .mm-user-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
            .mm-user-pill {
                display: inline-flex; align-items: center; gap: 8px;
                background: rgba(255,255,255,0.7);
                border: 1.5px solid rgba(0,0,0,0.08);
                border-radius: 50px; padding: 5px 14px 5px 6px;
                backdrop-filter: blur(10px);
            }
            .mm-avatar {
                width: 28px; height: 28px; border-radius: 50%;
                background: linear-gradient(135deg, #0ea5e9, #10b981);
                display: flex; align-items: center; justify-content: center;
                color: white; font-weight: 800; font-size: 0.75rem;
                flex-shrink: 0; letter-spacing: 0.02em;
            }
            .mm-user-name { font-size: 0.82rem; font-weight: 700; color: #0f172a; }
            .mm-role-badge {
                font-size: 0.62rem; font-weight: 800; letter-spacing: 0.06em;
                text-transform: uppercase; padding: 2px 7px; border-radius: 20px;
            }
            .mm-role-owner { background: linear-gradient(135deg,#fef3c7,#fde68a); color: #92400e; border: 1px solid #fcd34d; }
            .mm-role-worker { background: linear-gradient(135deg,#dbeafe,#bfdbfe); color: #1e40af; border: 1px solid #93c5fd; }
            .mm-manage-btn {
                display: inline-flex; align-items: center; gap: 5px;
                padding: 6px 13px; border-radius: 50px;
                border: 1.5px solid rgba(139,92,246,0.35);
                background: rgba(237,233,254,0.8);
                color: #6d28d9; font-size: 0.78rem; font-weight: 700;
                text-decoration: none; transition: all 0.22s ease; cursor: pointer;
            }
            .mm-manage-btn:hover { background: #7c3aed; color: white; border-color: #7c3aed; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,0.3); }
            .mm-logout-btn {
                display: inline-flex; align-items: center; gap: 5px;
                padding: 6px 13px; border-radius: 50px;
                border: 1.5px solid rgba(239,68,68,0.3);
                background: rgba(254,242,242,0.8);
                color: #dc2626; font-size: 0.78rem; font-weight: 700;
                cursor: pointer; transition: all 0.22s ease; font-family: 'Inter', sans-serif;
            }
            .mm-logout-btn:hover { background: #ef4444; color: white; border-color: #ef4444; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,68,68,0.3); }

            /* Give the back button breathing room away from the user bar buttons */
            .back-btn { margin-right: 12px !important; }
        `;
        document.head.appendChild(style);
    }

    const initials = session.username.slice(0, 2).toUpperCase();
    const isOwner  = session.role === 'owner';
    const shopName = window.mmShopProfile?.shop_name || 'Billware';
    const shopInitials = shopName.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() || 'BW';
    const bar = document.createElement('div');
    bar.className = 'mm-user-bar';
    bar.innerHTML = `
        ${isOwner ? `
        <a class="mm-manage-btn" href="directory.html" title="Customers & Doctors Directory" style="border-color:rgba(99,102,241,0.35);background:rgba(238,242,255,0.85);color:#4f46e5;">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-5.356-3.712M9 20H4v-2a4 4 0 015.356-3.712M15 7a4 4 0 11-8 0 4 4 0 018 0z"/>
            </svg>
            Directory
        </a>
        <a class="mm-manage-btn" href="manage-users.html" title="Manage Users">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-5.356-3.712M9 20H4v-2a4 4 0 015.356-3.712M15 7a4 4 0 11-8 0 4 4 0 018 0zm6 4a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            Users
        </a>
        <a class="mm-manage-btn" href="shop-setup.html?edit=1" title="Shop Settings" style="border-color:rgba(16,185,129,0.35);background:rgba(209,250,229,0.8);color:#065f46;">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
            Shop
        </a>` : ''}
        <div class="mm-user-pill">
            <div class="mm-avatar">${(session.username || '').trim().charAt(0).toUpperCase() || 'U'}</div>
            <span class="mm-user-name">${session.username}</span>
            <span class="mm-role-badge ${isOwner ? 'mm-role-owner' : 'mm-role-worker'}">${session.role}</span>
        </div>
        <button class="mm-logout-btn" onclick="mmShowSupportModal()" title="Customer Support" style="border-color:rgba(14,165,233,0.3);background:rgba(224,242,254,0.8);color:#0ea5e9;">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <path d="M3 11h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-4a9 9 0 0 1 18 0v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h2"/>
                <path d="M21 16v2a4 4 0 0 1-4 4h-5"/>
            </svg>
            Support
        </button>
        <button class="mm-logout-btn" onclick="mmLogout()" title="Logout">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"/>
            </svg>
            Logout
        </button>
    `;

    // Inject Support Modal
    if (!document.getElementById('mmSupportModal')) {
        const supportModalHtml = `
        <style>
            @keyframes mmModalIn { from { opacity:0; transform:translateY(18px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
            @keyframes mmOverlayIn { from { opacity:0; } to { opacity:1; } }
        </style>
        <div class="modal-overlay" id="mmSupportModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.55); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); z-index:99999; align-items:center; justify-content:center; padding:16px; animation: mmOverlayIn 0.2s ease;">
            <div style="background:#fff; border-radius:22px; width:100%; max-width:440px; box-shadow:0 30px 60px -15px rgba(2,132,199,0.4), 0 20px 40px -20px rgba(0,0,0,0.35); overflow:hidden; animation: mmModalIn 0.34s cubic-bezier(0.175, 0.885, 0.32, 1.275); font-family:'Inter', sans-serif;">
                <div style="position:relative; background:linear-gradient(135deg,#0284c7 0%,#0ea5e9 55%,#38bdf8 100%); padding:24px 26px 28px; color:#fff; overflow:hidden;">
                    <div style="position:absolute; top:-45px; right:-30px; width:150px; height:150px; background:rgba(255,255,255,0.13); border-radius:50%;"></div>
                    <div style="position:absolute; bottom:-70px; right:50px; width:180px; height:180px; background:rgba(255,255,255,0.08); border-radius:50%;"></div>
                    <button onclick="document.getElementById('mmSupportModal').style.display='none'" style="position:absolute; right:14px; top:14px; width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.22); border:none; border-radius:50%; color:#fff; cursor:pointer; transition:background 0.2s; z-index:2;" onmouseover="this.style.background='rgba(255,255,255,0.38)'" onmouseout="this.style.background='rgba(255,255,255,0.22)'">
                        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                    <div style="position:relative; z-index:1; display:flex; align-items:center; gap:14px;">
                        <div style="width:54px; height:54px; border-radius:16px; background:rgba(255,255,255,0.22); display:flex; align-items:center; justify-content:center; box-shadow:inset 0 1px 4px rgba(255,255,255,0.5); flex-shrink:0;">
                            <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 11h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-4a9 9 0 0 1 18 0v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h2"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/></svg>
                        </div>
                        <div>
                            <h2 style="margin:0; font-weight:800; font-size:1.3rem; letter-spacing:-0.02em;">Customer Support</h2>
                            <p style="margin:4px 0 0; font-size:0.82rem; opacity:0.92;">We usually reply within 24 hours &#9889;</p>
                        </div>
                    </div>
                </div>
                <div style="padding:22px 26px 24px;">
                    <label style="display:block; font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.07em; color:#0369a1; margin-bottom:8px;">How can we help?</label>
                    <textarea id="mmSupportIssueText" rows="4" placeholder="Describe your issue or feature request&hellip;" style="width:100%; border:2px solid #e2e8f0; border-radius:12px; padding:12px 14px; font-family:inherit; font-size:0.9rem; color:#0f172a; resize:vertical; outline:none; transition:all 0.2s; background:#f8fafc; box-sizing:border-box;" onfocus="this.style.borderColor='#0ea5e9';this.style.background='#fff';this.style.boxShadow='0 0 0 4px rgba(14,165,233,0.13)'" onblur="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc';this.style.boxShadow='none'"></textarea>
                    <button onclick="submitSupportIssue()" id="mmSupportSubmitBtn" style="width:100%; margin-top:18px; padding:13px; background:linear-gradient(135deg,#0284c7,#0ea5e9); color:#fff; border:none; border-radius:12px; font-weight:800; font-size:0.95rem; font-family:inherit; cursor:pointer; box-shadow:0 8px 22px rgba(14,165,233,0.38); transition:all 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 13px 28px rgba(14,165,233,0.48)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 8px 22px rgba(14,165,233,0.38)'">
                        Submit Issue
                    </button>
                    <p style="margin:14px 0 0; text-align:center; font-size:0.74rem; color:#94a3b8;">&#128274; Your message goes straight to the Billware team</p>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', supportModalHtml);
        
        window.mmShowSupportModal = function() {
            document.getElementById('mmSupportIssueText').value = '';
            document.getElementById('mmSupportModal').style.display = 'flex';
        };

        window.submitSupportIssue = async function() {
            const text = document.getElementById('mmSupportIssueText').value.trim();
            if (!text) { alert('Please describe your issue first.'); return; }
            
            const btn = document.getElementById('mmSupportSubmitBtn');
            btn.disabled = true; btn.textContent = 'Submitting...';
            
            const db = _authDB();
            if (db) {
                const { error } = await db.from('customer_issues').insert({
                    tenant_id: session.tenant_id,
                    username: session.username,
                    issue_text: text,
                    status: 'open'
                });
                
                if (error) {
                    alert('Failed to submit issue: ' + error.message);
                } else {
                    alert('Issue submitted successfully! Our team will look into it.');
                    document.getElementById('mmSupportModal').style.display = 'none';
                }
            } else {
                alert('Database not connected. Cannot submit issue right now.');
            }
            
            btn.disabled = false; btn.textContent = 'Submit Issue';
        };
    }

    const headerRight = document.getElementById('headerRight');
    if (headerRight) headerRight.appendChild(bar);
    else {
        const header = document.querySelector('header');
        if (header) {
            // Fix layout clash by grouping logo and back button safely on the left
            const backBtn = header.querySelector('.back-btn');
            const logo = header.querySelector('.logo');
            
            if (backBtn && logo && !header.querySelector('.mm-header-left')) {
                const leftGroup = document.createElement('div');
                leftGroup.className = 'mm-header-left';
                leftGroup.style.display = 'flex';
                leftGroup.style.alignItems = 'center';
                leftGroup.style.gap = '12px';
                leftGroup.style.flexShrink = '0';
                leftGroup.style.marginRight = 'auto'; // push user bar to the right
                
                header.insertBefore(leftGroup, logo);
                leftGroup.appendChild(logo);
                leftGroup.appendChild(backBtn);
            }
            
            header.style.flexWrap = 'wrap'; // Allow wrapping on very small screens
            header.style.gap = '10px';
            header.appendChild(bar);
        }
    }

    // Update dashboard welcome message with username
    const dashWelcome = document.querySelector('.dashboard-header h2');
    if (dashWelcome) {
        dashWelcome.textContent = `Welcome, ${session.username}!`;
    }
}

// =========================================================
// DATA AUTO-MIGRATION (LOCAL -> SUPABASE)
// Runs once per user device to push legacy offline data to the cloud.
// =========================================================
async function _autoMigrateLocalDataToSupabase(session) {
    if (!session) return;
    const user = session.tenant_id || session.username;
    if (!user) return;
    
    const flagKey = `mm_${user}_migrated_data`;
    if (localStorage.getItem(flagKey)) return; // Already migrated

    console.log(`[auth] Starting auto-migration for ${user}...`);
    
    try {
        // 1. Customers
        const custStr = localStorage.getItem(`mm_${user}_customers`) || localStorage.getItem('mm_customers');
        if (custStr) {
            const customers = JSON.parse(custStr) || [];
            for (const c of customers) {
                if (typeof dbAddCustomer === 'function') await dbAddCustomer(c.name, c.phone || '', c.address || '');
            }
        }

        // 2. Doctors
        const docStr = localStorage.getItem(`mm_${user}_doctors`) || localStorage.getItem('mm_doctors');
        if (docStr) {
            const doctors = JSON.parse(docStr) || [];
            for (const d of doctors) {
                if (typeof dbAddDoctor === 'function') await dbAddDoctor(d.name, d.phone || '', d.clinic || '', d.address || '');
            }
        }

        // 3. Medicines
        const medStr = localStorage.getItem(`mm_${user}_medicines`) || localStorage.getItem('mm_medicines');
        if (medStr) {
            const meds = JSON.parse(medStr) || [];
            if (meds.length && typeof dbImportMedicines === 'function') await dbImportMedicines(meds);
        }

        // 4. Purchases
        const purStr = localStorage.getItem(`mm_${user}_purchases`) || localStorage.getItem('mm_purchases');
        if (purStr) {
            const purchases = JSON.parse(purStr) || [];
            for (const p of purchases) {
                if (typeof dbAddPurchase === 'function') await dbAddPurchase(p);
            }
        }

        // 5. Bills
        const billStr = localStorage.getItem(`mm_${user}_bills`) || localStorage.getItem('mm_bills');
        if (billStr) {
            const bills = JSON.parse(billStr) || [];
            for (const b of bills) {
                if (typeof dbSaveBill === 'function') await dbSaveBill(b);
            }
        }

        localStorage.setItem(flagKey, 'true');
        console.log(`[auth] Auto-migration complete for ${user}.`);
        
    } catch (e) {
        console.error('[auth] Auto-migration failed:', e);
    }
}

/* ═══════════════════════════════════════════════════════════
   GLOBAL OFFLINE BANNER
   Injected on every page via auth.js (loaded on all pages).
   Listens for online/offline events and auto-syncs pending data.
════════════════════════════════════════════════════════════ */

function _getPendingCount() {
    try {
        const session = mmGetSession();
        if (!session) return 0;
        const user = session.tenant_id || session.username;
        const sales     = JSON.parse(localStorage.getItem(`mm_${user}_pending_sales`)     || '[]');
        const purchases = JSON.parse(localStorage.getItem(`mm_${user}_pending_purchases`) || '[]');
        return sales.length + purchases.length;
    } catch { return 0; }
}

function _injectOfflineBanner() {
    if (document.getElementById('mm-offline-banner')) return;

    const style = document.createElement('style');
    style.id = 'mm-offline-banner-style';
    style.textContent = `
        #mm-offline-banner {
            position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
            padding: 9px 20px;
            display: flex; align-items: center; justify-content: center; gap: 10px;
            font-family: 'Inter', sans-serif; font-size: 0.83rem; font-weight: 700;
            box-shadow: 0 3px 12px rgba(0,0,0,0.18);
            transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease;
            transform: translateY(-110%); opacity: 0; pointer-events: none;
        }
        #mm-offline-banner.ob-visible {
            transform: translateY(0); opacity: 1; pointer-events: all;
        }
        #mm-offline-banner.ob-offline { background: #1e1e2e; color: #f1f5f9; }
        #mm-offline-banner.ob-syncing { background: #1d4ed8; color: white; }
        #mm-offline-banner.ob-synced  { background: #065f46; color: white; }
        .ob-dot {
            width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .ob-offline .ob-dot { background: #ef4444; animation: ob-pulse 1.2s infinite; }
        .ob-syncing .ob-dot { background: #93c5fd; animation: ob-pulse 0.6s infinite; }
        .ob-synced  .ob-dot { background: #6ee7b7; }
        @keyframes ob-pulse { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
    `;
    if (!document.getElementById('mm-offline-banner-style')) {
        document.head.appendChild(style);
    }

    const banner = document.createElement('div');
    banner.id = 'mm-offline-banner';
    banner.innerHTML = `<span class="ob-dot"></span><span id="mm-ob-text">You are offline</span>`;
    document.body.prepend(banner);
}

let _obHideTimer = null;

function updateOfflineBanner() {
    if (!document.body) return;
    _injectOfflineBanner();
    const banner = document.getElementById('mm-offline-banner');
    const text   = document.getElementById('mm-ob-text');
    if (!banner || !text) return;

    const isOnline = navigator.onLine;
    const pending  = _getPendingCount();

    if (_obHideTimer) { clearTimeout(_obHideTimer); _obHideTimer = null; }

    if (!isOnline) {
        // ── OFFLINE ──
        banner.className = 'ob-offline ob-visible';
        text.textContent = pending > 0
            ? `🔴 Offline — ${pending} record${pending !== 1 ? 's' : ''} waiting to sync`
            : '🔴 You are offline — Billing will continue normally';

    } else if (pending > 0) {
        // ── BACK ONLINE, HAS PENDING — sync now ──
        banner.className = 'ob-syncing ob-visible';
        text.textContent = `⏳ Internet restored — Syncing ${pending} record${pending !== 1 ? 's' : ''}...`;

        if (typeof window.dbSyncPendingOfflineData === 'function') {
            window.dbSyncPendingOfflineData().then(result => {
                const total = (result?.salesSynced || 0) + (result?.purchasesSynced || 0);
                const stillPending = _getPendingCount();

                if (stillPending === 0) {
                    banner.className = 'ob-synced ob-visible';
                    text.textContent = `✅ All synced! ${total > 0 ? total + ' record' + (total !== 1 ? 's' : '') + ' uploaded to cloud.' : 'Data is up to date.'}`;
                    _obHideTimer = setTimeout(() => { banner.classList.remove('ob-visible'); }, 3500);
                } else {
                    banner.className = 'ob-offline ob-visible';
                    text.textContent = `⚠️ Partial sync — ${stillPending} record${stillPending !== 1 ? 's' : ''} still pending`;
                    _obHideTimer = setTimeout(() => { banner.classList.remove('ob-visible'); }, 5000);
                }
            });
        }

    } else {
        // ── ONLINE, NOTHING PENDING — hide ──
        banner.classList.remove('ob-visible');
    }
}

// Expose globally so sales.html / purchase.html can call it after an offline save
window.updateOfflineBanner = updateOfflineBanner;

// Start listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    _injectOfflineBanner();
    setTimeout(updateOfflineBanner, 900); // check on load

    window.addEventListener('offline', updateOfflineBanner);

    window.addEventListener('online', () => {
        setTimeout(updateOfflineBanner, 1200); // wait for network to stabilise
    });
});
