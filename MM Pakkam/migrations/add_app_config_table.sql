-- Global app config (key/value) that every shop's app reads. Lets the app OWNER
-- flip site-wide switches without a code change / redeploy. First switch:
--   backup_reminders = 'on'  -> shops see the "back up now" banner + inbox nag
--   backup_reminders = 'off' -> reminders hidden everywhere (use once on Supabase Pro,
--                               which does automatic daily backups)
--
-- Publicly READABLE (all shops read it), but NOT writable from the app — you change
-- the value from the Supabase Dashboard -> Table Editor (which uses the service role
-- and bypasses RLS). Run this ONCE. Safe to re-run — idempotent.

create table if not exists public.app_config (
    key   text primary key,
    value text not null default ''
);

insert into public.app_config (key, value) values ('backup_reminders', 'on')
    on conflict (key) do nothing;

grant select on public.app_config to anon, authenticated;

alter table public.app_config enable row level security;

drop policy if exists read_all on public.app_config;
create policy read_all on public.app_config for select using (true);
