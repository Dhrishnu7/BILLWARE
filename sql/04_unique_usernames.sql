-- ============================================================================
-- 04_unique_usernames.sql  ·  Make usernames globally unique
-- ----------------------------------------------------------------------------
-- WHY: usernames were only unique per-shop, but three things identify a user by
-- bare username and cannot tell two apart:
--   * mm-login picks the first matching row and checks the password against it,
--     so of two same-named users only ONE could ever log in.
--   * emailFor(username) derives each user's Supabase Auth identity from the
--     username alone. Two same-named users collapse onto ONE auth user, and
--     `memberships` is keyed on that auth_uid -- which is what RLS trusts. The
--     second login would overwrite the first's tenant mapping and hand them the
--     other shop's data.
--   * The forgot-password flow resolves by username.
-- Global uniqueness removes all three at once: one username == one person.
--
-- mm-admin enforces this in every create/rename path, but application checks
-- race (two signups can both pass the check, then both insert). This index is
-- the actual guarantee.
--
-- Verified 2026-07-17: zero duplicates existed at the time of writing, so this
-- applies cleanly. If it ever errors, see the pre-flight query below.
-- ============================================================================

-- ── PRE-FLIGHT: run this FIRST. It must return zero rows. ───────────────────
-- If it returns anything, the CREATE INDEX below will fail. Rename the losers
-- (keep the oldest / the owner) via the superadmin page before proceeding.
select lower(username) as clashing_name,
       count(*)        as how_many,
       array_agg(id)   as row_ids
from public.mm_users
group by lower(username)
having count(*) > 1;

-- ── THE CONSTRAINT ─────────────────────────────────────────────────────────
-- lower() so "Sanjai" and "sanjai" are the same name -- matching the
-- case-insensitive comparison mm-admin and mm-login both use.
create unique index if not exists mm_users_username_unique_ci
  on public.mm_users (lower(username));

-- ============================================================================
-- VERIFY
--   Adding a worker whose name exists in ANY shop -> 409 with the "taken across
--   all shops" message, from the app. A direct duplicate insert -> 23505
--   unique_violation from Postgres.
--
-- ROLLBACK
--   drop index if exists public.mm_users_username_unique_ci;
-- ============================================================================
