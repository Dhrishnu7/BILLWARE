-- ════════════════════════════════════════════════════════════════════════════
-- MULTI-BRANCH · STEP 1 VERIFICATION
--
-- Proves that add_branch_groups.sql changed NOTHING for any shop already live.
--
-- This does not read the migration and agree with it. It EXECUTES
-- current_tenant() once per real user, impersonating each of them, and
-- compares the answer against a value derived from a DIFFERENT table
-- (mm_users) down a DIFFERENT path. Two independent witnesses, or it is not
-- a check — it is a restatement.
--
--   PART A   per-user proof + the control that impersonation is real
--   PART B   the assumptions Step 1 rests on
--   PART C   the deny-by-default branch, proven by making it fire (rolled back)
--
-- RUN EACH PART SEPARATELY. Paste one part, Run, read the grid, then the next.
-- Part C ends in ROLLBACK and writes its result to the Messages/Notices tab.
-- ════════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PART A — every existing user still resolves to exactly the same tenant   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- The probe MUST be VOLATILE. current_branch() takes no arguments and is
-- STABLE, so the planner is entitled to evaluate it ONCE for the whole
-- statement and hand every row the same answer — which would make this report
-- all-green while testing exactly one user. A volatile function is evaluated
-- per row and never folded, and each plpgsql statement inside it is a fresh
-- SPI execution, so the GUC set on the line above is the one that is read.
create or replace function public.mm_step1_probe(p_uid uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    r text;
begin
    perform set_config('request.jwt.claims',
                       json_build_object('sub', p_uid)::text,
                       true);          -- transaction-local, never persisted
    select public.current_tenant() into r;
    return r;
end;
$$;

with probe as (
    select
        m.username,
        m.auth_uid,
        m.tenant_id                              as witness_memberships,
        -- INDEPENDENT WITNESS: mm_users is a different table, written by a
        -- different code path (mm-login derives memberships.tenant_id from
        -- this row, so if the two ever disagree that is a real finding and
        -- not a test artefact).
        coalesce(nullif(u.tenant_id, ''), u.username) as witness_mm_users,
        public.mm_step1_probe(m.auth_uid)        as current_tenant_returns
      from public.memberships m
      left join public.mm_users u
             on lower(u.username) = lower(m.username)
)
select
    username,
    witness_memberships,
    witness_mm_users,
    current_tenant_returns,
    case
        when current_tenant_returns is null                      then 'FAIL · returned NULL'
        when current_tenant_returns <> witness_memberships       then 'FAIL · moved tenant'
        when witness_mm_users is null                            then 'PASS · (no mm_users row to cross-check)'
        when current_tenant_returns <> witness_mm_users          then 'FAIL · disagrees with mm_users'
        else 'PASS'
    end as verdict
  from probe
 order by verdict desc, username;

-- ── The control. ───────────────────────────────────────────────────────────
-- If impersonation silently did nothing, every row above would carry the SAME
-- tenant and still say PASS for whichever user happened to be resolved. This
-- asserts the probe genuinely varies per user: the number of DISTINCT answers
-- must equal the number of distinct tenants in memberships.
--
-- On a database with only ONE tenant this cannot discriminate, and it says so
-- rather than claiming a pass it did not earn.
select
    count(distinct public.mm_step1_probe(m.auth_uid)) as distinct_answers,
    count(distinct m.tenant_id)                       as distinct_tenants,
    case
        when count(distinct m.tenant_id) < 2
            then 'INCONCLUSIVE · only one tenant exists, the probe cannot be shown to vary'
        when count(distinct public.mm_step1_probe(m.auth_uid)) = count(distinct m.tenant_id)
            then 'PASS · the probe really does resolve per user'
        else 'FAIL · impersonation is not working, PART A above proves nothing'
    end as verdict
  from public.memberships m;

drop function if exists public.mm_step1_probe(uuid);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PART B — the assumptions Step 1 rests on                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

select 'every user has exactly one membership'  as assumption,
       count(*)                                  as violations,
       case when count(*) = 0 then 'PASS'
            else 'FAIL · current_branch() case 2 will not fire for these users'
       end                                       as verdict
  from (select auth_uid from public.memberships
         group by auth_uid having count(*) > 1) x

union all

-- mm-login upserts memberships with onConflict:"auth_uid", which REQUIRES a
-- single-column unique index on that column. If Step 2 ever drops it without
-- replacing the Edge Function call, every login in production fails.
select 'memberships still has a single-column unique index on auth_uid',
       (select count(*)
          from pg_index i
          join pg_class     c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
         where n.nspname   = 'public'
           and c.relname   = 'memberships'
           and i.indisunique
           and i.indnatts  = 1
           and a.attname   = 'auth_uid'),
       case when (select count(*)
                    from pg_index i
                    join pg_class     c on c.oid = i.indrelid
                    join pg_namespace n on n.oid = c.relnamespace
                    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
                   where n.nspname  = 'public'
                     and c.relname  = 'memberships'
                     and i.indisunique
                     and i.indnatts = 1
                     and a.attname  = 'auth_uid') > 0
            then 'PASS · mm-login''s onConflict:auth_uid upsert still works'
            else 'FAIL · LOGIN IS BROKEN — restore the unique index now' end

union all

select 'branches table is still empty',
       (select count(*) from public.branches),
       case when (select count(*) from public.branches) = 0 then 'PASS'
            else 'INFO · a group exists; Step 1 is no longer the whole story' end

union all

select 'branch_groups table is still empty',
       (select count(*) from public.branch_groups),
       case when (select count(*) from public.branch_groups) = 0 then 'PASS'
            else 'INFO · a group exists; Step 1 is no longer the whole story' end

union all

select 'nobody holds the group_owner role yet',
       (select count(*) from public.memberships where role = 'group_owner'),
       case when (select count(*) from public.memberships where role = 'group_owner') = 0
            then 'PASS · current_scope() returns one branch for everyone'
            else 'INFO · someone can already read across a group' end

union all

select 'no RLS policy references current_scope() yet',
       (select count(*) from pg_policies
         where schemaname = 'public'
           and (coalesce(qual, '') || coalesce(with_check, '')) like '%current_scope%'),
       case when (select count(*) from pg_policies
                   where schemaname = 'public'
                     and (coalesce(qual, '') || coalesce(with_check, '')) like '%current_scope%') = 0
            then 'PASS · reads have not been widened'
            else 'INFO · Step 3 has begun' end;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PART C — prove the deny branch by MAKING IT FIRE, then roll back         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- current_branch() returns NULL when a user has several memberships and no
-- valid branch claim. Today that branch is unreachable, because the primary
-- key permits only one membership per user — so it would ship untested.
--
-- Here we drop the key inside a transaction, give one real user a second
-- membership, and check that the answer becomes NULL rather than one of the
-- two tenants picked arbitrarily. Then ROLLBACK puts everything back.
-- Nothing below survives the transaction. Read the Messages / Notices tab.

begin;

create or replace function public.mm_step1_probe(p_uid uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare r text;
begin
    perform set_config('request.jwt.claims',
                       json_build_object('sub', p_uid)::text, true);
    select public.current_tenant() into r;
    return r;
end;
$$;

do $$
declare
    v_uid    uuid;
    v_name   text;
    v_pk     text;
    v_before text;
    v_after  text;
begin
    select auth_uid, username into v_uid, v_name
      from public.memberships
     order by created_at nulls last
     limit 1;

    if v_uid is null then
        raise notice 'SKIPPED · there are no memberships to probe.';
        return;
    end if;

    -- CONTROL: it must return a real tenant before we do anything, or a NULL
    -- afterwards would prove nothing at all.
    v_before := public.mm_step1_probe(v_uid);

    -- Look the key up rather than assuming it is called memberships_pkey.
    select conname into v_pk
      from pg_constraint
     where conrelid = 'public.memberships'::regclass
       and contype  = 'p';

    if v_pk is null then
        raise notice 'SKIPPED · memberships has no primary key to drop.';
        return;
    end if;

    execute format('alter table public.memberships drop constraint %I', v_pk);
    insert into public.memberships (auth_uid, tenant_id, role, username)
    values (v_uid, '__mm_step1_probe_branch__', 'worker', v_name);

    v_after := public.mm_step1_probe(v_uid);

    raise notice '───────────────────────────────────────────────';
    raise notice 'user under test        : %', v_name;
    raise notice 'CONTROL, one membership: % (must NOT be null)', coalesce(v_before, '<null>');
    raise notice 'with two memberships   : % (must be null)',     coalesce(v_after,  '<null>');

    if v_before is null then
        raise notice 'VERDICT: FAIL · the control failed. This user resolved to nothing';
        raise notice '         even before the second membership, so nothing was tested.';
    elsif v_after is null then
        raise notice 'VERDICT: PASS · two memberships and no claim denies, never guesses.';
    else
        raise notice 'VERDICT: FAIL · it picked "%" out of two. A guessed branch would', v_after;
        raise notice '         file a bill into the wrong shop''s GST series.';
    end if;
    raise notice '───────────────────────────────────────────────';
end;
$$;

rollback;

-- Belt and braces: the probe was created inside the transaction above and died
-- with the rollback, but if you ran the parts out of order, this removes it.
drop function if exists public.mm_step1_probe(uuid);
