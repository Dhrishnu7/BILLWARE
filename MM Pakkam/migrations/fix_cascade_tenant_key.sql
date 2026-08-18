-- ============================================================================
-- fix_cascade_tenant_key.sql
-- The store-delete cascade was looking up the wrong tenant.
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL editor. Idempotent — CREATE OR REPLACE throughout.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
-- add_delete_store_cascade.sql resolved the shop to erase as:
--
--     tenant text := OLD.username;   -- "an owner's username == their tenant key"
--
-- That comment is an assumption, and it is not guaranteed. Every per-shop table
-- is keyed on TENANT_ID. `username` is a label that can move: mm-admin's
-- rename_user updates username and id and deliberately leaves tenant_id alone
-- (correctly — the data key must not move when someone changes their name). The
-- moment those two differ, this trigger deletes the wrong thing:
--
--   · at best it finds nothing, and the deleted shop's data survives in full
--   · at worst another tenant happens to be named like the departing owner's
--     new username, and THAT shop's data is erased instead
--
-- ── HOW IT WAS FOUND (2026-08-18) ──────────────────────────────────────────
-- The new Insights tab showed a card for "niga store" — a shop absent from the
-- Accounts list. Tenant `SanjaiSuba`: 3 bills, 2 doctors, a shop_profile, a
-- shop_edit_request, 2 password_reset_requests, and an APPROVED WORKER LOGIN
-- (`lkjh`) all still present after the owner was deleted.
--
-- The proof that this was the tenant lookup and not a missing trigger: the
-- cascade's final statement is `delete from mm_users where tenant_id = $1`, and
-- the worker row with tenant_id = 'SanjaiSuba' was still there. The trigger was
-- installed and enabled. It ran; it just ran against the wrong key.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- Resolve the tenant the same way every other query in the system does:
--     coalesce(OLD.tenant_id, OLD.username)
-- The coalesce matters — legacy owner rows predate tenant_id being populated,
-- and for those the username genuinely WAS the tenant.
-- ============================================================================

create or replace function public.cascade_delete_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t      text;
  -- ⚠️ tenant_id FIRST. This used to read OLD.username, which is a display name
  -- that rename_user is free to move; tenant_id is the key the data is filed
  -- under. Falling back to username covers legacy rows created before tenant_id
  -- was populated, where the username really was the tenant.
  tenant text := coalesce(nullif(btrim(OLD.tenant_id), ''), OLD.username);
  tbls   text[] := array[
    -- business data
    'bills','purchases','customers','medicines','doctors','shop_profiles',
    'schedule_h_register','schedule_h_drugs','schedule_x_drugs','barcodes',
    'supplier_payments','customer_payments','audit_log','suppliers',
    'reorder_levels','promise_orders','prescriptions','stock_adjustments','expenses',
    'till_counts','finance_accounts','finance_entries','staff',
    'bank_reconciliations','customer_balance_ops',
    -- ⚠️ This array is the SQL half of js/tenant-data.js, which cannot be read
    -- from here. When you add a dataset there, add its table here too —
    -- mmTenantData.tables() prints the list to compare against.
    -- this shop's own request/queue rows
    'shop_edit_requests','extra_user_requests','password_reset_requests',
    'customer_issues'
  ];
