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


-- ── BLOCK 3 ── prove it works, and move no money ─────────────────────────
-- p_delta 0 against a name that does not exist would CREATE a customer, so
-- this deliberately targets a real one and adds nothing. Expect:
--   applied=true, duplicate=false  on the first run
--   applied=false, duplicate=true  on every run after (the op_id repeats)
-- Either is a pass. A 42804 means block 1 did not run.
select public.mm_apply_balance_delta(
    'selftest-fix-balance-ops-42804', 'Sanjai', '', '', 0
) as result;
