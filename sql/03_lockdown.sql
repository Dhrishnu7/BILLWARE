-- ============================================================================
-- 03_lockdown.sql  ·  Phase 5 · Close the account-takeover holes
-- ----------------------------------------------------------------------------
-- WHAT THIS FIXES (all three verified exploitable on 2026-07-17 with nothing
-- but the publishable key that ships in js/supabase.js):
--
--   1. anon could UPDATE mm_users.passwordHash for ANY user  → log in as them.
--      (Phase 4 revoked SELECT on the hash but never revoked UPDATE.)
--   2. anon could INSERT into mm_users with tenant_id of an existing shop and
--      approval_status 'approved' → mm-login then builds a membership from that
--      tenant_id → full RLS-blessed access to that shop's data.
--   3. anon could read AND write password_reset_requests, including the
--      plaintext PIN column → approve your own reset, or read a live PIN.
--
-- ORDER MATTERS. Do NOT run this until BOTH are true:
--   (a) the mm-admin Edge Function is deployed with the SA_PASSWORD secret set,
--   (b) the updated client (auth.js / login.html / superadmin.html /
--       manage-users.html / js/supabase.js) is live on mybillware.web.app.
-- Running it early breaks signup, password change and the superadmin page,
-- because those still write these tables directly from the browser today.
--
-- Rollback for every section is at the bottom of this file.
-- ============================================================================

begin;

-- ── 1 · mm_users: browsers may no longer write it ───────────────────────────
-- The one exception is active_session_token: js/auth.js claims it with the
-- publishable key BEFORE it has an Auth session (single-device enforcement),
-- so that single column stays writable. It holds no secret — worst case an
-- attacker logs someone else out.
revoke insert, update, delete on public.mm_users from anon, authenticated;
grant  update (active_session_token) on public.mm_users to anon, authenticated;

-- mm-admin / mm-login act as service_role and must keep full access.
grant all on public.mm_users to service_role;

-- ── 2 · password_reset_requests: server-only, no exceptions ─────────────────
-- Nothing in the browser needs this table any more. The PIN is generated,
-- verified and cleared entirely inside mm-admin.
revoke all on public.password_reset_requests from anon, authenticated;
grant  all on public.password_reset_requests to service_role;

alter table public.password_reset_requests enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'password_reset_requests'
  loop
    execute format('drop policy if exists %I on public.password_reset_requests', p.policyname);
  end loop;
end $$;

-- ── 3 · extra_user_requests: hide the hash, keep the tenant's own history ───
-- index.html shows a shop its own approved/rejected requests, so authenticated
-- users keep SELECT — but only on the columns that carry no secret, and only
-- for their own tenant. password_hash is not in the grant list, so it is
-- unreadable and unfilterable from any browser.
revoke all on public.extra_user_requests from anon, authenticated;
grant  select (id, tenant_id, requested_username, reason, status, created_at, reviewed_at)
  on public.extra_user_requests to authenticated;
grant  all on public.extra_user_requests to service_role;

alter table public.extra_user_requests enable row level security;
do $$
declare p record;
begin
  -- Drops the pre-existing "Allow all" policy (see superadmin.html:791), which
  -- would otherwise OR itself together with the tenant policy and win.
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'extra_user_requests'
  loop
    execute format('drop policy if exists %I on public.extra_user_requests', p.policyname);
  end loop;
end $$;

create policy tenant_read on public.extra_user_requests
  for select to authenticated
  using (tenant_id = public.current_tenant());

commit;

-- ============================================================================
-- VERIFY  (run after; each should behave as described)
-- ============================================================================
-- From PowerShell/curl with ONLY the publishable key (no Bearer user token):
--
--   PATCH /rest/v1/mm_users?username=eq.<any>   {"passwordHash":"x"}
--     → 401 permission denied            (was 204 = takeover)
--   POST  /rest/v1/mm_users               {...}
--     → 401 permission denied            (was allowed = tenant hijack)
--   GET   /rest/v1/password_reset_requests?select=*
--     → 401 permission denied            (was 200 with plaintext PINs)
--   GET   /rest/v1/extra_user_requests?select=password_hash
--     → 401 permission denied            (was 200 with hashes)
--   PATCH /rest/v1/mm_users?id=eq.<real>  {"active_session_token":"x"}
--     → 204                              (single-device claim still works)
--
-- Then in the live app: log in, change a password, run a forgot-password
-- reset end to end, and open the superadmin page. All must work.

-- ============================================================================
-- ROLLBACK  (restores the pre-lockdown behaviour exactly)
-- ============================================================================
-- grant insert, update, delete on public.mm_users to anon, authenticated;
-- grant all on public.password_reset_requests to anon, authenticated;
-- alter table public.password_reset_requests disable row level security;
-- grant all on public.extra_user_requests to anon, authenticated;
-- drop policy if exists tenant_read on public.extra_user_requests;
-- create policy "Allow all" on public.extra_user_requests for all using (true) with check (true);
