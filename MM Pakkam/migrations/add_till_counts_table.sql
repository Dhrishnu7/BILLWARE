-- add_till_counts_table.sql
--
-- The one daily financial habit the app did not support: counting the drawer.
--
-- The Day Book has always said, in as many words, that its Cash column is "a
-- movement, not a drawer balance — the app is never told what was in the till
-- this morning". That was honest and it was also the gap. Every retail shop
-- counts its cash at closing; without somewhere to record the opening float
-- and the counted amount, the app can compute what the drawer OUGHT to hold
-- and never tell anyone whether it does.
--
-- One row per shop per day. counted_at records when the count was taken,
-- which is not the same as the business day it belongs to — a shop counting
-- at 11pm and a shop counting at 1am the next morning are both closing the
-- same day.
--
-- Safe to run more than once.

create table if not exists public.till_counts (
    id          bigserial primary key,
    user_id     text not null,
    day         date not null,
    opening     numeric not null default 0,   -- float left in the drawer to start
    counted     numeric not null default 0,   -- what was actually counted at closing
    note        text,
    counted_at  timestamptz not null default now()
);

-- One count per shop per day: a second count for the same day is a
-- CORRECTION, not another count, and must replace the first rather than
-- quietly doubling the shop's cash.
create unique index if not exists till_counts_user_day_uniq
    on public.till_counts (user_id, day);

grant select, insert, update, delete on public.till_counts to anon, authenticated;
grant usage, select on sequence public.till_counts_id_seq to anon, authenticated;

alter table public.till_counts enable row level security;

drop policy if exists tenant_rw on public.till_counts;
create policy tenant_rw on public.till_counts
    for all using (true) with check (true);

comment on table public.till_counts is
    'Physical cash count per business day. opening = float at start, counted = actual cash at closing. The difference against the Day Book''s computed movement is the over/short.';
