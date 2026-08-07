-- FULL STORE DELETE — when the Super Admin deletes a shop's OWNER account, this
-- trigger erases every piece of that shop's data across all tables and removes
-- their worker logins, all in one shot on the server (service-role, bypasses
-- RLS). The owner row deletion itself blocks their login. Deleting a WORKER
-- account never wipes the shop (workers just share the owner's tenant).
--
-- It is DYNAMIC: any table a migration hasn't created yet is skipped, and each
-- table is matched on whichever of (user_id / username) it actually has — so it
-- is safe to run now and keeps working as you add tables.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Safe to re-run — idempotent.

create or replace function public.cascade_delete_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t      text;
  tenant text := OLD.username;              -- an owner's username == their tenant key
  tbls   text[] := array[
    -- business data
    'bills','purchases','customers','medicines','doctors','shop_profiles',
    'schedule_h_register','schedule_h_drugs','schedule_x_drugs','barcodes',
    'supplier_payments','customer_payments','audit_log','suppliers',
    'reorder_levels','promise_orders','prescriptions','stock_adjustments','expenses',
    -- till_counts was added in v322 and never registered here, so a deleted
    -- shop left its cash counts behind; finance_* arrived with Phase 2c.
    'till_counts','finance_accounts','finance_entries',
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

    foreach t in array tbls loop
      if to_regclass('public.' || t) is null then
        continue;                                        -- table not created yet
      end if;
      if exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = t and column_name = 'user_id') then
        execute format('delete from public.%I where user_id = $1', t) using tenant;
      elsif exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = t and column_name = 'username') then
        execute format('delete from public.%I where username = $1', t) using tenant;
      end if;
    end loop;

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
