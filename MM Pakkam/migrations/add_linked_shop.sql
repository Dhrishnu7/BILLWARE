-- ════════════════════════════════════════════════════════════════════════════
-- shop_profiles.linked_shop  —  "do you already run another shop here?"
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
--
-- Asked on shop-setup.html because first-time setup is the only moment the
-- answer is obvious. NOTHING READS IT YET: the combined dashboard is Step 3 of
-- the multi-branch plan (see add_branch_groups.sql). Capturing it now is the
-- difference between building that screen and telephoning owners to ask which
-- two accounts belong to the same person.
--
-- It is a NOTE FOR THE ADMIN, NOT A PERMISSION. Nothing about tenant
-- isolation reads this column, and nothing ever should: the group link that
-- RLS trusts lives in `branches` / `branch_groups`, which only the service
-- role can write. A text box the owner types into must never widen what they
-- can see — the admin creates the real group rows at approval time.
--
-- Deliberately NOT a foreign key to mm_users: at setup the named shop may not
-- exist yet (an owner registering both shops in one sitting types each one's
-- username before the other is approved), and a hard constraint would refuse
-- the whole profile save over a field the shop did not have to fill in.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.shop_profiles
    add column if not exists linked_shop text not null default '';

comment on column public.shop_profiles.linked_shop is
    'Username of another shop the same owner runs. Advisory only — verified by hand at approval. The group link RLS trusts is in branches/branch_groups.';


-- ── Verify ──────────────────────────────────────────────────────────────────
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'shop_profiles'
--      and column_name in ('linked_shop','city','pincode');
--
-- All three must be present. city and pincode are checked here too because the
-- same change fixed them being silently dropped for every pre-approval shop
-- (mm-admin's submit_shop_profile whitelist did not carry them).
