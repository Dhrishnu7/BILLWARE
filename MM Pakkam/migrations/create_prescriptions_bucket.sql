-- ============================================================
-- Prescription photos → Supabase Storage bucket
-- ------------------------------------------------------------
-- WHY: prescription photos were being stored as base64 text inside
-- the `prescriptions.image_data` column, which bloats the database
-- and slows every sync. This moves the photos into a Storage bucket
-- so the DB only keeps a short URL. Images are ~100x heavier than a
-- normal row, so this is what keeps storage from filling up.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this → Run.
-- Safe to run more than once (idempotent).
-- ============================================================

-- 1. Create a public bucket named "prescriptions".
--    (public = the photo URLs render directly in an <img> tag)
insert into storage.buckets (id, name, public)
values ('prescriptions', 'prescriptions', true)
on conflict (id) do update set public = true;

-- 2. Access rules.
--    The app talks to Supabase with the publishable (anon) key and its
--    own custom login — the same model the rest of the app already uses.
--    These policies let that key read/write ONLY inside this one bucket.
--    (Photos sit under an unguessable  <tenant>/<rx_id>.jpg  path.)

drop policy if exists "rx read"   on storage.objects;
drop policy if exists "rx insert" on storage.objects;
drop policy if exists "rx update" on storage.objects;
drop policy if exists "rx delete" on storage.objects;

create policy "rx read"   on storage.objects
    for select using (bucket_id = 'prescriptions');

create policy "rx insert" on storage.objects
    for insert with check (bucket_id = 'prescriptions');

create policy "rx update" on storage.objects
    for update using (bucket_id = 'prescriptions')
    with check (bucket_id = 'prescriptions');

create policy "rx delete" on storage.objects
    for delete using (bucket_id = 'prescriptions');
