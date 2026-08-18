-- ============================================================================
-- add_sales_analytics.sql  ·  Cross-shop product analytics for the Super Admin
-- ----------------------------------------------------------------------------
-- Powers the "📊 Insights" tab: which medicine sells most, per shop / pincode /
-- district / state, and how that moves with the season.
--
-- Run it in the Supabase SQL editor (Dashboard -> SQL -> New query -> paste ->
-- Run). Safe to re-run — every statement is IF NOT EXISTS / CREATE OR REPLACE.
--
-- ── WHY THE AGGREGATION IS HERE AND NOT IN THE BROWSER ─────────────────────
-- The Scans tab gets away with grouping client-side because cloud OCR is capped
-- at 60 scans/day/shop, so the raw rows are small. Sales have no such cap: one
-- shop with a year of billing is tens of thousands of bill_items. Shipping every
-- line of every shop to superadmin.html to be counted in JavaScript would stop
-- working somewhere around the fifth customer, and it would stop working slowly
-- and confusingly rather than loudly. PostgREST cannot GROUP BY, so the roll-up
-- lives in these functions and the browser receives finished rows.
--
-- ── WHY THERE IS NO STORED product_norm COLUMN ─────────────────────────────
-- The obvious optimisation is a generated column holding the normalised name.
-- It is deliberately NOT done: PostgreSQL will happily let you CREATE OR REPLACE
-- the function afterwards WITHOUT recomputing the stored values, so the column
-- and the function would silently disagree — the same "one fact written twice"
-- family as the mappers that dropped entry_type and paymentMode. The function is
-- the single source of truth and is evaluated at query time. If this ever gets
-- slow, the fix is a MATERIALIZED VIEW refreshed on a schedule (which restates
-- everything, together, from the one definition) — not a generated column.
-- ============================================================================


-- ── 1. GEOGRAPHY ON THE SHOP PROFILE ────────────────────────────────────────
-- shop_profiles already carries city + pincode (added for the e-invoice, see
-- add_einvoice_fields.sql). Neither can group a report:
--   · city is free text, so "Chennai" / "chennai" / "Madras" are three places
--   · pincode is precise but meaningless to read — nobody thinks in 600028
-- district and state are stored as their own confirmed fields. The app SUGGESTS
-- them from the pincode and from the GSTIN state code, but the shop confirms:
-- a reference list may propose, it may not decide.
alter table public.shop_profiles add column if not exists district text;
alter table public.shop_profiles add column if not exists state    text;

comment on column public.shop_profiles.district is
  'District the shop trades in. Suggested from the pincode at setup, CONFIRMED by the shop. Free text so an unlisted or newly-split district is never unenterable.';
comment on column public.shop_profiles.state is
  'State the shop trades in. Cross-checked against the GSTIN state code (first 2 digits) — a mismatch is shown to the admin, never silently corrected.';


-- ── 2. PRODUCT NAME NORMALISATION ───────────────────────────────────────────
-- Product names are free text typed at the till. Within one shop the spelling is
-- roughly consistent; ACROSS shops it is not, and that is the trap this function
-- exists to close. "DOLO 650", "Dolo-650 tab" and "dolo 650mg" are one medicine,
-- and without this they would come back as three rows — producing a ranked list
-- that looks entirely plausible and is wrong.
--
-- ⚠️ THIS IS A PORT of normName() in js/drug-master.js:345. The two must agree.
-- They are kept apart deliberately (that one classifies drug schedules at the
-- till and must not need a round trip), so the risk is drift. That is what
-- CHECK_norm_product_parity.sql exists to catch — run it after touching either.
--
-- The three passes, in this order:
--   1. lowercase, and punctuation -> space   ("Dolo-650" -> "dolo 650")
--   2. strip the unit off a number           ("650mg"    -> "650")
--   3. drop dosage-form words                ("tab", "syp", "inj", ...)
-- Order matters: pass 2 relies on pass 1 having already split "Dolo-650mg".
create or replace function public.mm_norm_product(p text)
returns text
language sql
immutable
parallel safe
as $$
    with cleaned as (
        select regexp_replace(
                   regexp_replace(lower(coalesce(p, '')), '[^a-z0-9[:space:].]', ' ', 'g'),
                   '([0-9])[[:space:]]*(mg|mcg|ml|gm|g|iu|mu)\y', '\1', 'g'
               ) as t
    ),
    words as (
        select w, ord
        from cleaned,
             unnest(regexp_split_to_array(t, '[[:space:]]+')) with ordinality as u(w, ord)
        where w <> ''
          and w <> all (array[
              'tab','tabs','tablet','tablets','cap','caps','capsule','capsules',
              'syp','syrup','susp','suspension','inj','injection','drop','drops',
              'cream','ointment','oint','gel','lotion','sachet','powder','solution',
              'soln','spray','tube','strip','bottle','vial','amp','ampoule','kit',
              'md','od'])
    )
    select nullif(btrim(coalesce(
        (select string_agg(w, ' ' order by ord) from words), '')), '');
