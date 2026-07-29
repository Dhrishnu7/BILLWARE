-- ============================================================================
-- Prescription photos: make the Storage bucket PRIVATE
-- ----------------------------------------------------------------------------
-- Follow-up to migrations/fix_cross_account_leaks.sql, which scoped the bucket's
-- policies to `<tenant>/` so nobody can list, overwrite or delete another shop's
-- photos. One gap was left open: the bucket was still `public = true`.
--
-- A public bucket serves every object at
--     /storage/v1/object/public/prescriptions/<tenant>/<rx_id>.jpg
-- with NO login, NO policy check and NO expiry. Anyone who ever saw one of those
-- URLs — in a shared link, a browser history, a proxy log — keeps a permanent
-- handle on a patient's prescription photo.
--
-- Flipping it to private makes Storage enforce the policies on every read. The
-- app no longer builds public URLs: dbPrescriptionImageSrc() mints a signed URL
-- that expires after an hour, each time a photo is displayed.
--
-- RUN THIS ONLY WITH v224 (or later) OF THE SITE DEPLOYED. On an older build the
-- pages still hold public URLs and the photos would show as broken images.
-- Old rows are handled: the signer extracts the path out of a stored public URL,
-- and inline base64 rows are used as-is.
--
-- Safe to re-run — idempotent.
-- ============================================================================

update storage.buckets set public = false where id = 'prescriptions';


-- The four `rx *` policies from fix_cross_account_leaks.sql are what grant
-- access now, and they already scope every operation to the caller's own
-- folder. Re-asserted here so this file stands on its own if run alone.
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


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Must return one row with public = false.
select id, name, public from storage.buckets where id = 'prescriptions';
