-- FIX: mm_apply_balance_delta has NEVER succeeded. Every customer-balance
-- write to the cloud has been failing since add_balance_ops.sql was applied.
--
-- THE BUG
-- add_balance_ops.sql declared:
--     customer_id bigint
-- but public.customers.id is a UUID. The function's last statement,
--     insert into customer_balance_ops (..., customer_id, ...)
--     values (..., v_row.id, ...)
-- therefore raises
--     42804: column "customer_id" is of type bigint but expression is of
--            type uuid
-- and because that insert is in the SAME transaction as the balance update
-- (which is the entire point of the function), the abort ROLLS BACK the
-- balance change too. The function does not half-work: it never works.
--
-- WHY NOBODY NOTICED
-- The client only falls back to the old read-modify-write path when the error
-- looks like "function missing" (PGRST202 / does not exist / schema cache) —
-- js/supabase.js:241. A 42804 is not that, so dbUpdateCustomerBalance returns
-- {success:false} with NO fallback, and the caller quietly queues the delta in
-- pendingBalanceUpdates. Meanwhile the local stores were already updated, and
-- every merge in the app keeps the HIGHER of cloud and local — so the figure
-- on screen stayed right and the cloud silently stayed stale. Only the Khata
-- "Add Balance" box surfaces the failure at all, as "check your connection".
--
-- Affected: every credit sale (sales.html:2222), khata Add Balance
-- (khata.html:1486), sales-return refunds (inventory.html:1546), bill
-- delete/restore and Migrate In (report.html:4520, 4933, 8818). The only path
-- that kept working is report.html:9198, which passes no op id and so skips
-- the RPC entirely.
--
-- THE FIX
-- customer_id is written once and never joined, filtered or ordered on — it
-- exists so a human can trace an op back to a row. So it becomes `text` and
-- the function casts explicitly. Storing it as text rather than uuid is
-- deliberate: a hard type assumption in DDL is what broke this, and a column
-- nothing reads has no business being coupled to another table's key type.
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run.
-- Run the three blocks SEPARATELY — the editor shows only the LAST statement's
-- result, so a combined run hides the verification.

-- ── BLOCK 1 ── widen the column ──────────────────────────────────────────
alter table public.customer_balance_ops
    alter column customer_id type text using customer_id::text;


-- ── BLOCK 2 ── recreate the function with the cast ───────────────────────
create or replace function public.mm_apply_balance_delta(
    p_op_id   text,
    p_name    text,
    p_phone   text,
    p_address text,
    p_delta   numeric
) returns jsonb
language plpgsql
security invoker
as $$
declare
    v_user text := public.current_tenant();
    v_row  public.customers%rowtype;
    v_new  numeric;
begin
    if v_user is null or btrim(coalesce(p_op_id, '')) = '' then
        raise exception 'mm_apply_balance_delta: no tenant or no op_id';
    end if;

    -- Already applied. This is a retry of a write that DID land — report the
    -- balance as it stands and change nothing.
    if exists (select 1 from public.customer_balance_ops where op_id = p_op_id) then
        select * into v_row from public.customers
         where user_id = v_user
           and lower(btrim(name)) = lower(btrim(p_name))
         order by id limit 1;
        return jsonb_build_object('applied', false, 'duplicate', true,
                                  'balance', coalesce(v_row.balance, 0));
    end if;

    -- Matched case-insensitively on purpose: every local match in the app
    -- lowercases, and a case-sensitive lookup here is what used to create a
    -- second customer row for the same person.
    -- FOR UPDATE serialises two devices billing the same customer at once.
    select * into v_row from public.customers
     where user_id = v_user
       and lower(btrim(name)) = lower(btrim(p_name))
     order by id limit 1
       for update;

    if found then
        -- Clamped at zero to match every reader: dbGetKhataData filters
        -- balance > 0 and the local stores have always clamped.
        v_new := greatest(0, coalesce(v_row.balance, 0) + p_delta);
        update public.customers set balance = v_new where id = v_row.id;
    else
        v_new := greatest(0, p_delta);
        insert into public.customers (name, phone, address, balance, user_id)
        values (btrim(p_name), coalesce(p_phone, ''), coalesce(p_address, ''), v_new, v_user)
        returning * into v_row;
    end if;

    -- ::text is the fix. customers.id is a uuid; this column used to be bigint.
    insert into public.customer_balance_ops (op_id, user_id, customer_id, name, delta)
    values (p_op_id, v_user, v_row.id::text, btrim(p_name), p_delta);

    return jsonb_build_object('applied', true, 'duplicate', false, 'balance', v_new);
end
$$;

grant execute on function public.mm_apply_balance_delta(text, text, text, text, numeric)
    to anon, authenticated;


-- ── BLOCK 3 ── the verdict ───────────────────────────────────────────────
-- ⚠️ Do NOT try to self-test by CALLING mm_apply_balance_delta from the SQL
-- editor. current_tenant() -> current_branch() -> auth.uid(), and auth.uid()
-- is NULL here, so the function raises
--   P0001 mm_apply_balance_delta: no tenant or no op_id
-- on its FIRST line — before touching a single table. That is exactly the
-- probe that "verified" this function on 2026-08-11 and could never have
-- caught the bug: it proves the function EXISTS, not that it WORKS.
--
-- Expect exactly:  customers_id_type = uuid
--                  ops_customer_id_type = text
--                  function_has_cast = yes
select
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'customers'
        and column_name = 'id')                                as customers_id_type,
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'customer_balance_ops'
        and column_name = 'customer_id')                       as ops_customer_id_type,
    (select case when pg_get_functiondef(oid) like '%v_row.id::text%'
                 then 'yes' else 'NO - block 2 did not run' end
       from pg_proc where proname = 'mm_apply_balance_delta' limit 1)
                                                               as function_has_cast;


-- ── BLOCK 4 ── run the exact statement that used to raise 42804 ──────────
-- This is the real functional proof: it takes a genuine customers row the
-- same way the function does (%rowtype), performs the identical insert, and
-- removes the test row again. It moves no money and leaves nothing behind.
--
-- PASS = "Success. No rows returned."   Any error is a real failure:
--   42804  -> block 1 did not run
--   SKIPPED -> the table has no customers to test against
do $$
declare
    v_row public.customers%rowtype;
begin
    select * into v_row from public.customers limit 1;
    if not found then
        raise exception 'SKIPPED: no customers to test against';
    end if;

    insert into public.customer_balance_ops (op_id, user_id, customer_id, name, delta)
    values ('selftest-42804', 'selftest', v_row.id::text, 'selftest', 0);

    delete from public.customer_balance_ops where op_id = 'selftest-42804';
end $$;