$$;

comment on function public.mm_norm_product(text) is
  'Free-text product name -> comparable key. PORT of normName() in js/drug-master.js — keep the two in step, CHECK_norm_product_parity.sql proves it.';


-- ── 3. SEASON ───────────────────────────────────────────────────────────────
-- Deliberately a plain calendar bucket, not a weather model. A pharmacy's
-- seasonal pattern is fever/cold in the wet months and dehydration/skin in the
-- dry ones, and the month is a good enough proxy to sell stock on.
--
-- ⚠️ Tuned for the southern peninsula, where these shops are. Tamil Nadu gets
-- the NORTH-EAST monsoon (Oct–Dec), not the south-west one, which is why
-- Oct–Nov is its own bucket rather than being lumped into winter. Read the
-- bucket names as "what the weather was doing", not as IMD definitions.
create or replace function public.mm_season(d date)
returns text
language sql
immutable
parallel safe
as $$
    select case
        when d is null then null
        when extract(month from d) in (12, 1, 2)  then 'Winter (Dec–Feb)'
        when extract(month from d) in (3, 4, 5)   then 'Summer (Mar–May)'
        when extract(month from d) in (6, 7, 8, 9) then 'Monsoon (Jun–Sep)'
        else 'NE Monsoon (Oct–Nov)'
    end;
$$;


-- ── 4. THE BILL DATE ────────────────────────────────────────────────────────
-- bills.date holds a date-only value and predates any typed migration, so it may
-- be `date` in one environment and `text` in another. Casting to text first
-- works for both; the regex guard means one malformed row returns NULL instead
-- of aborting the whole report with a cast error.
--
-- Note this reads `date` (the day the shop says the sale happened) and NOT
-- saved_at (the instant the row reached the server). A date is not a time — the
-- v315/v316 5:30am bug was exactly this confusion, and using saved_at here would
-- push every late-evening sale into the following day.
create or replace function public.mm_bill_day(v text)
returns date
language sql
immutable
parallel safe
as $$
    select case when v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                then substring(v, 1, 10)::date end;
$$;


-- ── 5. THE LINE-LEVEL BASE VIEW ─────────────────────────────────────────────
-- One row per sold line, carrying the shop's geography and the normalised
-- product. Everything below aggregates this and nothing else, so there is one
-- definition of "a sale" rather than one per report.
--
-- bill_items has NO user_id and NO date of its own — both live on the parent
-- bill — which is why this join is not optional and why no report may read
-- bill_items directly.
-- security_invoker is NOT the default for a view — a plain view runs as its
-- OWNER and would therefore read straight past RLS for whoever called it. That
-- is the opposite of what the grants at the bottom of this file assume, so it is
-- set explicitly. Requires PostgreSQL 15+ (Supabase is well past it).
create or replace view public.mm_sales_lines
with (security_invoker = true) as
select
    b.user_id                                        as shop,
    coalesce(nullif(btrim(sp.shop_name), ''), b.user_id) as shop_name,
    nullif(btrim(sp.pincode),  '')                   as pincode,
    nullif(btrim(sp.city),     '')                   as city,
    nullif(btrim(sp.district), '')                   as district,
    nullif(btrim(sp.state),    '')                   as state,
    public.mm_bill_day(b.date::text)                 as day,
    b.id                                             as bill_id,
    bi.product                                       as product_raw,
    public.mm_norm_product(bi.product)               as product_norm,
    coalesce(bi.qty,   0)::numeric                   as qty,
    coalesce(bi.total, 0)::numeric                   as value
from public.bill_items bi
join public.bills b          on b.id = bi.bill_id
left join public.shop_profiles sp on sp.user_id = b.user_id;

comment on view public.mm_sales_lines is
  'One row per sold line with the selling shop''s geography attached. The single definition of "a sale" for every Super Admin analytics report.';


