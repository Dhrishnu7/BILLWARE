-- Adds the columns that were being dropped on every cloud round-trip of a
-- Schedule H register entry. Most important: entry_type (IN vs OUT) — without
-- it, every entry loaded back from the cloud defaulted to OUT, so stock-received
-- (IN) entries silently became OUT. Also adds doctor_reg_no and schedule_class
-- (H vs H1) so those survive too.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Safe to re-run — every statement is IF NOT EXISTS / idempotent.

alter table public.schedule_h_register add column if not exists entry_type     text not null default 'out';
alter table public.schedule_h_register add column if not exists doctor_reg_no  text not null default '';
alter table public.schedule_h_register add column if not exists schedule_class text not null default '';
