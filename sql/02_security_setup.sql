-- ============================================================================
-- 02_security_setup.sql   ·   Billware / MM Pakkam
-- THE SECURITY BACKBONE (Row-Level Security / tenant isolation).
--
-- ⚠️  DO **NOT** RUN THIS UNTIL THE AUTH CUTOVER STEP.
--     Once RLS is enabled, requests that do NOT carry a logged-in Supabase Auth
--     session (i.e. the old anon-key-only app) will see NO data. You must first
--     deploy the `mm-login` Edge Function and switch the client login to it, so
--     every request is authenticated. See SECURITY_MIGRATION.md for the order.
--
--     Everything here is REVERSIBLE:  `alter table <t> disable row level security;`
-- ============================================================================

-- ── 1. Membership map: which Supabase Auth user belongs to which tenant ──
--    tenant_id = the owner's username (data rows are stored with user_id = this).
--    Rows are created ONLY by the mm-login Edge Function (service role), after it
--    verifies the user's real password against mm_users. Clients can never write here.
create table if not exists memberships (
  auth_uid   uuid primary key references auth.users(id) on delete cascade,
  tenant_id  text not null,
  role       text not null default 'worker',
  username   text,
  created_at timestamptz default now()
);
create index if not exists idx_memberships_tenant on memberships(tenant_id);

-- The mm-login Edge Function caches each user's Supabase Auth id here so it can
-- keep the auth password in sync with mm_users on every login (safe/additive).
alter table if exists mm_users add column if not exists auth_uid uuid;

alter table memberships enable row level security;
drop policy if exists mem_self_select on memberships;
create policy mem_self_select on memberships
  for select using (auth_uid = auth.uid());
-- (no insert/update/delete policy → only the service role can modify it)

-- ── 2. Trusted helper: the tenant of the current request ──
create or replace function current_tenant()
returns text
language sql stable security definer set search_path = public as $$
  select tenant_id from memberships where auth_uid = auth.uid()
$$;

-- ── 3. Enable RLS + tenant policy on every table scoped by user_id ──
do $$
declare t text;
begin
  foreach t in array array[
    'customers','doctors','medicines','purchases','bills',
    'stock_adjustments','promise_orders','schedule_h_drugs',
    'schedule_h_register','shop_profiles'
  ]
  loop
    execute format('alter table if exists %I enable row level security;', t);
    execute format('drop policy if exists tenant_rw on %I;', t);
    execute format($f$
      create policy tenant_rw on %I
        for all
        using      (user_id = current_tenant())
        with check (user_id = current_tenant());
    $f$, t);
  end loop;
end $$;

-- ── 4. bill_items has no user_id → scope it through its parent bill ──
alter table if exists bill_items enable row level security;
drop policy if exists tenant_rw on bill_items;
create policy tenant_rw on bill_items
  for all
  using      (exists (select 1 from bills b where b.id = bill_items.bill_id and b.user_id = current_tenant()))
  with check (exists (select 1 from bills b where b.id = bill_items.bill_id and b.user_id = current_tenant()));

-- ── 5. Sanity check (run these after; each should return only YOUR rows once
--       logged in through the new auth, and 0 rows when called anonymously):
--   select count(*) from customers;
--   select tenant_id from memberships where auth_uid = auth.uid();

-- NOTE: mm_users, password_reset_requests, customer_issues, extra_user_requests
--       are handled in a follow-up (03_*) once user-management is moved behind
--       Edge Functions — do NOT lock mm_users here or user management/login breaks.
