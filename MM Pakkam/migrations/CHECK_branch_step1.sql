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
),
-- The verdict is computed in its own CTE so the ORDER BY below can sort on it.
-- Postgres accepts a bare output alias in ORDER BY but NOT an alias inside an
-- expression, so `order by (verdict like 'FAIL%')` against the select list
-- errors with 42703 "column verdict does not exist".
judged as (
    select
        username,
        witness_memberships,
        witness_mm_users,
        current_tenant_returns,
        case
            when current_tenant_returns is null                 then 'FAIL · returned NULL'
            when current_tenant_returns <> witness_memberships  then 'FAIL · moved tenant'
            when witness_mm_users is null                       then 'PASS · (no mm_users row to cross-check)'
            when current_tenant_returns <> witness_mm_users     then 'FAIL · disagrees with mm_users'
            else 'PASS'
        end as verdict
      from probe
),
-- ── The control, in the SAME result grid. ──────────────────────────────────
-- If impersonation silently did nothing, every user row would carry the SAME
-- tenant and still say PASS for whichever user happened to be resolved. This
-- asserts the probe genuinely varies: the number of DISTINCT answers must
-- equal the number of distinct tenants in memberships.
--
-- On a database with only ONE tenant it cannot discriminate, and it says so
-- rather than claiming a pass it did not earn.
--
-- It is UNIONed onto the per-user rows on purpose. The Supabase SQL editor
-- only shows the LAST statement's grid, so a control run as a second
-- statement would silently replace the table it is meant to qualify.
control as (
    select count(distinct public.mm_step1_probe(m.auth_uid)) as answers,
           count(distinct m.tenant_id)                       as tenants
      from public.memberships m
)
select row_type, username, witness_memberships, witness_mm_users,
       current_tenant_returns, verdict
  from (
        select 1 as ord,
               case when verdict like 'FAIL%' then 0 else 1 end as sub,
               'user'::text as row_type,
               username, witness_memberships, witness_mm_users,
               current_tenant_returns, verdict
          from judged

        union all

        select 2, 0, 'CONTROL'::text,
               'distinct answers = ' || answers::text,
               'distinct tenants = ' || tenants::text,
               null::text,
               null::text,
               case
                   when tenants < 2
                       then 'INCONCLUSIVE · only one tenant exists, the probe cannot be shown to vary'
                   when answers = tenants
                       then 'PASS · the probe really does resolve per user'
                   else 'FAIL · impersonation is not working, the rows above prove nothing'
               end
          from control
       ) z
 -- failures float to the top, the control sits last.
 order by ord, sub, username;

-- NOTE: mm_step1_probe is deliberately NOT dropped here. A trailing DROP would
-- be the last statement, and the editor shows the last statement's result — so
-- the grid above would be replaced by an empty one. It is dropped after PART C.


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
-- Here we drop the key, give one real user a second membership, and check the
-- answer becomes NULL rather than one of the two tenants picked arbitrarily.
--
-- ⚠️ THIS RETURNS A ROW, NOT A NOTICE — on purpose. The first version of this
-- part wrote its verdict with RAISE NOTICE and ended in `rollback;`. The
-- editor reported "Success" either way, because a notice never fails a query:
-- a FAIL verdict would have looked exactly like a PASS. Do not go back to it.

create or replace function public.mm_step1_denytest()
returns text
language plpgsql
volatile
as $$
declare
    v_uid    uuid;
    v_name   text;
    v_pk     text;
    v_before text;
    v_after  text;
    v_msg    text;
begin
    select auth_uid, username into v_uid, v_name
      from public.memberships
     order by created_at nulls last
     limit 1;

    if v_uid is null then return 'SKIPPED · no memberships to probe'; end if;

    -- A BEGIN..EXCEPTION block is a SUBTRANSACTION. Raising at the end of it
    -- unwinds everything inside — including the DDL — while the message
    -- survives in sqlerrm. That is how this returns a grid and still undoes
    -- itself, with no trailing `rollback;` anyone can forget to run.
    begin
        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_uid)::text, true);
        -- CONTROL: it must resolve to a real tenant here, or a NULL further
        -- down would prove nothing at all.
        v_before := public.current_tenant();

        -- Look the key up rather than assuming it is called memberships_pkey.
        select conname into v_pk
          from pg_constraint
         where conrelid = 'public.memberships'::regclass
           and contype  = 'p';

        if v_pk is null then
            raise exception using errcode = 'ZZ001',
                  message = 'SKIPPED · memberships has no primary key to drop';
        end if;

        execute format('alter table public.memberships drop constraint %I', v_pk);
        insert into public.memberships (auth_uid, tenant_id, role, username)
        values (v_uid, '__mm_step1_probe_branch__', 'worker', v_name);

        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_uid)::text, true);
        v_after := public.current_tenant();

        v_msg := format('user=%s | ONE membership=%s | TWO memberships=%s | %s',
                 v_name,
                 coalesce(v_before, '<null>'),
                 coalesce(v_after,  '<null>'),
                 case
                     when v_before is null
                         then 'FAIL · the control failed, nothing was tested'
                     when v_after is null
                         then 'PASS · denies, never guesses'
                     else 'FAIL · it guessed ' || v_after ||
                          ' — a guessed branch files a bill into the wrong shop''s GST series'
                 end);

        raise exception using errcode = 'ZZ001', message = v_msg;
    exception when sqlstate 'ZZ001' then
        return sqlerrm;
    end;
end;
$$;

select public.mm_step1_denytest() as part_c_result;


-- ── Cleanup + proof the rollback took. Run AFTER reading the row above. ─────
--   drop function if exists public.mm_step1_probe(uuid);
--   drop function if exists public.mm_step1_denytest();
--
--   select 'primary key restored' as check,
--          (select count(*) from pg_constraint
--            where conrelid = 'public.memberships'::regclass and contype = 'p')::text,
--          case when (select count(*) from pg_constraint
--                      where conrelid = 'public.memberships'::regclass
--                        and contype = 'p') = 1
--               then 'PASS' else 'FAIL · RESTORE IT NOW, LOGIN IS BROKEN' end
--   union all
--   select 'no probe row survived',
--          (select count(*) from public.memberships
--            where tenant_id = '__mm_step1_probe_branch__')::text,
--          case when (select count(*) from public.memberships
--                      where tenant_id = '__mm_step1_probe_branch__') = 0
--               then 'PASS' else 'FAIL · delete that row' end;


-- ════════════════════════════════════════════════════════════════════════════
-- RESULT — run 2026-08-15 against production, all green
--   A  4 users (Dhrishnu, Lavanya D, Natri, susan) all PASS; control PASS
--      with 4 distinct answers for 4 distinct tenants, so each row really was
--      resolved separately rather than one answer copied down the grid.
--   B  all six assumptions PASS.
--   C  susan → 'susan' with one membership, <null> with two. PASS.
--   Cleanup: primary key restored, no probe row survived, functions dropped.
-- ════════════════════════════════════════════════════════════════════════════
