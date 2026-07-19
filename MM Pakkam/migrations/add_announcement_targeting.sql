-- Extends mm_announcements so the Super Admin can send a message either to
-- EVERY shop (broadcast) or to ONE specific shop, straight into their Inbox.
--
--   target_user IS NULL  -> broadcast, shown in every shop's Inbox
--   target_user = 'ravi' -> shown only in that owner's shop (owner + workers)
--
-- Also opens insert/delete so the admin page can post/remove announcements
-- directly (same relaxed-write pattern as shop_edit_requests). Regular shops
-- still only ever READ their own + broadcast messages (filtered client-side).
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run — idempotent.

alter table public.mm_announcements add column if not exists target_user text;

-- Allow the admin page to post and delete announcements.
grant insert, delete on public.mm_announcements to anon, authenticated;

drop policy if exists announcements_write on public.mm_announcements;
create policy announcements_write on public.mm_announcements
    for insert
    with check (true);

drop policy if exists announcements_delete on public.mm_announcements;
create policy announcements_delete on public.mm_announcements
    for delete
    using (true);
