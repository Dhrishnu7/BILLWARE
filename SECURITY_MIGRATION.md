# Billware — Security Migration (tenant isolation)

Goal: make it **impossible** for one shop/user to read or change another's data,
and stop exposing password hashes — without ever locking out live users.

**Why this is staged:** today the browser talks to Supabase with a *public* key and
the "only my data" rule lives in JavaScript, so anyone can bypass it. Real
isolation needs the **database** to enforce it (Row-Level Security), and RLS only
works once every request is authenticated through **Supabase Auth**. So we switch
auth on *first*, verify it, and only *then* turn on RLS. Every step is reversible.

Do the phases **in order**. Don't run `sql/02_security_setup.sql` early.

---

## Phase 0 — Safe now (data-loss protection) ✅
1. Supabase Dashboard → **Database → Backups** → enable **PITR** (or confirm daily backups).
2. SQL Editor → run **`sql/01_data_integrity.sql`**. Safe, non-breaking, re-runnable.

---

## Phase 1 — Stand up the secure auth server (no user impact)
This adds the machinery but does **not** change how anyone logs in yet.

1. **Dashboard → Authentication → Providers → Email**: enable **Email**, and
   **turn OFF "Confirm email"** (accounts are created server-side; there are no inboxes).
2. **Dashboard → Authentication → Providers**: **disable public sign-ups**
   ("Allow new users to sign up" = OFF). Only our server function may create accounts.
3. SQL Editor → run the **membership + helper** part of `sql/02_security_setup.sql`
   **only up to the end of section 2** (the `memberships` table, `mm_users.auth_uid`
   column, and `current_tenant()`), i.e. **do NOT run sections 3–4 yet** (those enable RLS).
