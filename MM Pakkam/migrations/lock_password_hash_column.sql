-- ============================================================
-- Lock the password-hash column of mm_users to the SERVER only
-- ------------------------------------------------------------
-- WHY: anyone with the public key could read every user's username +
-- password hash straight out of mm_users. The app no longer reads that
-- column in the browser (login is verified by the mm-login Edge Function,
-- which uses the service role). This removes the hash column from the
-- browser roles so it can no longer be scraped. Login, signup, the admin
-- panel and session checks keep working — they only use the safe columns.
--
-- NOTE: a plain `REVOKE SELECT ("passwordHash")` is NOT enough, because a
-- table-wide "SELECT on all columns" grant overrides it. The correct pattern
-- is: revoke the table-wide SELECT, then grant SELECT on only the safe
-- columns. That is what this does.
--
-- ⚠️ RUN ONLY AFTER confirming login works on the live site with the updated
--    code. Rollback is at the bottom if anything breaks.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- ============================================================

-- 1) Make sure the trusted server role keeps full access (mm-login uses it).
GRANT SELECT ON public.mm_users TO service_role;

-- 2) Remove the browser roles' blanket "read all columns" access.
REVOKE SELECT ON public.mm_users FROM anon, authenticated;

-- 3) Re-grant SELECT on ONLY the non-secret columns (everything except the
--    password hash). "createdAt" is mixed-case so it must stay quoted.
GRANT SELECT (
    id, username, role, tenant_id, "createdAt",
    approval_status, payment_status, active_session_token, auth_uid
) ON public.mm_users TO anon, authenticated;

-- Verify (optional): as an anonymous request, selecting passwordHash should now
-- FAIL with "permission denied for column passwordHash", while selecting the
-- safe columns still works.

-- ============================================================
-- ROLLBACK (only if login/app breaks and you need the old behaviour back):
--   GRANT SELECT ON public.mm_users TO anon, authenticated;
-- ============================================================
