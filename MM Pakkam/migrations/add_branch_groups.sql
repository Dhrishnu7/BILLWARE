-- ════════════════════════════════════════════════════════════════════════════
-- MULTI-BRANCH · STEP 1 OF 6  —  "the safety change that changes nothing"
--
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query
-- → paste → Run). Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- WHAT THIS IS FOR
-- ────────────────
-- An owner with two shops currently needs two accounts that know nothing about
-- each other. The plan is to put both shops in a GROUP: they stay two separate
-- shops — each keeping its own drug licence, Schedule H register, GSTIN and
-- bill numbering — but the owner can see both together.
--
-- Everything about tenant isolation today rests on ONE function. Every one of
-- the ~24 per-shop tables carries `user_id text` and a policy reading:
--
--     using (user_id = current_tenant())        -- exact equality, one value
--
-- Multi-branch needs that to become "user_id IN (a set)". The moment equality
-- becomes set membership, THE SET IS THE SECURITY BOUNDARY. So this step does
-- nothing except build the machinery that will compute that set, prove it
-- returns exactly today's answer for every shop already live, and change
-- nothing else.
--
-- WHAT THIS STEP DOES **NOT** DO — deliberately
-- ─────────────────────────────────────────────
--   · It does NOT touch a single RLS policy.
--   · It does NOT widen any read. current_scope() is defined and tested here,
--     but no policy calls it yet.
--   · It does NOT change the memberships primary key. `mm-login` upserts that
--     table with onConflict:"auth_uid" (supabase/functions/mm-login/index.ts
--     line ~111). Dropping the single-column unique index would break EVERY
--     LOGIN. The composite key lands in Step 2, together with the Edge
--     Function change.
--   · It does NOT put a row in branches or branch_groups. They are created
--     empty on purpose — see the fallbacks below.
--
-- AFTER RUNNING THIS, RUN migrations/CHECK_branch_step1.sql.
-- If any row of that report says FAIL, stop and investigate before Step 2.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. The group layer ──────────────────────────────────────────────────────
-- A branch_id goes into the SAME `user_id` column every shop table already
-- uses. That is the whole trick: an existing shop becomes a group of one
-- branch whose branch_id IS its current tenant_id, so there is NOTHING to
-- backfill across 24 tables and no existing row moves.

