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

// Cached business data must never survive an account switch on a shared device.
//
// This used to be an ALLOW-list of "keys that hold business data", which meant
// every new feature silently leaked until someone remembered to add its key —
// and several never were (the Schedule H recycle bin, prescription softcopies,
// the report bin, purchase drafts, the store name). So the rule is now inverted:
// EVERYTHING in localStorage is treated as tenant data and wiped, except the
// few keys below that are genuinely device- or app-level. A new feature is then
// safe by default; forgetting to update this file can no longer leak anything.
const MM_KEEP_KEYS = new Set([
    MM_SESSION_KEY,          // who is signed in (cleared separately on logout)
    MM_REMEMBER_KEY,
    'mm_auth_users',         // offline fallback user store (no business data)
    'mm_app_config',         // global feature switches, identical for every shop
    'mm_thermal_printer',    // this device's printer, not this shop's data
    'mm_ocr_engine_cached',  // whether THIS DEVICE has the OCR engine saved
    'mm_bill_attach_hint_off', // a UI hint this device has dismissed
]);

// Offline queues are already hard-scoped to their own tenant (mm_<tenant>_pending_*)
// so they cannot leak, and wiping them would destroy another shop's un-synced
// bills. The UNSCOPED fallbacks (mm_pending_sales / mm_pending_purchases) are
// NOT covered by this and are wiped like everything else.
const MM_PENDING_SCOPED_RE = /^mm_.+_pending_(sales|purchases)$/;

// Marks which tenant the cached business data currently belongs to.
const MM_DATA_OWNER_KEY = 'mm_data_owner';

// Wipe all cached tenant business data (used on logout and account switch).
function _mmClearBusinessData() {
    try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (MM_KEEP_KEYS.has(k)) continue;
            if (k.startsWith('sb-')) continue;            // Supabase Auth tokens
            if (MM_PENDING_SCOPED_RE.test(k)) continue;   // other shops' offline queues
            doomed.push(k);
        }
        doomed.forEach(k => { try { localStorage.removeItem(k); } catch {} });
    } catch (e) { console.warn('[auth] data wipe failed:', e); }
}

/**
 * True when the business data cached on this device provably belongs to the
 * signed-in tenant. Anything that pushes local cache UP to the cloud must check
 * this first, or one shop's leftover data gets written into another shop's rows.
 */
function mmOwnsLocalData() {
    try {
        const session = mmGetSession();
        if (!session) return false;
        const tenant = session.tenant_id || session.username;
        return !!tenant && localStorage.getItem(MM_DATA_OWNER_KEY) === tenant;
    } catch (e) { return false; }
}

/**
 * Second line of defence for devices that carry no ownership marker — a session
 * that predates the marker, or storage that was cleared halfway. Rows synced
 * down from the cloud keep the `user_id` they were stored under, so a cache that
 * contains somebody else's user_id is provably foreign no matter what the
 * marker says (or doesn't).
 */
function _mmForeignDataDetected(tenant) {
    const SAMPLED = ['mm_purchases', 'mm_sales', 'mm_bills', 'mm_customers', 'mm_doctors'];
    for (const key of SAMPLED) {
        let rows;
        try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { continue; }
        if (!Array.isArray(rows)) continue;
        for (const r of rows) {
            const owner = r && (r.user_id || r.userId);
            if (owner && owner !== tenant) return true;
        }
    }
    return false;
}

/**
 * Cross-account guard. Runs on EVERY page load (not just at login), because a
 * session can arrive on a page without ever passing through mmLogin() — a
 * restored "remember me" session, a second tab, a back-button navigation, or a
 * device whose last login predates this guard. If the cached data belongs to a
 * different shop, it is wiped before any page has a chance to render it.
 */
