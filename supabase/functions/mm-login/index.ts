// ============================================================================
// mm-login  ·  Secure login + lazy migration Edge Function  ·  Billware
// ----------------------------------------------------------------------------
// This runs on Supabase's servers with the SERVICE ROLE key (never shipped to
// the browser). It is the trusted gate that makes tenant isolation real:
//
//   1. Verifies the username + password against the legacy `mm_users` table
//      (same SHA-256 the old client used) — so only someone who knows the real
//      password passes. An attacker who scraped the password *hash* cannot.
//   2. Ensures a matching Supabase Auth user exists (creates it on first login,
//      keeps its password in sync with mm_users afterwards).
//   3. Records the user's tenant in `memberships` (the anchor RLS trusts).
//   4. Returns a real Supabase Auth session to the browser.
//
// Deploy with JWT verification DISABLED (login happens before a user has a token).
// Uses the SUPABASE_* env vars that Edge Functions provide automatically — no
// secrets to configure.
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

// Standard SHA-256 → lowercase hex, UTF-8 input. Matches the client's _sha256().
async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A deterministic, valid, unique synthetic email for a username (login is
// username-only; Supabase Auth needs an email). Not shown to users.
async function emailFor(username: string): Promise<string> {
  const h = await sha256Hex(username.toLowerCase());
  return `u${h.slice(0, 24)}@users.billware.app`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { username, password } = await req.json().catch(() => ({}));
    if (!username || !password) return json({ error: "Missing username or password." }, 400);

    const URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

    // 1) Verify credentials against the legacy user table.
    const uname = String(username).trim();
    const { data: users, error: uErr } = await admin
      .from("mm_users").select("*").ilike("username", uname);
    if (uErr) return json({ error: "Login temporarily unavailable." }, 500);
    const row = (users || []).find(
      (u: any) => (u.username || "").toLowerCase() === uname.toLowerCase(),
    );
    if (!row) return json({ error: "Invalid username or password." }, 401);

    const hash = await sha256Hex(password);
    if (row.passwordHash !== hash) return json({ error: "Invalid username or password." }, 401);

    if (row.approval_status === "pending") {
      return json({ error: "Your account is pending approval." }, 403);
    }
    if (row.approval_status === "rejected") {
      return json({ error: "Your account request was rejected." }, 403);
    }

    const tenant = row.tenant_id || row.username;
    const role = row.role || "owner";
    const email = await emailFor(row.username);

    // 2) Ensure a Supabase Auth user exists, with the current password.
    let authUid: string | undefined = row.auth_uid || undefined;
    if (authUid) {
      await admin.auth.admin.updateUserById(authUid, { password });
    } else {
      const created = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { username: row.username },
      });
      authUid = created.data?.user?.id;
      if (!authUid) {
        // Auth user already existed from a partial run → find it by paging.
        for (let page = 1; page <= 50 && !authUid; page++) {
          const list = await admin.auth.admin.listUsers({ page, perPage: 200 });
          const hit = list.data?.users?.find((u: any) => u.email === email);
          if (hit) authUid = hit.id;
          if (!list.data?.users?.length) break;
        }
        if (authUid) await admin.auth.admin.updateUserById(authUid, { password });
      }
      if (!authUid) return json({ error: "Could not provision account." }, 500);
      await admin.from("mm_users").update({ auth_uid: authUid }).eq("username", row.username);
    }

    // 3) Anchor the tenant mapping RLS trusts.
    await admin.from("memberships").upsert(
      { auth_uid: authUid, tenant_id: tenant, role, username: row.username },
      { onConflict: "auth_uid" },
    );

    // 4) Mint a real Supabase Auth session for the browser.
    const pub = createClient(URL, ANON, { auth: { persistSession: false } });
    const signIn = await pub.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data?.session) {
      return json({ error: "Could not establish session." }, 500);
    }

    return json({
      access_token: signIn.data.session.access_token,
      refresh_token: signIn.data.session.refresh_token,
      tenant, role,
      username: row.username,
      approval_status: row.approval_status ?? null,
      payment_status: row.payment_status ?? null,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
