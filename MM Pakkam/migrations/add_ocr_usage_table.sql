-- add_ocr_usage_table.sql
--
-- Meter for the cloud invoice scanner (Edge Function mm-ocr).
--
-- Cloud OCR is the first feature in this app that costs the OPERATOR real
-- money per use, and the person spending it is not the person paying. A shop
-- with a camera roll, or a retry loop nobody noticed, can run up a bill in an
-- afternoon. So every scan is metered and there is a per-day ceiling
-- (MM_OCR_DAILY_CAP on the function, default 60).
--
-- OPTIONAL, and deliberately so: mm-ocr wraps the count and the insert in
-- try/catch and carries on if this table is missing. A migration nobody ran
-- must never take invoice scanning down — it should only mean the cap is not
-- being enforced yet.
--
-- user_id here is the SUPABASE AUTH uid (uuid), not the tenant username used
-- by the rest of the app. That is what the Edge Function has verified, and it
-- is what a cap must be keyed on: a shared tenant with four staff logins is
-- four people scanning, and each one should carry their own allowance.
--
-- NOT added to the delete-store cascade. The cascade deletes by tenant
-- username and this table is keyed by auth uid, so it would never match — and
-- a spending record is worth keeping after a store is closed anyway.
--
-- Safe to run more than once.

create table if not exists public.ocr_usage (
    id            bigserial primary key,
    user_id       uuid not null,
    day           date not null,
    lines         integer not null default 0,   -- product rows returned by the scan
    input_tokens  integer,
    output_tokens integer,
    model         text,
    created_at    timestamptz not null default now()
);

-- The cap query is (user_id, day) — without this it is a full scan on every
-- single invoice scan.
create index if not exists ocr_usage_user_day_idx
    on public.ocr_usage (user_id, day);

-- For the operator's own "what did this month cost me" query.
create index if not exists ocr_usage_day_idx
    on public.ocr_usage (day);

-- ── DENY BY DEFAULT ──
-- No grants to anon or authenticated. Only the service role writes here, and
-- the service role bypasses RLS entirely. This is not tidiness: if a shop
-- could delete its own usage rows it could reset its own daily cap, which is
-- the whole point of the table. RLS is enabled with NO policy, so any client
-- reaching this table directly sees nothing and can change nothing.
alter table public.ocr_usage enable row level security;

drop policy if exists tenant_rw on public.ocr_usage;

comment on table public.ocr_usage is
    'One row per cloud invoice scan. Written only by the mm-ocr Edge Function under the service role; no client access. user_id is the Auth uid, not the tenant username.';