function mmEnforceDataOwner() {
    try {
        const session = mmGetSession();
        if (!session) return;                       // logged out: leave the device alone
        const tenant = session.tenant_id || session.username;
        if (!tenant) return;
        const cachedOwner = localStorage.getItem(MM_DATA_OWNER_KEY);
        if (cachedOwner === tenant) return;         // already ours — nothing to do
        if (!cachedOwner && _mmForeignDataDetected(tenant)) {
            _mmClearBusinessData();
            localStorage.setItem(MM_DATA_OWNER_KEY, tenant);
            return;
        }
        if (cachedOwner) _mmClearBusinessData();    // someone else's — wipe it now
        localStorage.setItem(MM_DATA_OWNER_KEY, tenant);
    } catch (e) { console.warn('[auth] owner guard failed:', e); }
}
window.mmOwnsLocalData    = mmOwnsLocalData;
window.mmEnforceDataOwner = mmEnforceDataOwner;

// Run immediately, at parse time — NOT on DOMContentLoaded. Page scripts read
// localStorage as soon as they run, so the wipe has to happen before any of
// them get a chance to render another shop's cached data.
mmEnforceDataOwner();

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

// The password-hash column is intentionally NEVER selected in the browser — it
// is locked to the server (the mm-login Edge Function) only. Downloading the
// hash list into the browser is exactly what allowed it to be scraped, so no
// client query may request it. All client reads of mm_users use this list.
const MM_USER_COLS = 'id,username,role,tenant_id,createdAt,approval_status,payment_status,active_session_token,auth_uid';