begin
  -- Only wipe the shop when an OWNER (or a top account with no role) is removed.
  -- Workers share the owner's tenant, so deleting a worker must NOT erase data.
  if OLD.role is distinct from 'worker' then

    -- Bill line items first (they FK to bills).
    if to_regclass('public.bill_items') is not null
       and to_regclass('public.bills') is not null then
      execute 'delete from public.bill_items where bill_id in '
           || '(select id from public.bills where user_id = $1)' using tenant;
    end if;

    /* ⚠️ THE TYPE GUARD — `and data_type in ('text','character varying')`.
       Without it this loop built `delete from public.staff where user_id = $1`
       with a TEXT tenant, and staff.user_id is a UUID (it references
       auth.users(id), unlike every other per-shop table which keys on the text
       tenant name). Postgres refused with 42883 "operator does not exist:
       uuid = text", and because this trigger is BEFORE DELETE the exception
       aborted the WHOLE delete — so from v357 onwards, deleting ANY shop from
       superadmin failed outright rather than leaking.

       Matching on column NAME alone was the mistake: `user_id` is a name, not a
       contract. Any future table that keys on the auth uid would have silently
       re-broken every shop deletion. Tables skipped here are handled
       explicitly below. */
    foreach t in array tbls loop
      if to_regclass('public.' || t) is null then
        continue;                                        -- table not created yet
      end if;
      if exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = t and column_name = 'user_id'
                   and data_type in ('text', 'character varying')) then
        execute format('delete from public.%I where user_id = $1', t) using tenant;
      elsif exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = t and column_name = 'username'
                   and data_type in ('text', 'character varying')) then
        execute format('delete from public.%I where username = $1', t) using tenant;
      end if;
    end loop;

    /* STAFF — the one table the loop above deliberately skips.
       It is keyed on the AUTH uid, so it has to be reached through this
       tenant's logins rather than by the tenant name. auth_uid is cast because
       mm_users stores it as text while staff holds a real uuid.

       There is a safety net underneath this: staff.user_id is
       REFERENCES auth.users(id) ON DELETE CASCADE, and mm-admin's
       sa_delete_user removes the Auth user before deleting the mm_users row.
       This statement covers the cases that net misses — a worker whose
       mm_users row is removed by the loop below without its Auth user going
       too, and any row whose Auth user outlived it.

       Wrapped so it can NEVER abort the delete. That is the whole lesson of
       this bug: no single table's cleanup is worth blocking a shop deletion.
       It is the last thing attempted, so nothing after it can be skipped. */
    if to_regclass('public.staff') is not null then
      begin
        execute 'delete from public.staff where user_id in ('
             || '  select u.auth_uid::uuid from public.mm_users u'
             || '   where coalesce(nullif(btrim(u.tenant_id), ''''), u.username) = $1'
             || '     and u.auth_uid is not null)' using tenant;
      exception when others then
        raise warning 'cascade_delete_store: staff cleanup skipped for tenant % (%)', tenant, sqlerrm;
      end;
    end if;

    /* Queue rows are filed under the USERNAME of whoever raised them, not under
       the tenant, so the loop above misses an owner whose name has moved. Catch
       them explicitly. Harmless when username = tenant — it just deletes the
       same rows twice over. */
    if OLD.username is not null and OLD.username <> tenant then
      foreach t in array array['password_reset_requests','customer_issues'] loop
        if to_regclass('public.' || t) is not null
           and exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = t and column_name = 'username') then
          execute format('delete from public.%I where username = $1', t) using OLD.username;
        end if;
      end loop;
    end if;

    -- Remove this owner's worker sub-accounts (their logins go too).
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'mm_users' and column_name = 'tenant_id') then
      execute 'delete from public.mm_users where tenant_id = $1 and id <> $2'
        using tenant, OLD.id;
    end if;

  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_cascade_delete_store on public.mm_users;
create trigger trg_cascade_delete_store
  before delete on public.mm_users
  for each row execute function public.cascade_delete_store();


-- ── FIND EVERY ORPHAN, NOT JUST THE ONE WE TRIPPED OVER ────────────────────
-- Read-only. Any tenant listed here has data in the database but no owner
-- account. Run it AFTER applying the fix above — the fix stops new orphans, it
-- does not clean up old ones.
--
-- EXPECT after cleanup: zero rows.

select b.user_id                                          as orphan_tenant,
       coalesce(sp.shop_name, '(no profile)')             as shop_name,
       count(distinct b.id)                               as bills,
       round(coalesce(sum(b.grand_total), 0)::numeric, 2) as revenue,
       (select count(*) from public.mm_users mu
         where mu.tenant_id = b.user_id)                  as logins_still_active
  from public.bills b
  left join public.shop_profiles sp on sp.user_id = b.user_id
 where not exists (
        select 1 from public.mm_users u
         where coalesce(nullif(btrim(u.tenant_id), ''), u.username) = b.user_id
           and u.role is distinct from 'worker')
 group by b.user_id, sp.shop_name
 order by bills desc;