4. Deploy the Edge Function (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login                        # once, opens browser
   supabase link --project-ref jwyyjdwlbgjijmwillow
   supabase functions deploy mm-login --no-verify-jwt
   ```
   > **No secrets to set.** The function reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   > and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase **auto-injects** into every
   > Edge Function. (You *cannot* `supabase secrets set` anything with a `SUPABASE_`
   > prefix — the platform reserves it.) The service_role key stays server-side only.
5. **Test the function alone** (replace with a real test login):
   ```bash
   curl -X POST "https://jwyyjdwlbgjijmwillow.functions.supabase.co/mm-login" \
     -H "Content-Type: application/json" \
     -d '{"username":"<test user>","password":"<their password>"}'
   ```
   Expect JSON with `access_token`, `refresh_token`, `tenant`, `role`. If so, Phase 1 works.

Nothing about the live site changed yet — old login still works normally.

---

## Phase 2 — Switch the browser login to the function (I do this in code)
Once Phase 1's curl test passes, I will change `mmLogin` in `js/auth.js` so that:
- it calls `mm-login` instead of reading `mm_users` in the browser;
- on success it does `supabase.auth.setSession({access_token, refresh_token})` so
  **every later data request carries a verified identity**;
- `mmLogout` also calls `supabase.auth.signOut()`;
- offline fallback and the "pending approval / single-device" checks are preserved.

RLS is still OFF here, so data access is unchanged — this step only *starts attaching
real identities*. We verify: log in as a **test account**, confirm the app works
normally, and confirm in DevTools that `supabase.auth.getSession()` returns a session.

**Roll back Phase 2:** revert the `js/auth.js` commit (old login instantly restored).

---

## Phase 3 — Turn on isolation (the security actually engages)
When Phase 2 is verified and active users have logged in at least once:
1. SQL Editor → run the **rest of `sql/02_security_setup.sql`** (sections 3–4: enable RLS
   + policies on all data tables).
2. **Verify:**
   - Logged in as tenant A (test), you see only A's customers/bills/etc.
   - In DevTools console run `await _supabase.from('customers').select('*')` — you get
     **only your own rows** (previously it returned everyone's). ✅ Leak closed.
   - Anonymous / logged-out requests return **0 rows**.
3. If anything looks wrong: **instant rollback** —
   `alter table customers disable row level security;` (repeat per table). No data lost.

---

## Phase 4 — Follow-ups (after the above is stable)
- Move user-management (`mm_users` create/approve/session) behind Edge Functions,
  then lock `mm_users`/`password_reset_requests` with RLS so hashes stop being
  readable at all (`03_lockdown.sql` — I'll write it then).
- Passwords are now bcrypt in Supabase Auth; the legacy SHA-256 in `mm_users`
  becomes a fallback only, and can be dropped later.

---

## Phase 5 — Close the account-takeover holes (mm-admin) · written 2026-07-17

Phase 4 stopped browsers **reading** password hashes. It did not stop them
**writing**. Three holes were found live on 2026-07-17, each usable by anyone
with the publishable key that ships in `js/supabase.js` — no login required:

1. `PATCH /rest/v1/mm_users?username=eq.<victim>` with a new `passwordHash`
   → log in as anyone. (UPDATE was never revoked.)
2. `POST /rest/v1/mm_users` with `tenant_id` of a real shop + `approval_status:
   'approved'` → mm-login builds a membership from that tenant_id → full
   RLS-blessed access to that shop's data.
3. `password_reset_requests` was anon read **and** write, PIN column in
   plaintext. Six live PINs were sitting in it (defused 2026-07-17: set to
   `pin=null, status='rejected'`, after backing up the original rows).

Fix = the same shape as Phase 4: the write moves to a service-role Edge
Function (`supabase/functions/mm-admin/index.ts`), then the grants are revoked
(`sql/03_lockdown.sql`).

**ORDER MATTERS — do these in exactly this sequence.** The client calls the
function, and the SQL revokes what the client used to do directly, so shipping
them out of order breaks signup / password change / the superadmin page.

1. **Deploy the function.** Dashboard → Edge Functions → Deploy a new function
   → name it exactly `mm-admin` → paste all of
   `supabase/functions/mm-admin/index.ts` → **turn Verify JWT OFF** (signup and
   password reset happen before a user has a token; the function checks tokens
   itself for the actions that need one).
2. **Set the secret.** Dashboard → Edge Functions → Secrets → add
   `SA_PASSWORD` = the superadmin password. This is the value that used to sit
   in `superadmin.html` in plain sight; it now exists only here.
   No other secret is needed — `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
   `SUPABASE_ANON_KEY` are injected automatically (same as mm-login).
3. **Verify the function** before any client goes out: `sa_login` with the wrong
   password must return 401, with the right one `{ok:true}`.
4. **Ship the client** (outer repo push → Firebase). Files: `js/auth.js`
   (`mmAdminCall`), `login.html`, `superadmin.html`, `manage-users.html`,
   `index.html`, `js/supabase.js`, `sw.js` → v138.
5. **Smoke-test on the live site while the old grants are still in place**, so
   any mistake is harmless: log in, change a password, run a forgot-password
   reset end to end, open the superadmin page, approve something.
6. **Only then run `sql/03_lockdown.sql`** in the SQL Editor. Verification
   commands and a full rollback are in the file's own comments.

Rollback at any point: revert the client commit (step 4) and/or run the
rollback block at the bottom of `03_lockdown.sql`. No data is touched.

**Known leftover after Phase 5:** the superadmin dashboard reads `bills` /
`purchases` / `customers` / `medicines` with the anon key, which Phase 3's RLS
already returns empty for. Those panels show nothing today and Phase 5 doesn't
change that — worth a follow-up (route them through `sa_list` too).

---

## Safety summary
- No data is deleted or moved at any phase.
- Phases 0–1 are invisible to users. Phase 2 is code-revertible. Phase 3 is one-command-revertible.
- Existing users keep their **same username & password** (lazy-migrated on first login).
- We validate on a **test account** before trusting it for everyone.