-- ── 6. THE LEADERBOARD ──────────────────────────────────────────────────────
-- "Top N medicines" for any grouping, in one function. p_level chooses the
-- grouping; it is matched against a CASE, never interpolated, so no caller can
-- turn it into SQL.
--
--   shop | pincode | district | state | month | season | all
--
-- ── ON `shops` ──────────────────────────────────────────────────────────────
-- Every row reports how many DISTINCT SHOPS it was built from, and the UI must
-- show it. With three pilot shops, "top medicine in this district" is one shop
-- wearing a district's name. That is not a reason to withhold the number, but a
-- number that hides its sample size is a confident liar.
--
-- ── ON `qty` VS `value` ─────────────────────────────────────────────────────
-- Both are returned; p_by picks which one ranks. Neither is simply "right":
-- qty is what you reorder on, but it is NOT comparable across shops, because one
-- till types a strip of 10 as qty 1 and another types it as qty 10. (This is the
-- same units confusion that made the Schedule-H ledger show negative stock in
-- v349.) `value` in rupees is immune to that and is the safer cross-shop
-- ranking; qty is the better within-one-shop ranking. The UI defaults to value
-- for the geography levels and offers the toggle.
create or replace function public.mm_sa_product_leaders(
    p_from  date    default null,
    p_to    date    default null,
    p_level text    default 'shop',
    p_by    text    default 'value',
    p_limit integer default 5
)
returns table (
    group_key    text,
    group_label  text,
    product      text,
    product_norm text,
    qty          numeric,
    value        numeric,
    bills        bigint,
    shops        bigint,
    rnk          integer,
    group_qty    numeric,
    group_value  numeric,
    group_bills  bigint
)
language sql
stable
parallel safe
as $$
    with keyed as (
        select
            case p_level
                when 'shop'     then l.shop
                when 'pincode'  then l.pincode
                when 'district' then l.district
                when 'state'    then l.state
                when 'month'    then to_char(l.day, 'YYYY-MM')
                when 'season'   then public.mm_season(l.day)
                else '__all__'
            end as gkey,
            case p_level
                when 'shop'     then l.shop_name
                when 'pincode'  then l.pincode || coalesce(' · ' || l.city, '')
                when 'district' then l.district
                when 'state'    then l.state
                when 'month'    then to_char(l.day, 'Mon YYYY')
                when 'season'   then public.mm_season(l.day)
                else 'All shops'
            end as glabel,
            l.*
        from public.mm_sales_lines l
        where l.product_norm is not null
          and l.day is not null
          and (p_from is null or l.day >= p_from)
          and (p_to   is null or l.day <= p_to)
    ),
    agg as (
        select
            k.gkey,
            min(k.glabel)                             as glabel,
            k.product_norm                            as pnorm,
            -- The spelling the shops actually type most often, so the page shows
            -- "Dolo 650" and not the stripped key "dolo 650".
            mode() within group (order by k.product_raw) as label,
            sum(k.qty)                                as qty,
            sum(k.value)                              as value,
            count(distinct k.bill_id)                 as bills,
            count(distinct k.shop)                    as shops
        from keyed k
        where k.gkey is not null
        group by k.gkey, k.product_norm
    ),
    tot as (
        select gkey, sum(qty) as gqty, sum(value) as gvalue, sum(bills) as gbills
        from agg group by gkey
    ),
    ranked as (
        select a.*, t.gqty, t.gvalue, t.gbills,
               row_number() over (
                   partition by a.gkey
                   order by case when p_by = 'qty' then a.qty else a.value end desc,
                            a.value desc, a.pnorm
               ) as rn
        from agg a join tot t on t.gkey = a.gkey
    )
    select gkey, glabel, label, pnorm, qty, value, bills, shops,
           rn::integer, gqty, gvalue, gbills
    from ranked
    where rn <= greatest(coalesce(p_limit, 5), 1)
    order by gvalue desc, gkey, rn;
$$;


-- ── 7. ONE PRODUCT, MONTH BY MONTH ──────────────────────────────────────────
-- The drill-down behind a leaderboard row: does this medicine actually have a
-- season, or is it flat all year? Takes the NORMALISED key, which is what the
-- leaderboard returns alongside the display name.
create or replace function public.mm_sa_product_trend(
    p_product_norm text,
    p_from date default null,
    p_to   date default null
)
returns table (
    month  text,
    season text,
    qty    numeric,
    value  numeric,
    bills  bigint,
    shops  bigint
)
language sql
stable
parallel safe
as $$
    select
        to_char(l.day, 'YYYY-MM')     as month,
        public.mm_season(l.day)       as season,
        sum(l.qty)                    as qty,
        sum(l.value)                  as value,
        count(distinct l.bill_id)     as bills,
        count(distinct l.shop)        as shops
    from public.mm_sales_lines l
    where l.product_norm = p_product_norm
      and l.day is not null
      and (p_from is null or l.day >= p_from)
      and (p_to   is null or l.day <= p_to)
    group by 1, 2
    order by 1;
