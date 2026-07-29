-- ============================================================================
-- CROSS-ACCOUNT LEAK FIX  ·  run this ONCE in the Supabase SQL editor
-- ----------------------------------------------------------------------------
-- Four tables were still readable (and two of them WRITABLE) by anybody holding
-- the publishable key — which is public, it ships inside the website. Verified
-- against the live database on 2026-07-29 with an anonymous request:
--
--   prescriptions        · RLS OFF  -> every shop's patient prescriptions,
--                                      doctor names and photo URLs downloadable
--                                      by anyone. This is patient health data.
--   shop_edit_requests   · RLS OFF  -> every shop's name + edit reasons readable
--   customer_issues      · RLS OFF  -> every shop's complaints readable
--   mm_announcements     · insert/delete granted to anon -> ANY stranger could
--                                      post a fake "system message" into every
--                                      pharmacy's Inbox, or delete real ones.
--                                      Targeted messages were also downloaded by
--                                      every shop and only hidden in the browser.
--   shop_billing         · RLS OFF  -> every shop's subscription/payment state
--
-- Until now the app hid all of this by filtering in JavaScript (.eq('user_id',…)).
-- A filter in the browser is a display choice, not a security boundary — the
-- same row set was one plain HTTP request away. These policies move the boundary
-- into the database, where the browser cannot talk its way past it.
--
-- The Super Admin page loses its direct reads of these tables (it is not a
-- tenant, so the policies exclude it). That is intentional: those reads move to
-- the mm-admin Edge Function, which runs with the service role and bypasses RLS.
-- DEPLOY THE UPDATED supabase/functions/mm-admin/index.ts AT THE SAME TIME AS
-- THIS SQL, or the Super Admin dashboard will show empty request lists.
--
-- Safe to re-run — every statement is idempotent.
-- ============================================================================


-- ── 1. PRESCRIPTIONS (patient data — the most sensitive table in the app) ────
grant select, insert, update, delete on public.prescriptions to anon, authenticated;

alter table public.prescriptions enable row level security;

drop policy if exists tenant_rw          on public.prescriptions;
drop policy if exists "Enable all"       on public.prescriptions;
drop policy if exists "Allow all"        on public.prescriptions;
create policy tenant_rw on public.prescriptions
    for all
    using (user_id = public.current_tenant())
    with check (user_id = public.current_tenant());


-- ── 2. PRESCRIPTION PHOTOS (Storage) ────────────────────────────────────────
-- The old policies allowed ANY caller to read, overwrite, or DELETE any object
-- in the bucket — one anonymous request could have erased every pharmacy's
-- prescription photos. Scope every operation to the caller's own folder, which
-- is exactly the `<tenant>/<rx_id>.jpg` layout dbUploadPrescriptionImage writes.
--
-- NOTE: the bucket stays public=true because the app renders photos straight
-- from getPublicUrl() in an <img>. Public means "readable if you know the exact
-- URL"; after this change nobody can LIST the bucket to discover those URLs, and
-- nobody can write or delete outside their own folder. Moving to signed URLs
-- would close the last gap and is worth doing next.
drop policy if exists "rx read"   on storage.objects;
drop policy if exists "rx insert" on storage.objects;
drop policy if exists "rx update" on storage.objects;
drop policy if exists "rx delete" on storage.objects;

create policy "rx read" on storage.objects
    for select using (
        bucket_id = 'prescriptions'
        and (storage.foldername(name))[1] = public.current_tenant()
    );

create policy "rx insert" on storage.objects
    for insert with check (
        bucket_id = 'prescriptions'
        and (storage.foldername(name))[1] = public.current_tenant()
    );

create policy "rx update" on storage.objects
    for update using (
        bucket_id = 'prescriptions'
        and (storage.foldername(name))[1] = public.current_tenant()
    ) with check (
        bucket_id = 'prescriptions'
        and (storage.foldername(name))[1] = public.current_tenant()
    );

create policy "rx delete" on storage.objects
    for delete using (
        bucket_id = 'prescriptions'
        and (storage.foldername(name))[1] = public.current_tenant()
    );


-- ── 3. SHOP EDIT REQUESTS ───────────────────────────────────────────────────
-- A shop may file and read its own requests. Only the Super Admin reviews them,
-- and it now does that through mm-admin (service role), so no anon policy.
grant select, insert on public.shop_edit_requests to anon, authenticated;
revoke update, delete on public.shop_edit_requests from anon, authenticated;

alter table public.shop_edit_requests enable row level security;

drop policy if exists "Allow all"      on public.shop_edit_requests;
drop policy if exists "Enable all"     on public.shop_edit_requests;
drop policy if exists edit_req_all     on public.shop_edit_requests;
drop policy if exists tenant_read      on public.shop_edit_requests;
drop policy if exists tenant_insert    on public.shop_edit_requests;

create policy tenant_read on public.shop_edit_requests
    for select using (user_id = public.current_tenant());

create policy tenant_insert on public.shop_edit_requests
    for insert with check (user_id = public.current_tenant());


-- ── 4. CUSTOMER ISSUES (support messages) ───────────────────────────────────
grant select, insert on public.customer_issues to anon, authenticated;
revoke update, delete on public.customer_issues from anon, authenticated;

alter table public.customer_issues enable row level security;

drop policy if exists "Allow all"   on public.customer_issues;
drop policy if exists "Enable all"  on public.customer_issues;
drop policy if exists tenant_read   on public.customer_issues;
drop policy if exists tenant_insert on public.customer_issues;

create policy tenant_read on public.customer_issues
    for select using (tenant_id = public.current_tenant());

create policy tenant_insert on public.customer_issues
    for insert with check (tenant_id = public.current_tenant());


-- ── 5. ANNOUNCEMENTS ────────────────────────────────────────────────────────
-- Read: broadcasts (target_user is null) + messages addressed to this shop.
--       A message meant for one pharmacy no longer travels to all of them.
-- Write: taken away from the browser entirely — only mm-admin posts/deletes.
revoke insert, update, delete on public.mm_announcements from anon, authenticated;
grant select on public.mm_announcements to anon, authenticated;

alter table public.mm_announcements enable row level security;

drop policy if exists announcements_read   on public.mm_announcements;
drop policy if exists announcements_write  on public.mm_announcements;
drop policy if exists announcements_delete on public.mm_announcements;

create policy announcements_read on public.mm_announcements
    for select using (
        target_user is null
        or target_user = public.current_tenant()
    );


-- ── 6. SHOP BILLING (subscription state) ────────────────────────────────────
-- Nothing in the shop-facing app reads this; it is a Super Admin table. Lock it
-- to the service role by enabling RLS and granting no policy at all.
revoke select, insert, update, delete on public.shop_billing from anon, authenticated;

alter table public.shop_billing enable row level security;

drop policy if exists "Allow all"  on public.shop_billing;
drop policy if exists "Enable all" on public.shop_billing;
drop policy if exists billing_all  on public.shop_billing;


-- ── 7. Verify ───────────────────────────────────────────────────────────────
-- Every row below must show rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('prescriptions','shop_edit_requests','customer_issues',
                  'mm_announcements','shop_billing')
order by relname;
