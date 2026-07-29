-- ============================================================================
-- Deleting a shop must also delete its prescription PHOTOS
-- ----------------------------------------------------------------------------
-- migrations/add_delete_store_cascade.sql wipes every per-tenant TABLE when an
-- owner is removed, including the `prescriptions` rows. But the photos those
-- rows pointed at live in Storage, which is outside that trigger's reach — so
-- deleting a shop left its patients' prescription images sitting in the bucket
-- forever, with nothing left in the database to say they existed.
--
-- Found the hard way on 2026-07-29: an account was deleted, the row vanished,
-- and the photo was still being served from the CDN.
--
-- This adds a second trigger that removes the tenant's whole folder from
-- storage.objects. Deleting the object is also what makes Supabase purge its
-- CDN copy, so this closes the cache angle too.
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run — idempotent.
-- ============================================================================

create or replace function public.cascade_delete_store_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant text := OLD.username;          -- an owner's username == their tenant key
begin
  -- Workers share the owner's tenant; removing one must not delete the photos.
  if OLD.role is distinct from 'worker' then
    delete from storage.objects
     where bucket_id = 'prescriptions'
       and (storage.foldername(name))[1] = tenant;
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_cascade_delete_store_photos on public.mm_users;
create trigger trg_cascade_delete_store_photos
  before delete on public.mm_users
  for each row execute function public.cascade_delete_store_photos();


-- ── One-time cleanup: drop photos with no prescription row left ─────────────
-- Catches folders orphaned by shops deleted before this trigger existed.
delete from storage.objects o
 where o.bucket_id = 'prescriptions'
   and not exists (
     select 1 from public.prescriptions p
      where p.user_id = (storage.foldername(o.name))[1]
   );


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Should return 0 once the cleanup above has run.
select count(*) as orphaned_photos
  from storage.objects o
 where o.bucket_id = 'prescriptions'
   and not exists (
     select 1 from public.prescriptions p
      where p.user_id = (storage.foldername(o.name))[1]
   );