$$;


-- ── 8. CAN I TRUST THIS PAGE? ───────────────────────────────────────────────
-- Per-shop coverage. Read this BEFORE reading any leaderboard: a shop that
-- stopped billing in March, or that has bills but no line items, or that has no
-- district on file, silently changes what every other number means. Without this
-- the Insights tab would answer questions it has no data for and look confident
-- doing it.
create or replace function public.mm_sa_coverage()
returns table (
    shop        text,
    shop_name   text,
    city        text,
    pincode     text,
    district    text,
    state       text,
    gstin       text,
    bills       bigint,
    lines       bigint,
    first_day   date,
    last_day    date,
    value       numeric,
    bad_dates   bigint
)
language sql
stable
as $$
    select
        u.tenant_id                                          as shop,
        coalesce(nullif(btrim(sp.shop_name), ''), u.tenant_id) as shop_name,
        nullif(btrim(sp.city), '')     as city,
        nullif(btrim(sp.pincode), '')  as pincode,
        nullif(btrim(sp.district), '') as district,
        nullif(btrim(sp.state), '')    as state,
        nullif(btrim(sp.gstin), '')    as gstin,
        count(distinct b.id)                                       as bills,
        count(bi.id)                                               as lines,
        min(public.mm_bill_day(b.date::text))                      as first_day,
        max(public.mm_bill_day(b.date::text))                      as last_day,
        coalesce(sum(bi.total), 0)::numeric                        as value,
        -- Rows whose date could not be read at all. They are excluded from every
        -- leaderboard above, so their count has to be visible somewhere.
        count(*) filter (where b.id is not null
                           and public.mm_bill_day(b.date::text) is null) as bad_dates
    from (select distinct coalesce(tenant_id, username) as tenant_id
          from public.mm_users where role = 'owner') u
    left join public.shop_profiles sp on sp.user_id = u.tenant_id
    left join public.bills b          on b.user_id  = u.tenant_id
    left join public.bill_items bi    on bi.bill_id = b.id
    group by 1, 2, 3, 4, 5, 6, 7
    order by value desc;
$$;


-- ── 9. LOCK THEM DOWN ───────────────────────────────────────────────────────
-- These read ACROSS EVERY TENANT. They exist for one caller: mm-admin, holding
-- the service role, after it has verified the superadmin password. A shop's
-- browser key must never be able to execute them — otherwise any customer could
-- ask what their competitor down the road sells most of.
--
-- Two independent guards, deliberately:
--   1. EXECUTE is revoked, so the call is refused outright.
--   2. The functions are SECURITY INVOKER (the default for a function) and the
--      view is explicitly declared so (NOT the default for a view — see the
--      note above it). So even if a grant were restored by accident, RLS on
--      bills/bill_items/shop_profiles would still scope an ordinary caller to
--      their own shop.
-- Guard 1 alone would be one mistake away from a cross-tenant leak.
revoke all on public.mm_sales_lines from public, anon, authenticated;
revoke all on function public.mm_sa_product_leaders(date, date, text, text, integer) from public, anon, authenticated;
revoke all on function public.mm_sa_product_trend(text, date, date)                  from public, anon, authenticated;
revoke all on function public.mm_sa_coverage()                                       from public, anon, authenticated;

grant select  on public.mm_sales_lines to service_role;
grant execute on function public.mm_sa_product_leaders(date, date, text, text, integer) to service_role;
grant execute on function public.mm_sa_product_trend(text, date, date)                  to service_role;
grant execute on function public.mm_sa_coverage()                                       to service_role;

-- mm_norm_product / mm_season / mm_bill_day are pure text helpers that read no
-- table and leak nothing, so they stay callable — the parity check runs as an
-- ordinary user.


-- ── 10. INDEXES ─────────────────────────────────────────────────────────────
-- The join, not the normalisation, is what these reports spend their time on.
create index if not exists bill_items_bill_id_idx on public.bill_items (bill_id);
create index if not exists bills_user_date_idx    on public.bills (user_id, date);


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Run these after applying. Expected:
--   1. four rows, one per function/view
--   2. 'dolo 650'  (proves the normaliser: punctuation, unit and form all gone)
--   3. one row per shop — the coverage table the Insights tab opens with
--
-- select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname in
--        ('mm_norm_product','mm_season','mm_bill_day','mm_sa_product_leaders',
--         'mm_sa_product_trend','mm_sa_coverage') order by 1;
--
-- select public.mm_norm_product('DOLO-650mg TAB');
--
-- select * from public.mm_sa_coverage();