create table if not exists public.branch_groups (
    group_id   text primary key,
    -- The human who owns the group. Kept as the username (text), matching
    -- how tenant_id is stored everywhere else in this schema.
    owner_user text not null,
    label      text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.branches (
    -- Goes into user_id on every data row. For a shop that exists today this
    -- equals its current tenant_id.
    branch_id  text primary key,
    group_id   text not null references public.branch_groups(group_id) on delete cascade,
    -- What the owner calls this shop: "Gandhipuram", "RS Puram".
    name       text not null default '',
    created_at timestamptz not null default now()
);

create index if not exists idx_branches_group on public.branches(group_id);


-- ── 2. Reading the branch claim WITHOUT ever throwing ───────────────────────
-- The active branch travels in the JWT, under app_metadata — NOT user_metadata,
-- which the client can write to. (This codebase has been bitten by trusting
-- user_metadata for RLS before; see sql/02_security_setup.sql.)
--
-- This is deliberately written against the underlying GUC rather than
-- auth.jwt(), with an exception block, because a function called from inside
-- an RLS policy must NEVER raise. A throw here would not "fail closed" — it
-- would error every query on every table for every shop.

create or replace function public.mm_branch_claim()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    c text;
begin
    begin
        c := nullif(current_setting('request.jwt.claims', true), '')::jsonb
                 -> 'app_metadata' ->> 'branch';
    exception when others then
        c := null;   -- no claims, malformed claims, service-role connection
    end;
    return c;
end;
$$;


-- ── 3. WHICH BRANCH AM I STANDING IN? ───────────────────────────────────────
-- Three cases, and the middle one is why nothing goes dark today.
--
--   1. A branch claim the caller genuinely holds a membership for. The claim
--      is never trusted on its own — it is checked against memberships, which
--      no client can write (sql/02_security_setup.sql grants it no insert,
--      update or delete policy; only the service role touches it).
--
--   2. No claim, but the caller belongs to exactly ONE tenant. ← THIS IS
--      EVERY SHOP ALIVE RIGHT NOW. Their sessions were minted before this
--      migration existed and carry no branch claim at all. Without this
--      branch of the CASE, running this file would blank every screen in
--      production the moment a policy started using it.
--
--   3. Several memberships and no valid claim: return NULL. Never guess.
--      A guessed branch would file a bill into the wrong shop's GST series.
--      NULL means every policy comparison is NULL, which denies — the correct
--      direction to fail in.

create or replace function public.current_branch()
returns text
language sql
stable
security definer
set search_path = public
as $$
    with claimed as (
        select public.mm_branch_claim() as b
    ),
    mine as (
        select tenant_id from public.memberships where auth_uid = auth.uid()
    )
    select case
        when (select b from claimed) is not null
         and exists (select 1 from mine where tenant_id = (select b from claimed))
            then (select b from claimed)
        when (select count(*) from mine) = 1
            then (select tenant_id from mine limit 1)
        else null::text
    end;
$$;


-- ── 4. WHAT AM I ALLOWED TO READ? ───────────────────────────────────────────
-- Returns an ARRAY of branch_ids. Nothing calls this yet — Step 3 will put it
-- behind a SELECT policy, at which point reads widen for a group owner and
-- writes stay pinned to current_branch(). Reads widen, writes never do.
--
-- Two fallbacks keep it equal to today's behaviour:
--   · Nobody has role 'group_owner' yet, so every caller takes the middle
--     branch and gets a one-element array — exactly current_tenant().
--   · A shop with no row in `branches` (i.e. every shop today) coalesces to
--     its own branch, so it can never be swept into somebody else's group.

create or replace function public.current_scope()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.current_branch() is null
            then array[]::text[]                         -- deny by default

        when not exists (
                select 1 from public.memberships
                 where auth_uid  = auth.uid()
                   and tenant_id = public.current_branch()
                   and role      = 'group_owner')
            then array[public.current_branch()]          -- one branch only

        else coalesce(
                (select array_agg(b2.branch_id)
                   from public.branches b1
                   join public.branches b2 on b2.group_id = b1.group_id
                  where b1.branch_id = public.current_branch()),
                array[public.current_branch()])          -- no group row = solo shop
    end;
$$;


-- ── 5. THE ONE-LINE SWAP THAT MAKES THIS STEP A NO-OP ───────────────────────
-- current_tenant() is what all ~24 existing policies call. It used to be:
--
--     select tenant_id from memberships where auth_uid = auth.uid()
--
-- Every user alive today has exactly one membership row, so current_branch()
-- takes case 2 above and returns precisely that same value. Same answer,
-- reached down a different path — which is exactly what CHECK_branch_step1.sql
-- asserts, per user, by executing both.
--
-- Keeping the old name as a thin delegate means Steps 2-6 never have to touch
-- 24 policies to change what "my tenant" means.

create or replace function public.current_tenant()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select public.current_branch();
$$;


-- ── 6. RLS on the two new tables ────────────────────────────────────────────
-- Read-only to clients, and only the rows you are actually part of. Writes are
-- service-role only (no insert/update/delete policy at all), the same shape as
-- memberships — because who is in which group is a security fact, not shop data.

-- ⚠️ The policy on `branches` cannot itself query `branches`, or Postgres
-- re-applies the same policy inside the subquery and raises
-- "infinite recursion detected in policy for relation branches".
-- The lookup therefore lives in a SECURITY DEFINER function: it runs as the
-- table owner, and a table owner is not subject to its own RLS (these tables
-- are not FORCE ROW LEVEL SECURITY), so the subquery resolves once and stops.

create or replace function public.mm_my_group_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(array_agg(distinct b.group_id), array[]::text[])
      from public.branches b
      join public.memberships m on m.tenant_id = b.branch_id
     where m.auth_uid = auth.uid();
$$;

alter table public.branch_groups enable row level security;
alter table public.branches      enable row level security;

grant select on public.branch_groups to anon, authenticated;
grant select on public.branches      to anon, authenticated;

drop policy if exists branches_self_select on public.branches;
create policy branches_self_select on public.branches
    for select
    using (group_id = any (public.mm_my_group_ids()));

drop policy if exists branch_groups_self_select on public.branch_groups;
create policy branch_groups_self_select on public.branch_groups
    for select
    using (group_id = any (public.mm_my_group_ids()));


-- ── 7. Sanity: these should be identical for every existing user ────────────
--   select current_tenant(), current_branch(), current_scope();
--
-- Then run migrations/CHECK_branch_step1.sql for the per-user proof.