async function mmGetUsers() {
    const db = _authDB();
    if (db) {
        try {
            const { data, error } = await db.from('mm_users').select(MM_USER_COLS);
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
// NOTE: _saveUser()/_syncLocal() used to live here. They upserted whole mm_users
// rows straight from the browser, which is exactly the write right that let
// anyone rewrite anyone's password. Every caller now goes through mmAdminCall()
// and the mm-admin Edge Function; see sql/03_lockdown.sql.

async function _deleteUser(username, tenantId, allowSelf = false) {
    const tid = tenantId || username;
    const id  = tid + ':' + username;
    // Deletes go through mm-admin: browsers have no DELETE right on mm_users.
    // The server resolves the target within the caller's own store and removes
    // the linked Supabase Auth user too (the old client path orphaned those).
    const res = await mmAdminCall('delete_user', { username, allowSelf });
    // Only forget the row locally if the server actually deleted it — otherwise
    // it vanishes from the list and reappears on the next reload.
    if (!res.ok) return { success: false, message: res.message };
    _localSaveUsers(_localGetUsers().filter(u => u.id !== id && u.username.toLowerCase() !== username.toLowerCase()));
    return { success: true };
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
    // Write to ONE store and clear the other. Signing in without "remember me"
    // used to leave the PREVIOUS account's session sitting in localStorage: the
    // pages that read `mm_auth_session` straight out of localStorage (index.html,
    // notifications.js, shop-setup.html) then answered with the old shop's
    // tenant, so the new account saw the old account's inbox and requests.
    if (remember) {
        localStorage.setItem(MM_REMEMBER_KEY, 'true');
        localStorage.setItem(MM_SESSION_KEY, JSON.stringify(session));
        sessionStorage.removeItem(MM_SESSION_KEY);
    } else {
        localStorage.removeItem(MM_REMEMBER_KEY);
        localStorage.removeItem(MM_SESSION_KEY);
        sessionStorage.setItem(MM_SESSION_KEY, JSON.stringify(session));
    }
}

function mmClearSession() {
    sessionStorage.removeItem(MM_SESSION_KEY);
    localStorage.removeItem(MM_SESSION_KEY);
    localStorage.removeItem(MM_REMEMBER_KEY);

    // Clear all offline business data to prevent data leakage across accounts
    _mmClearBusinessData();
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
    
    // Phase-3 safety net: a device still on a legacy local session (no Supabase Auth
    // session) would see no data once RLS is on. Detect that and ask for a one-time
    // re-login instead. Stop here if it redirected.
    if (await _mmEnsureSecureSession()) return null;

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
        const { data: users, error } = await db.from('mm_users').select(MM_USER_COLS);
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
            await mmAlert('⚠️ Your account has been removed. You have been signed out.');
            window.location.replace('login.html');
            return;
        }

        // Account exists but was rejected after login
        if (dbUser.approval_status === 'rejected') {
            mmClearSession();
            await mmAlert('❌ Your account has been rejected by the administrator. You have been signed out.');
            window.location.replace('login.html');
            return;
        }

        // Another device forcefully logged in — token mismatch
        if (dbUser.active_session_token && (!session.token || dbUser.active_session_token !== session.token)) {
            mmClearSession();
            await mmAlert('📱 You have been logged out because this account was signed in from another device.');
            window.location.replace('login.html');
        }
    } catch(e) {
        // Ignore network errors — never log out offline users accidentally
    }
}

/**
 * Phase-3 safety net for tenant isolation (RLS).
 * Once RLS is enabled, any request WITHOUT a real Supabase Auth session sees no
 * data. A device still on a pre-upgrade "legacy" local session has no such session,
 * so it would show an empty app. We detect that and ask the user to sign in once
 * (which re-runs mmLogin → mm-login and mints a real session).
 *
 * Safeguards:
 *  - ONLINE only — offline users are never disturbed (offline billing must keep working).
 *  - At most ONCE per tab — if mm-login is briefly unreachable we let them in (degraded)
 *    instead of bouncing them in a redirect loop.
 * Returns true if it triggered a redirect to re-login (caller should stop).
 */
async function _mmEnsureSecureSession() {
    try {
        if (!navigator.onLine) return false;            // never disrupt offline use
        const db = _authDB();
        if (!db || !db.auth || !db.auth.getSession) return false;
        const { data } = await db.auth.getSession();
        if (data && data.session) {                     // already have a real session — good
            sessionStorage.removeItem('mm_reauth_prompted');
            return false;
        }
        if (sessionStorage.getItem('mm_reauth_prompted')) return false; // avoid loops
        sessionStorage.setItem('mm_reauth_prompted', '1');
        await mmAlert('🔒 Security upgrade — please sign in again to keep your shop\'s data protected. Your data is safe; this is a one-time step.');
        mmClearSession();
        window.location.replace('login.html');
        return true;
    } catch (e) {
        return false;                                   // never block the app on this check
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
// Calls the mm-login Edge Function, which verifies the password on the SERVER
// (the browser never downloads the password-hash list). Returns:
//   { ok:true, data, access_token, refresh_token }  on success
//   { ok:false, status, message }                   on a definitive rejection
//   null                                            on network failure / offline
async function _mmServerLogin(username, password) {
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
        let body = null;
        try { body = await res.json(); } catch (_) {}
        if (res.ok && body && body.access_token && body.refresh_token) {
            return { ok: true, status: res.status, data: body,
                     access_token: body.access_token, refresh_token: body.refresh_token };
        }
        return { ok: false, status: res.status, message: (body && body.error) || null };
    } catch (e) {
        return null; // aborted / offline / unreachable
    } finally {
        clearTimeout(timer);
    }
}

// Calls the mm-admin Edge Function, which holds the service role and is the
// only thing allowed to write password hashes / approve accounts / touch reset
// PINs. Sends the user's Auth token when there is one, so the server can decide
// what the caller is permitted to do — the browser never asserts its own tenant.
// Returns { ok:true, data } | { ok:false, status, message }.
async function mmAdminCall(action, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        let bearer = _AUTH_SUPABASE_KEY;
        try {
            const client = _authDB();
            const { data } = await client.auth.getSession();
            if (data && data.session && data.session.access_token) bearer = data.session.access_token;
        } catch (_) {}

        const res = await fetch(`${_AUTH_SUPABASE_URL}/functions/v1/mm-admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': _AUTH_SUPABASE_KEY,
                'Authorization': `Bearer ${bearer}`,
            },
            body: JSON.stringify({ action, ...payload }),
            signal: controller.signal,
        });
        let body = null;
        try { body = await res.json(); } catch (_) {}
        if (res.ok && body && !body.error) return { ok: true, status: res.status, data: body };
        return { ok: false, status: res.status, message: (body && body.error) || 'Server error.' };
    } catch (e) {
        return { ok: false, status: 0, message: 'You appear to be offline. Please try again when connected.' };
    } finally {
        clearTimeout(timer);
    }
}

// Switch the shared Supabase client to the authenticated (RLS) session.
async function _mmApplyAuthSession(access_token, refresh_token) {
    try {
        const client = _authDB();
        if (client && client.auth && client.auth.setSession) {
            await client.auth.setSession({ access_token, refresh_token });
            return true;
        }
    } catch (e) { console.warn('[auth] setSession failed:', e); }
    return false;
}

async function mmLogin(username, password, remember, force = false) {
    try {
        const db = _authDB();
        const uname = String(username).trim();

        // --- STEP 1: Verify the password on the secure SERVER (mm-login). ---
        // The browser no longer downloads the password-hash list; the Edge
        // Function checks the password and returns a real Supabase Auth session.
        const server = navigator.onLine ? await _mmServerLogin(uname, password) : null;
        if (server === null) {
            return { success: false, message: navigator.onLine
                ? 'Sign-in service is temporarily unavailable. Please try again in a moment.'
                : '📶 You need an internet connection to sign in.' };
        }
        if (!server.ok) {
            // mm-login already distinguishes invalid / pending / rejected.
            return { success: false, message: server.message || 'Invalid username or password.' };
        }
        const info   = server.data || {};
        const infoUsername = info.username || uname;
        const tenant = info.tenant || infoUsername;

        // --- Cross-account guard (shared computer). If this browser still holds
        // cached business data belonging to a DIFFERENT tenant — e.g. the previous
        // user closed the tab without logging out, or was kicked by single-device
        // lockout — wipe it now so the incoming user never sees the other shop's
        // medicines/customers before the cloud sync runs. Only fires when a marker
        // exists and differs, so an existing user's own cached data is preserved. ---
        try {
            const cachedOwner = localStorage.getItem(MM_DATA_OWNER_KEY);
            const foreign = cachedOwner ? (cachedOwner !== tenant)
                                        : _mmForeignDataDetected(tenant);
            if (foreign) _mmClearBusinessData();
        } catch (e) {}

        // --- STEP 2: Single-device lockout. Read/claim the device token with the
        // publishable key (non-secret columns stay readable; the password column
        // is server-only). Done BEFORE switching to the auth session so the write
        // uses the role that already has update rights on mm_users. ---
        let dbRow = null;
        try {
            const { data } = await db.from('mm_users').select(MM_USER_COLS).ilike('username', infoUsername);
            if (data && data.length) {
                dbRow = data.find(u =>
                    (u.username || '').toLowerCase() === infoUsername.toLowerCase() &&
                    ((u.tenant_id || u.username) === tenant)
                ) || null;
            }
        } catch (e) { /* non-fatal — single-device check just degrades */ }

        if (dbRow && dbRow.active_session_token && !force) {
            const existingSession = mmGetSession();
            if (!existingSession || existingSession.token !== dbRow.active_session_token) {
                return { success: false, message: 'Account already logged in on another device.', forceRequired: true };
            }
        }

        const newToken = Date.now().toString(36) + Math.random().toString(36).substr(2);
        try {
            const targetId = (dbRow && dbRow.id) ? dbRow.id : (tenant + ':' + infoUsername);
            await db.from('mm_users').update({ active_session_token: newToken }).eq('id', targetId);
        } catch (e) { console.warn('[auth] could not record device token:', e); }

        // --- STEP 3: Switch the client to the authenticated (RLS) session. ---
        await _mmApplyAuthSession(server.access_token, server.refresh_token);

        // Build + persist the session (a password hash is never stored anywhere).
        const user = {
            id:                   dbRow ? dbRow.id : (tenant + ':' + infoUsername),
            username:             infoUsername,
            role:                 info.role || (dbRow && dbRow.role) || 'owner',
            tenant_id:            tenant,
            approval_status:      info.approval_status || (dbRow && dbRow.approval_status) || 'approved',
            payment_status:       info.payment_status  || (dbRow && dbRow.payment_status)  || null,
            auth_uid:             dbRow ? dbRow.auth_uid : undefined,
            active_session_token: newToken,
            token:                newToken,
        };
        mmSaveSession(user, remember);
        // Stamp who the cached business data now belongs to (see MM_DATA_OWNER_KEY).
        try { localStorage.setItem(MM_DATA_OWNER_KEY, tenant); } catch (e) {}

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
        // Release the single-device lock. This targets active_session_token on
        // its own: it's the only mm_users column browsers may still write, so a
        // whole-row upsert here would be denied.
        try {
            const users = await mmGetUsers();
            const user = users.find(u => u.username === session.username && u.tenant_id === session.tenant_id);
            if (user && user.active_session_token === session.token) {
                const db = _authDB();
                if (db) await db.from('mm_users').update({ active_session_token: null }).eq('id', user.id);
            }
        } catch (e) { console.warn('[auth] could not release session lock:', e); }
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
    // Every username is globally unique, workers included — login, password
    // reset and the derived Auth identity all resolve by bare username and
    // cannot tell two same-named users apart. This check is only for fast
    // feedback; the server and a unique index are what actually enforce it.
    const users = await mmGetUsers();
    if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
        return { success: false, message: 'That username is already taken. Usernames must be unique across all shops, so please pick a different one.' };
    }
    // The server creates the account. It always forces role=owner,
    // tenant_id=username and approval_status=pending, so a crafted request
    // can't register itself into somebody else's shop or self-approve.
    const res = await mmAdminCall('signup', { username: username.trim(), password, shopInfo });
    if (!res.ok) return { success: false, message: res.message };
    // setup_token lets the shop-details page (which runs before approval, with
    // no session) store the profile through the server. Without it the details
    // never reach the cloud and the admin sees "no shop profile" at approval.
    return { success: true, pending: true, setupToken: (res.data && res.data.setup_token) || '' };
}

/** Add a worker to the current owner's store. Username unique within this store only. */
async function mmAddWorker(username, password) {
    // Tenant scoping and the uniqueness check both happen on the server, which
    // takes the tenant from memberships rather than from anything we send.
    const res = await mmAdminCall('create_user', { username: username.trim(), password, role: 'worker' });
    if (!res.ok) return { success: false, message: res.message };
    return { success: true };
}

/** Add an additional owner-role user within the current store. */
async function mmAddOwner(username, password) {
    const res = await mmAdminCall('create_user', { username: username.trim(), password, role: 'owner' });
    if (!res.ok) return { success: false, message: res.message };
    return { success: true };
}

/** Delete a user by username (owner function) */
async function mmDeleteUser(username) {
    const session  = mmGetSession();
    const tenantId = session ? (session.tenant_id || session.username) : username;
    return await _deleteUser(username, tenantId);
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
            // allowSelf: this flow intentionally removes the owner's own record.
            await _deleteUser(u.username, tenantId, true);
        }

        // ── 3. Clear every cached trace of this shop from the device ──
        // (The old version only matched `_<tenant>_` keys, which left all the
        //  unscoped caches — medicines, bills, the Schedule H register — behind
        //  for whoever signed in on this device next.)
        _mmClearBusinessData();
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.includes(`_${tenantId}_`)) localStorage.removeItem(k);
        }

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
    // Password writes are server-only now: browsers have no UPDATE right on
    // mm_users.passwordHash. The server checks that the caller is the user
    // themselves or an owner of the same tenant.
    const res = await mmAdminCall('change_password', { username, newPassword });
    if (!res.ok) return { success: false, message: res.message };
    return { success: true };
}

/** Rename a user. Returns { success, message } */
async function mmRenameUser(oldUsername, newUsername) {
    const session = mmGetSession();
    const trimmed = newUsername.trim();
    if (trimmed.length < 3) return { success: false, message: 'Username must be at least 3 characters.' };

    // Renaming rewrites the row's username + id, which browsers may no longer do
    // (that write right is what let anyone rewrite anyone's account). The server
    // renames in place, so the password hash survives untouched.
    const res = await mmAdminCall('rename_user', { oldUsername, newUsername: trimmed });
    if (!res.ok) return { success: false, message: res.message };

    const tenantId = session ? (session.tenant_id || session.username) : null;
    const oldId = (tenantId || oldUsername) + ':' + oldUsername;
    _localSaveUsers(_localGetUsers().filter(u => u.id !== oldId));

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
        // ── EDIT HERE: helpline details shown in the support modal. ──
        // Leave any value as '' to hide that row completely.
        const MM_SUPPORT_CONTACT = {
            phone:     '+91 87782 62018',      // tap-to-call
            whatsapp:  '+91 87782 62018',      // opens WhatsApp chat
            email:     'mybillware@gmail.com',
            instagram: 'mybillware',           // username only
            facebook:  '',                     // page name only, e.g. 'mybillware'
            hours:     ''                      // e.g. 'Mon – Sat, 9 AM – 8 PM'
        };

        const _mmDigits = v => (v || '').replace(/\D/g, '');
        const _mmRow = (href, icon, label, value) => `
            <a href="${href}" target="_blank" rel="noopener" style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:11px; text-decoration:none; transition:all 0.18s;" onmouseover="this.style.borderColor='#0ea5e9';this.style.background='#f0f9ff'" onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc'">
                <span style="font-size:1.05rem; line-height:1;">${icon}</span>
                <span style="min-width:0;">
                    <span style="display:block; font-size:0.63rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8;">${label}</span>
                    <span style="display:block; font-size:0.8rem; font-weight:700; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${value}</span>
                </span>
            </a>`;

        let mmContactRows = '';
        if (MM_SUPPORT_CONTACT.phone)     mmContactRows += _mmRow('tel:' + MM_SUPPORT_CONTACT.phone.replace(/\s/g, ''), '&#128222;', 'Call us', MM_SUPPORT_CONTACT.phone);
        if (MM_SUPPORT_CONTACT.whatsapp)  mmContactRows += _mmRow('https://wa.me/' + _mmDigits(MM_SUPPORT_CONTACT.whatsapp), '&#128172;', 'WhatsApp', MM_SUPPORT_CONTACT.whatsapp);
        if (MM_SUPPORT_CONTACT.email)     mmContactRows += _mmRow('mailto:' + MM_SUPPORT_CONTACT.email, '&#9993;&#65039;', 'Email', MM_SUPPORT_CONTACT.email);
        if (MM_SUPPORT_CONTACT.instagram) mmContactRows += _mmRow('https://instagram.com/' + MM_SUPPORT_CONTACT.instagram, '&#128248;', 'Instagram', '@' + MM_SUPPORT_CONTACT.instagram);
        if (MM_SUPPORT_CONTACT.facebook)  mmContactRows += _mmRow('https://facebook.com/' + MM_SUPPORT_CONTACT.facebook, '&#128100;', 'Facebook', MM_SUPPORT_CONTACT.facebook);

        const mmHelplineHtml = mmContactRows ? `
                    <div style="margin-top:18px; padding-top:16px; border-top:1px dashed #e2e8f0;">
                        <div style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                            <span style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.07em; color:#0369a1;">Helpline</span>
                            ${MM_SUPPORT_CONTACT.hours ? `<span style="font-size:0.7rem; color:#94a3b8;">${MM_SUPPORT_CONTACT.hours}</span>` : ''}
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px;">${mmContactRows}</div>
                    </div>` : '';

        const supportModalHtml = `
        <style>
            @keyframes mmModalIn { from { opacity:0; transform:translateY(18px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
            @keyframes mmOverlayIn { from { opacity:0; } to { opacity:1; } }
        </style>
        <div class="modal-overlay" id="mmSupportModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.55); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); z-index:99999; align-items:center; justify-content:center; padding:16px; animation: mmOverlayIn 0.2s ease;">
            <div style="background:#fff; border-radius:22px; width:100%; max-width:440px; max-height:92vh; overflow-y:auto; box-shadow:0 30px 60px -15px rgba(2,132,199,0.4), 0 20px 40px -20px rgba(0,0,0,0.35); animation: mmModalIn 0.34s cubic-bezier(0.175, 0.885, 0.32, 1.275); font-family:'Inter', sans-serif;">
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
${mmHelplineHtml}
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

/* ════════════════════════════════════════════════════════════
   SITE-WIDE MOBILE POLISH
   One injected stylesheet, active only on phones (<=640px), so
   the desktop layout is never touched. Loaded on every shop page
   via auth.js (in <head>, so it applies before first paint).
   Fixes the common mobile mess: sideways page-scroll, crowded
   headers, oversized cards/padding, tab bars, wide tables and
   full-bleed modals.
════════════════════════════════════════════════════════════ */
(function _injectMobilePolish() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('mm-mobile-css')) return;
    var css = ''
      + '@media (max-width:640px){'
      // never let the page slide sideways; media stays inside its box
      + 'html,body{max-width:100%;overflow-x:hidden;}'
      + 'img,svg,video{max-width:100%;height:auto;}'
      + 'input,select,textarea{max-width:100%;}'
      // page shell: tighter gutters, calmer headings
      + 'header{padding-left:14px !important;padding-right:14px !important;row-gap:8px;}'
      + '.page-content,.page-wrap{padding-left:14px !important;padding-right:14px !important;}'
      + '.page-header h1{font-size:1.55rem !important;line-height:1.15 !important;}'
      + '.page-header p{font-size:.82rem !important;}'
      // user bar + back button: compact so they stop crowding
      + '.mm-user-bar{gap:6px;width:100%;justify-content:flex-start;}'
      + '.mm-manage-btn,.mm-logout-btn{padding:6px 10px;font-size:.72rem;}'
      + '.mm-user-name{font-size:.76rem;}'
      + '.back-btn{margin-right:6px !important;padding:.42rem .7rem !important;font-size:.78rem !important;}'
      // big hero / stat cards stack instead of overflowing
      + '.stat-card{flex-direction:column !important;align-items:flex-start !important;gap:.9rem !important;padding:1.3rem !important;}'
      + '.stat-value{font-size:2rem !important;}'
      // toolbars, search bars and button clusters wrap cleanly
      + '.search-bar,.toolbar,.filters,.btn-row,.actions,.ret-sub{flex-wrap:wrap !important;}'
      + '.search-bar input{min-width:140px;}'
      // tab bars wrap and shrink
      + '.tab-nav,.tab-bar,.tab-nav-wrap{flex-wrap:wrap !important;gap:6px !important;}'
      + '.tab-btn,.tab-pill,.ktab{font-size:.8rem !important;padding:.5rem .8rem !important;}'
      // wide tables scroll inside their own frame (no page blow-out)
      + '.tbl-wrap,.reg-wrap,.table-card,.table-scroll{overflow-x:auto !important;-webkit-overflow-scrolling:touch;max-width:100%;}'
      + '.stock-table,.ret-tbl{display:block;overflow-x:auto;white-space:nowrap;max-width:100%;-webkit-overflow-scrolling:touch;}'
      + 'table{max-width:100%;}'
      // card grids collapse to a single column
      + '.khata-grid,.card-grid,.cards,.contacts-grid{grid-template-columns:1fr !important;}'
      // modals fill the small screen
      + '.modal,.modal-card{width:94% !important;max-width:94% !important;padding:1.4rem !important;}'
      + '.modal-actions{flex-wrap:wrap;}'
      + '}';
    var style = document.createElement('style');
    style.id = 'mm-mobile-css';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
})();

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
