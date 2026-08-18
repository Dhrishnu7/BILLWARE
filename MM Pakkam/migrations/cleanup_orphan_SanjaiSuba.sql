-- ============================================================================
-- cleanup_orphan_SanjaiSuba.sql   ·   ONE-TIME, DESTRUCTIVE
-- ----------------------------------------------------------------------------
-- Removes the data left behind by tenant `SanjaiSuba` ("niga store") when its
-- owner was deleted and the cascade searched under the wrong key.
-- See fix_cascade_tenant_key.sql — RUN THAT FIRST or this will leak again.
--
-- ⚠️ RUN THE THREE BLOCKS SEPARATELY, in order. The Supabase SQL editor only
-- shows the LAST statement's result, so pasting all three at once hides the
-- before-snapshot and the auth_uid you need to write down.
--
-- ── WHY IT DOES NOT HAND-DELETE FROM SIX TABLES ────────────────────────────
-- Because that is how the gap appeared in the first place: a hand-written list
-- of tables that fell behind the schema. Instead this promotes the leftover
-- worker row (which already carries tenant_id = 'SanjaiSuba') to owner and
-- deletes it, so the REAL trigger performs the wipe. Two things follow:
--   · every table in the trigger's array is covered, including ones added later
--   · the cleanup is itself a live test of the fix. If anything survives block
--     3, the fix is wrong and we learn it now rather than at the next deletion.
--
-- No INSERT is needed, which avoids guessing NOT NULL columns and avoids
-- claiming a username that must be globally unique.
-- ============================================================================


-- ── BLOCK 1 · BEFORE — run this on its own and KEEP THE OUTPUT ─────────────
-- The auth_uid matters: this trigger deletes mm_users rows, NOT Supabase Auth
-- users. Once the row is gone, mm-login cannot resolve the account and the
-- login is dead — but the Auth user lingers in the dashboard. Write the uid
-- down now, or you will not be able to find it afterwards.

-- Kept to ONE table on purpose. An earlier draft union-ed these with row counts
-- from six other tables, which meant casting auth_uid (a uuid) to text to line
-- the columns up — extra machinery in the one query whose entire job is to hand
-- you a uid you cannot recover afterwards. The counts are already known from
-- the blast-radius query; this is the part that is genuinely one-way.

select id, username, role, tenant_id, approval_status,
       auth_uid as copy_this_uid_before_running_block_2
  from public.mm_users
 where tenant_id = 'SanjaiSuba';


-- ── BLOCK 2 · THE CLEANUP — run this on its own ───────────────────────────
-- Wrapped in a transaction: if the delete fails for any reason, the promotion
-- to owner is rolled back too, rather than leaving a worker sitting there with
-- owner rights.

begin;

  -- Promote the leftover worker so the cascade will act on it. A worker delete
  -- deliberately wipes nothing (workers share the owner's tenant), which is why
  -- this row could not simply be deleted as-is.
  update public.mm_users
     set role = 'owner'
   where id = 'SanjaiSuba:lkjh' and tenant_id = 'SanjaiSuba';

  -- Deleting it fires trg_cascade_delete_store, which now resolves the tenant
  -- from tenant_id and erases everything filed under 'SanjaiSuba'.
  delete from public.mm_users
   where id = 'SanjaiSuba:lkjh' and tenant_id = 'SanjaiSuba';

commit;


-- ── BLOCK 3 · AFTER — run this on its own ─────────────────────────────────
-- EXPECT: every `rows_left` = 0, and `orphan_tenants` = 0.
-- Any non-zero row means the trigger still missed that table — say so, do not
-- delete it by hand, because it means the array is short and the NEXT shop
-- deletion will leak the same table.

select 'mm_users'                as tbl, count(*) as rows_left from public.mm_users                where tenant_id = 'SanjaiSuba'
union all select 'bills',                   count(*) from public.bills                   where user_id  = 'SanjaiSuba'
union all select 'doctors',                 count(*) from public.doctors                 where user_id  = 'SanjaiSuba'
union all select 'shop_profiles',           count(*) from public.shop_profiles           where user_id  = 'SanjaiSuba'
union all select 'shop_edit_requests',      count(*) from public.shop_edit_requests      where user_id  = 'SanjaiSuba'
union all select 'password_reset_requests', count(*) from public.password_reset_requests where username = 'SanjaiSuba'
union all select 'bill_items',              count(*) from public.bill_items
   where bill_id in (select id from public.bills where user_id = 'SanjaiSuba')
union all
select 'orphan_tenants (ALL shops)', count(*) from (
    select b.user_id from public.bills b
     where not exists (select 1 from public.mm_users u
                        where coalesce(nullif(btrim(u.tenant_id), ''), u.username) = b.user_id
                          and u.role is distinct from 'worker')
     group by b.user_id) x
order by rows_left desc;
