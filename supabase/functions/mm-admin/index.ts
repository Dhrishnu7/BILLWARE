// ============================================================================
// mm-admin  ·  Trusted write gate for mm_users + request tables  ·  Billware
// ----------------------------------------------------------------------------
// Companion to mm-login. Runs with the SERVICE ROLE key, so it is the only
// place allowed to write password hashes, approve accounts, or touch reset
// PINs. Once the accompanying SQL revokes those rights from anon/authenticated,
// every path that used to let a browser rewrite mm_users goes through here.
//
// Three trust tiers, checked per action:
//   public  — pre-login flows (reset request / reset complete). No caller
//             identity exists yet, so these are self-authenticating: the reset
//             PIN itself is the secret, and it never leaves the server.
//   user    — requires a valid Supabase Auth JWT (from mm-login). The caller's
//             tenant comes from `memberships`, never from the request body.
//   super   — requires the superadmin password, verified against the SA_PASSWORD
//             secret. It is NOT in client JS any more.
//
// Deploy with JWT verification DISABLED (public actions run pre-login; the
// user-tier actions verify the token themselves).
// Secret to set: SA_PASSWORD  (dashboard → Edge Functions → Secrets)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Standard SHA-256 → lowercase hex, UTF-8 in. Matches the client's _sha256().
async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Same synthetic email scheme mm-login uses, so the Auth user lines up.
async function emailFor(username: string): Promise<string> {
  const h = await sha256Hex(username.toLowerCase());
  return `u${h.slice(0, 24)}@users.billware.app`;
}

/**
 * Capability token handed out by `signup`, spent by `submit_shop_profile`.
 *
 * A brand-new owner fills in their shop details BEFORE the admin approves them,
 * so they have no session and no membership yet and RLS (rightly) refuses the
 * shop_profiles write. Only the service role can store it — but the endpoint
 * that does so must not be a free-for-all, or anyone could write a shop profile
 * for any pending username. This token is derived from the service-role key, so
 * only the server can produce it, and it is never stored: we just recompute and
 * compare. It reveals nothing about the key (one-way hash).
 */
async function setupTokenFor(username: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return await sha256Hex(`${username.toLowerCase()}|shop-setup|${secret}`);
}

// Constant-time-ish compare, so a wrong SA password can't be probed by timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

/** Resolve the caller's identity from their Bearer token. Never trust the body. */
async function callerFromToken(db: any, req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  // The anon key is a JWT too — reject it explicitly, it identifies nobody.
  if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: m } = await db
    .from("memberships").select("tenant_id, role, username").eq("auth_uid", data.user.id).maybeSingle();
  if (!m) return null;
  return { auth_uid: data.user.id, tenant: m.tenant_id, role: m.role, username: m.username };
}

/** Write a password everywhere it lives: mm_users + the linked Auth user. */
async function setPassword(db: any, row: any, newPassword: string) {
  const hash = await sha256Hex(newPassword);
  const { error } = await db.from("mm_users").update({ passwordHash: hash }).eq("id", row.id);
  if (error) throw new Error(error.message);
  // Keep the Auth user in sync so the next mm-login signInWithPassword succeeds.
  if (row.auth_uid) {
    await db.auth.admin.updateUserById(row.auth_uid, { password: newPassword }).catch(() => {});
  }
}

/**
 * Global lookup. Only safe where the username is genuinely global (login,
 * signup collision checks) — usernames are unique per TENANT, not per system,
 * so two shops can each have a "Sanjai".
 */
async function findUser(db: any, username: string) {
  const uname = String(username || "").trim();
  if (!uname) return null;
  const { data } = await db.from("mm_users").select("*").ilike("username", uname);
  return (data || []).find((u: any) => (u.username || "").toLowerCase() === uname.toLowerCase()) || null;
}

/**
 * Usernames are globally unique by policy (see sql/04_unique_usernames.sql).
 * That is what keeps login unambiguous and keeps emailFor() — which derives a
 * user's Supabase Auth identity from the username — collision-free. Every path
 * that creates or renames a user must call this; a gap in any one of them puts
 * two same-named users back in the database.
 *
 * `exceptId` lets a rename keep its own name.
 */
async function usernameTaken(db: any, username: string, exceptId?: string) {
  const uname = String(username || "").trim();
  if (!uname) return true;
  const { data } = await db.from("mm_users").select("id,username").ilike("username", uname);
  return (data || []).some(
    (u: any) => (u.username || "").toLowerCase() === uname.toLowerCase() && u.id !== exceptId,
  );
}

