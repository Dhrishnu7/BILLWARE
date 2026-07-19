-- Per-shop subscription / billing state for the Super Admin "Billing" tab:
--   plan_amount  — what the shop pays you per month (₹)
--   paid_until   — their subscription is good through this date
--   suspended    — true while their access is cut off for non-payment
--
-- The actual LOGIN block is done by setting the owner's approval_status to
-- 'rejected' via the existing sa_set_approval admin action; this table just
-- remembers the billing intent + due dates so the admin can show it and undo it.
--
-- Admin-page writes go direct (relaxed policy, same as shop_edit_requests).
-- Run this ONCE in the Supabase SQL editor. Safe to re-run — idempotent.

create table if not exists public.shop_billing (
    username     text primary key,
    plan_amount  numeric not null default 0,
    paid_until   date,
    suspended    boolean not null default false,
    note         text default '',
    updated_at   timestamptz default now()
);

grant select, insert, update, delete on public.shop_billing to anon, authenticated;

alter table public.shop_billing enable row level security;

drop policy if exists shop_billing_rw on public.shop_billing;
create policy shop_billing_rw on public.shop_billing
    for all
    using (true)
    with check (true);