const TAKEN_MSG =
  "That username is already taken. Usernames must be unique across all shops, so please pick a different one.";

/**
 * Tenant-scoped lookup — use this for anything acting ON a user. Resolving by
 * bare username would pick whichever shop's row came back first and could act
 * on a different shop entirely.
 */
async function findUserInTenant(db: any, username: string, tenant: string) {
  const uname = String(username || "").trim();
  if (!uname || !tenant) return null;
  const { data } = await db.from("mm_users").select("*").eq("tenant_id", tenant);
  const hit = (data || []).find((u: any) => (u.username || "").toLowerCase() === uname.toLowerCase());
  if (hit) return hit;
  // Legacy owner rows predate tenant_id being filled in: the owner's own
  // username was the tenant.
  if (uname.toLowerCase() === String(tenant).toLowerCase()) {
    const { data: legacy } = await db.from("mm_users").select("*").ilike("username", uname);
    return (legacy || []).find(
      (u: any) => (u.username || "").toLowerCase() === uname.toLowerCase() &&
                  (u.tenant_id === tenant || !u.tenant_id),
    ) || null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const db = admin();

    // ── Tier: super ─────────────────────────────────────────────────────────
    // Every sa_* action carries the superadmin password; it is compared against
    // a server secret. Nothing about it is inspectable from the browser.
    if (action.startsWith("sa_")) {
      const expected = Deno.env.get("SA_PASSWORD") || "";
      if (!expected) return json({ error: "Superadmin not configured." }, 500);
      if (!safeEqual(String(body.sa_password || ""), expected)) {
        return json({ error: "Invalid superadmin credentials." }, 401);
      }

      switch (action) {
        case "sa_login":
          return json({ ok: true });

        case "sa_list": {
          // The superadmin dashboard spans every tenant, so all of this must be
          // read with the service role: the browser's key is subject to RLS and
          // returns nothing at all across shops. Only the columns the page
          // actually renders are selected — never passwordHash, never pin.
          const [users, extra, resets, bills, purchases, customers, medicines, shops, ocr] =
            await Promise.all([
              db.from("mm_users")
                .select("id,username,role,tenant_id,createdAt,approval_status,payment_status,active_session_token,auth_uid"),
              db.from("extra_user_requests")
                .select("id,tenant_id,requested_username,reason,status,created_at,reviewed_at"),
              db.from("password_reset_requests").select("id,username,reason,status,created_at"),
              // Ordered newest-first: the activity feed slices the top 60 and
              // does no sorting of its own.
              db.from("bills")
                .select("id,user_id,date,grand_total,bill_no,customer_name,doctor_name")
                .order("saved_at", { ascending: false }),
              db.from("purchases").select("user_id"),
              db.from("customers").select("user_id"),
              db.from("medicines").select("name,user_id"),
              db.from("shop_profiles").select("*"),
              /* EVERY CLOUD SCAN IS BILLED TO US, so this is the one table that
                 turns into a conversation with a shop. One row per scan; the
                 dashboard groups it per tenant.

                 Raw rows rather than a server-side aggregate because PostgREST
                 cannot GROUP BY, and at the current scale (a 60/day cap per
                 shop) the volume is small. If this ever gets heavy, replace it
                 with a SQL view — the client only needs user_id, day and the
                 token counts, so the shape can stay identical. */
              db.from("ocr_usage")
                .select("user_id,day,lines,input_tokens,output_tokens,model")
                .order("day", { ascending: false })
                .limit(20000),
            ]);
          return json({
            users: users.data || [],
            extra: extra.data || [],
            resets: resets.data || [],
            bills: bills.data || [],
            purchases: purchases.data || [],
            customers: customers.data || [],
            medicines: medicines.data || [],
            shops: shops.data || [],
            ocr: ocr.data || [],
          });
        }

        /* ── SALES INSIGHTS ────────────────────────────────────────────────
           Which medicine sells most, per shop / pincode / district / state,
           and how that moves with the season.

           ⚠️ THIS ONE DOES NOT FOLLOW THE sa_list PATTERN, ON PURPOSE.
           Every other action here ships raw rows and lets the browser group
           them. That works for scans because cloud OCR is capped at 60/day per
           shop. Sales have no cap: one shop with a year of billing is tens of
           thousands of bill_items, so sending them all to superadmin.html to be
           counted in JavaScript would fail — slowly and confusingly — somewhere
           around the fifth customer. PostgREST cannot GROUP BY, so the roll-up
           lives in SQL (migrations/add_sales_analytics.sql) and what comes back
           here is already finished rows.

           Requires that migration. Without it every call returns a clear
           "not installed yet" rather than an empty table that looks like a shop
           with no sales. */
        case "sa_analytics": {
          const LEVELS = ["shop", "pincode", "district", "state", "month", "season", "all"];
          const level = LEVELS.includes(String(body.level)) ? String(body.level) : "shop";
          // Rupee value is the default ranking, not units: one till types a
          // strip of 10 as qty 1 and another types it as qty 10, so quantity is
          // not comparable ACROSS shops. Value is.
          const by = String(body.by) === "qty" ? "qty" : "value";
          const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 50);
          const from = body.from ? String(body.from).slice(0, 10) : null;
          const to = body.to ? String(body.to).slice(0, 10) : null;

          const [leaders, coverage] = await Promise.all([
            db.rpc("mm_sa_product_leaders", {
              p_from: from, p_to: to, p_level: level, p_by: by, p_limit: limit,
            }),
            db.rpc("mm_sa_coverage"),
          ]);
          if (leaders.error || coverage.error) {
            const msg = String(leaders.error?.message || coverage.error?.message || "");
            if (/does not exist|schema cache|PGRST202/i.test(msg)) {
              return json({
                error: "Sales analytics is not installed on the database yet. " +
                       "Run migrations/add_sales_analytics.sql in the Supabase SQL editor.",
              }, 501);
            }
            return json({ error: msg }, 400);
          }
          return json({
            leaders: leaders.data || [],
            coverage: coverage.data || [],
            level, by, from, to, limit,
          });
        }

        /* One medicine, month by month — the drill-down behind a leaderboard
           row. Takes the NORMALISED key the leaderboard returned, not the
           display name: the display name is whichever spelling happened to be
           most common, and looking it up again would re-split the product. */
        case "sa_product_trend": {
          const key = String(body.product_norm || "").trim();
          if (!key) return json({ error: "Missing product." }, 400);
          const { data, error } = await db.rpc("mm_sa_product_trend", {
            p_product_norm: key,
            p_from: body.from ? String(body.from).slice(0, 10) : null,
            p_to: body.to ? String(body.to).slice(0, 10) : null,
          });
          if (error) {
            if (/does not exist|schema cache|PGRST202/i.test(String(error.message))) {
              return json({ error: "Run migrations/add_sales_analytics.sql first." }, 501);
            }
            return json({ error: error.message }, 400);
          }
          return json({ trend: data || [], product_norm: key });
        }

        case "sa_list_requests": {
          // shop_edit_requests / customer_issues / mm_announcements / shop_billing
          // are per-tenant tables under RLS (see migrations/fix_cross_account_leaks.sql).
          // The dashboard used to read them with the browser's publishable key,
          // which only worked because they had no RLS at all — i.e. they were
          // world-readable. They are read here instead, with the service role.
          const [edits, issues, anns, billing] = await Promise.all([
            db.from("shop_edit_requests").select("*").order("created_at", { ascending: false }),
            db.from("customer_issues").select("*").order("created_at", { ascending: false }),
            db.from("mm_announcements").select("*").order("created_at", { ascending: false }),
            db.from("shop_billing").select("*"),
          ]);
          return json({
            edits: edits.data || [],
            issues: issues.data || [],
            announcements: anns.data || [],
            billing: billing.data || [],
          });
        }

        case "sa_review_edit_request": {
          const status = String(body.status || "");
          if (!["approved", "rejected", "used"].includes(status)) {
            return json({ error: "Invalid status." }, 400);
          }
          const patch: Record<string, unknown> = { status };
          if (status !== "used") patch.reviewed_at = new Date().toISOString();
          const { error } = await db.from("shop_edit_requests").update(patch).eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_resolve_issue": {
          const { error } = await db.from("customer_issues")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_post_announcement": {
          const { error } = await db.from("mm_announcements").insert({
            title: String(body.title || ""),
            message: String(body.message || ""),
            icon: String(body.icon || "📢"),
            target_user: body.target_user || null,
          });
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_delete_announcement": {
          const { error } = await db.from("mm_announcements").delete().eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_save_billing": {
          const row = body.row || {};
          if (!row.username) return json({ error: "Missing username." }, 400);
          const { error } = await db.from("shop_billing").upsert(row, { onConflict: "username" });
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_set_approval": {
          const { error } = await db.from("mm_users")
            .update({ approval_status: body.status }).eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_set_payment": {
          const { error } = await db.from("mm_users")
            .update({ payment_status: body.status }).eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_delete_user": {
          const { data: row } = await db.from("mm_users").select("auth_uid").eq("id", body.id).maybeSingle();
          if (row?.auth_uid) await db.auth.admin.deleteUser(row.auth_uid).catch(() => {});
          const { error } = await db.from("mm_users").delete().eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_approve_extra_user": {
          // The hash stays server-side: read it here rather than round-tripping
          // it through the superadmin's browser the way the old flow did.
          const { data: rq } = await db.from("extra_user_requests")
            .select("*").eq("id", body.id).maybeSingle();
          if (!rq) return json({ error: "Request not found." }, 404);
          if (rq.status !== "pending") return json({ error: "Already reviewed." }, 409);

          // Re-check at approval time, not just when the request was filed: the
          // name may have been claimed by another shop in between. Without this
          // the upsert below would happily create a duplicate.
          if (await usernameTaken(db, rq.requested_username)) {
            return json({
              error: `"${rq.requested_username}" has been taken since this request was made. ` +
                     `Ask the shop to request a different username.`,
            }, 409);
          }

          const userId = `${rq.tenant_id}:${rq.requested_username}`;
          const { error: uErr } = await db.from("mm_users").upsert({
            id: userId,
            username: rq.requested_username,
            passwordHash: rq.password_hash,
            role: "worker",
            tenant_id: rq.tenant_id,
            createdAt: Date.now(),
            approval_status: "approved",
          }, { onConflict: "id" });
          if (uErr) return json({ error: uErr.message }, 400);

          await db.from("extra_user_requests")
            .update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", body.id);
          return json({ ok: true });
        }

        case "sa_reject_extra_user": {
          const { error } = await db.from("extra_user_requests")
            .update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }

        case "sa_approve_reset": {
          // PIN is generated server-side and returned ONLY to the authenticated
          // superadmin, for out-of-band delivery. It is never readable from the
          // table by anyone else.
          const buf = new Uint32Array(1);
          crypto.getRandomValues(buf);
          const pin = (100000 + (buf[0] % 900000)).toString();
          const { error } = await db.from("password_reset_requests")
            .update({ status: "approved", pin }).eq("id", body.id).eq("status", "pending");
          if (error) return json({ error: error.message }, 400);
          return json({ ok: true, pin });
        }

        case "sa_reject_reset": {
          const { error } = await db.from("password_reset_requests")
            .update({ status: "rejected", pin: null }).eq("id", body.id);
          return error ? json({ error: error.message }, 400) : json({ ok: true });
        }
      }
      return json({ error: "Unknown action." }, 400);
    }

    // ── Tier: public (pre-login) ────────────────────────────────────────────
    if (action === "signup") {
      // Owner self-registration. Shape is fixed here rather than taken from the
      // body: a signup can only ever create a PENDING owner of its own tenant,
      // which is what stops someone registering themselves into another shop.
      const uname = String(body.username || "").trim();
      const password = String(body.password || "");
      if (uname.length < 3 || password.length < 4) return json({ error: "Invalid username or password." }, 400);

      if (await usernameTaken(db, uname)) return json({ error: TAKEN_MSG }, 409);
      const { error } = await db.from("mm_users").insert({
        id: `${uname}:${uname}`,
        username: uname,
        passwordHash: await sha256Hex(password),
        role: "owner",
        tenant_id: uname,
        createdAt: Date.now(),
        approval_status: "pending",
        payment_status: "unpaid",
      });
      if (error) return json({ error: error.message }, 400);

      // shop_profiles is under RLS and the signer has no session yet, so this
      // has to happen here with the service role.
      const s = body.shopInfo;
      if (s && s.shopName) {
        await db.from("shop_profiles").upsert({
          user_id: uname,
          shop_name: s.shopName,
          phone: s.phone || "",
          address_line1: s.addressLine1 || "",
          address_line2: s.addressLine2 || "",
          dl_no: s.dlNo || "",
          gstin: s.gstin || "",
        });
      }
      // The shop-details form is a separate page that runs straight after this,
      // still pre-approval. Hand it a token so it can store the profile too.
      return json({ ok: true, pending: true, setup_token: await setupTokenFor(uname) });
    }

    if (action === "submit_shop_profile") {
      // Pre-approval shop details. Guarded three ways: the caller must hold a
      // token only this server can mint, the account must exist, and it must
      // still be PENDING — an approved shop goes through RLS + the edit-request
      // flow instead, so this can never be used to rewrite a live shop.
      const uname = String(body.username || "").trim();
      const token = String(body.token || "");
      const s = body.shopInfo || {};
      if (!uname || !token) return json({ error: "Missing details." }, 400);
      if (!safeEqual(token, await setupTokenFor(uname))) {
        return json({ error: "Invalid setup token." }, 401);
      }
      const row = await findUser(db, uname);
      if (!row) return json({ error: "Account not found." }, 404);
      if (row.approval_status !== "pending") {
        return json({ error: "This shop is already approved. Request an edit instead." }, 409);
      }
      // ⚠️ This list is hand-written, so anything missing from it is dropped in
      // SILENCE — and this is the ONLY path a brand-new shop's details travel
      // down, because setup runs before approval. Two were missing:
      //   · city / pincode. v299 added them as their own fields precisely
      //     because an e-invoice and an e-way bill cannot be built from one
      //     free-text address line — and then every pre-approval shop lost
      //     them here anyway. The owner could not put them back either: the
      //     profile is a one-time wizard and editing needs an approved
      //     shop_edit_requests row.
      //   · linked_shop, which is only ever ASKED at first-time setup.
      // Same family as restoreFromBin dropping paymentMode, then the khata
      // balance, then savedAt, then customerId. Add the column here whenever
      // one is added to the form.
      const { error } = await db.from("shop_profiles").upsert({
        user_id: row.username,
        shop_name: s.shop_name || "",
        phone: s.phone || "",
        address_line1: s.address_line1 || "",
        address_line2: s.address_line2 || "",
        city: s.city || "",
        pincode: s.pincode || "",
        // Added with the Insights tab. city cannot group a report (free text)
        // and pincode cannot be read by a human, so district/state are their
        // own confirmed fields — suggested from the pincode and the GSTIN state
        // code by js/geo-india.js, chosen by the shop. Listed HERE because this
        // is still the only path a pre-approval shop's details travel down.
        district: s.district || "",
        state: s.state || "",
        dl_no: s.dl_no || "",
        gstin: s.gstin || "",
        invoice_prefix: s.invoice_prefix || "",
        terms: s.terms || "",
        footer_msg: s.footer_msg || "",
        linked_shop: s.linked_shop || "",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    if (action === "reset_request") {
      const uname = String(body.username || "").trim();
      const reason = String(body.reason || "").trim();
      if (!uname || !reason) return json({ error: "Missing username or reason." }, 400);
      // Always report success: whether a username exists is not public info.
      const row = await findUser(db, uname);
      if (row) {
        await db.from("password_reset_requests")
          .insert({ username: row.username, reason, status: "pending" });
      }
      return json({ ok: true });
    }

    if (action === "reset_complete") {
      const uname = String(body.username || "").trim();
      const pin = String(body.pin || "").trim();
      const newPassword = String(body.newPassword || "");
      if (!uname || !pin || !newPassword) return json({ error: "Missing details." }, 400);
      if (newPassword.length < 4) return json({ error: "Password too short." }, 400);

      const { data: reqs } = await db.from("password_reset_requests")
        .select("*").ilike("username", uname).eq("status", "approved");
      const hit = (reqs || []).find((r: any) => r.pin && safeEqual(String(r.pin), pin));
      if (!hit) return json({ error: "Invalid or expired PIN." }, 401);

      // PINs are single-use and time-boxed; an approved row is not a standing key.
      const ageMs = Date.now() - new Date(hit.created_at).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        await db.from("password_reset_requests")
          .update({ status: "rejected", pin: null }).eq("id", hit.id);
        return json({ error: "This PIN has expired. Please request a new reset." }, 401);
      }

      const row = await findUser(db, uname);
      if (!row) return json({ error: "Invalid or expired PIN." }, 401);
      await setPassword(db, row, newPassword);
      await db.from("password_reset_requests")
        .update({ status: "completed", pin: null }).eq("id", hit.id);
      return json({ ok: true });
    }

    // ── Tier: user (valid Supabase Auth JWT required) ───────────────────────
    const me = await callerFromToken(db, req);
    if (!me) return json({ error: "Not authenticated." }, 401);

    if (action === "change_password") {
      const target = String(body.username || me.username).trim();
      // Scoped to the caller's tenant: another shop may have a user by the same
      // name, and a bare-username lookup could land on theirs.
      const row = await findUserInTenant(db, target, me.tenant);
      if (!row) return json({ error: "User not found." }, 404);
      // You may change your own password; an owner may change passwords inside
      // their own tenant. Tenant comes from memberships, so it can't be spoofed.
      const isSelf = row.username.toLowerCase() === me.username.toLowerCase();
      if (!isSelf && me.role !== "owner") {
        return json({ error: "Not allowed." }, 403);
      }
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 4) return json({ error: "Password too short." }, 400);
      await setPassword(db, row, newPassword);
      return json({ ok: true });
    }

    if (action === "create_user") {
      if (me.role !== "owner") return json({ error: "Only owners can add users." }, 403);
      const uname = String(body.username || "").trim();
      const password = String(body.password || "");
      const role = body.role === "owner" ? "owner" : "worker";
      if (uname.length < 3 || password.length < 4) return json({ error: "Invalid username or password." }, 400);

      // Global, not per-tenant: a name taken by ANY shop is unavailable.
      if (await usernameTaken(db, uname)) return json({ error: TAKEN_MSG }, 409);
      const { error } = await db.from("mm_users").insert({
        id: `${me.tenant}:${uname}`,
        username: uname,
        passwordHash: await sha256Hex(password),
        role,
        tenant_id: me.tenant,
        createdAt: Date.now(),
        approval_status: "approved",
      });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    if (action === "extra_user_request") {
      const uname = String(body.username || "").trim();
      const password = String(body.password || "");
      const reason = String(body.reason || "").trim();
      if (uname.length < 3 || password.length < 4 || !reason) return json({ error: "Invalid request." }, 400);
      // Fail here rather than letting the superadmin discover it at approval.
      if (await usernameTaken(db, uname)) return json({ error: TAKEN_MSG }, 409);
      const { error } = await db.from("extra_user_requests").insert({
        tenant_id: me.tenant,               // from memberships, not the body
        requested_username: uname,
        password_hash: await sha256Hex(password),
        reason,
        status: "pending",
        created_at: new Date().toISOString(),
      });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    if (action === "rename_user") {
      const oldName = String(body.oldUsername || "").trim();
      const newName = String(body.newUsername || "").trim();
      if (newName.length < 3) return json({ error: "Username must be at least 3 characters." }, 400);
      const row = await findUserInTenant(db, oldName, me.tenant);
      if (!row) return json({ error: "User not found." }, 404);
      const isSelf = row.username.toLowerCase() === me.username.toLowerCase();
      if (!isSelf && me.role !== "owner") return json({ error: "Not allowed." }, 403);

      // Global check, excluding this user's own row so a no-op rename works.
      if (await usernameTaken(db, newName, row.id)) return json({ error: TAKEN_MSG }, 409);
      // mm-login signs in with emailFor(CURRENT username), so a rename must move
      // the linked Auth user's email too or the account becomes unreachable and
      // the user is locked out for good. Do this FIRST: if it fails we abort
      // with the rename un-done, rather than leaving the two out of sync.
      if (row.auth_uid) {
        const moved = await db.auth.admin.updateUserById(row.auth_uid, {
          email: await emailFor(newName),
          email_confirm: true,
        });
        if (moved.error) {
          return json({ error: `Could not rename: ${moved.error.message}` }, 500);
        }
      }

      const { error } = await db.from("mm_users")
        .update({ username: newName, id: `${row.tenant_id || newName}:${newName}` }).eq("id", row.id);
      if (error) {
        // Put the Auth email back so the user can still log in under the old name.
        if (row.auth_uid) {
          await db.auth.admin.updateUserById(row.auth_uid, {
            email: await emailFor(row.username),
            email_confirm: true,
          }).catch(() => {});
        }
        return json({ error: error.message }, 400);
      }
      await db.from("memberships").update({ username: newName }).eq("auth_uid", row.auth_uid || "");
      return json({ ok: true });
    }

    if (action === "delete_user") {
      if (me.role !== "owner") return json({ error: "Only owners can remove users." }, 403);
      const row = await findUserInTenant(db, String(body.username || ""), me.tenant);
      if (!row) return json({ error: "User not found in your store." }, 404);
      // Deleting your own row is only valid as part of deleting the whole
      // account (mmDeleteAccountPermanently), which says so explicitly.
      if (row.username.toLowerCase() === me.username.toLowerCase() && !body.allowSelf) {
        return json({ error: "You cannot remove yourself." }, 400);
      }
      if (row.auth_uid) await db.auth.admin.deleteUser(row.auth_uid).catch(() => {});
      const { error } = await db.from("mm_users").delete().eq("id", row.id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
