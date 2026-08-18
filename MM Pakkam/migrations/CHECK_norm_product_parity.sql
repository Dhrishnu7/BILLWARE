-- ============================================================================
-- CHECK_norm_product_parity.sql  ·  Does the SQL normaliser still match the JS?
-- ----------------------------------------------------------------------------
-- mm_norm_product() (add_sales_analytics.sql) is a PORT of normName() in
-- js/drug-master.js:345. Two implementations of one fact is the bug family that
-- has bitten this codebase repeatedly — the cloud mappers that dropped
-- entry_type, then paymentMode, then hsn. Nothing stops the two drifting except
-- this file.
--
-- Read-only. Run it in the Supabase SQL editor after touching EITHER side.
-- Select all, Run. It is deliberately ONE query returning ONE verdict row
-- (plus a detail row per problem), because the editor only displays the LAST
-- statement's result — an earlier version of this file had the real check in
-- statement 1 and its result was silently discarded, which is exactly the
-- failure mode a verification must not have.
--
-- ── WHERE THE `expected` COLUMN COMES FROM ─────────────────────────────────
-- It was NOT typed out by reading the JavaScript. It is the output of actually
-- EXECUTING window.DrugMaster.normName() over these exact inputs in headless
-- Chrome (scratchpad/normparity.html, 2026-08-18). Transcribing what the code
-- looks like it does is how you get 24 green checks over something that could
-- never run — the two sides have to be derived differently and both executed.
--
-- To regenerate after changing normName(): re-run that page, paste the new
-- pairs below. Do not hand-edit a value to make a test pass.
--
-- ── THE CONTROL ───────────────────────────────────────────────────────────
-- The last fixture is marked 'control' and carries a DELIBERATELY WRONG
-- expected value. It MUST diverge. If it does not, the comparison is not
-- actually comparing and every other green answer is worthless. It lives in
-- the same query as the real fixtures so the two cannot be run apart.
--
-- NOTE ON EMPTY: normName() returns '' where mm_norm_product() returns NULL.
-- That difference is intended — NULL is what the analytics view filters on — so
-- the comparison coalesces. It is the only permitted divergence.
--
-- EXPECTED OUTPUT: exactly one row —
--   ✅ PASS · 39 real fixtures matched · control fired as intended
-- ============================================================================

with fixtures(kind, input, expected) as (values
    -- punctuation + unit + dosage form, all three at once
    ('real', 'DOLO-650mg TAB',              'dolo 650'),
    ('real', 'Dolo 650',                    'dolo 650'),
    ('real', 'Dolo 650 Tablet',             'dolo 650'),
    ('real', 'DOLO   650  tabs',            'dolo 650'),
    ('real', 'DOLO_650',                    'dolo 650'),
    ('real', 'Dolo(650)',                   'dolo 650'),
    ('real', 'Dolo 650 / tab',              'dolo 650'),
    -- brand suffix letters must survive
    ('real', 'Pan-D',                       'pan d'),
    ('real', 'PAN D CAP',                   'pan d'),
    ('real', 'Pan 40',                      'pan 40'),
    ('real', 'Pan-40 Tablet',               'pan 40'),
    ('real', 'Taxim-O 200 DT',              'taxim o 200 dt'),
    ('real', 'Neurobion Forte',             'neurobion forte'),
    -- syrups / suspensions
    ('real', 'Augmentin 625 Duo Tab',       'augmentin 625 duo'),
    ('real', 'AUGMENTIN DUO 625',           'augmentin duo 625'),
    ('real', 'Meftal-P Susp 60ml',          'meftal p 60'),
    ('real', 'Meftal P Suspension',         'meftal p'),
    ('real', 'Crocin Advance 500mg',        'crocin advance 500'),
    -- injections, and units that are not lengths
    ('real', 'Human Actrapid 100IU/ml Inj', 'human actrapid 100 ml'),
    ('real', 'Monocef 1gm Injection',       'monocef 1'),
    -- decimals must not be split
    ('real', 'Thyronorm 12.5mcg',           'thyronorm 12.5'),
    ('real', 'Thyronorm 12.5 mcg tab',      'thyronorm 12.5'),
    ('real', 'Ecosprin 75',                 'ecosprin 75'),
    -- creams / drops / gels
    ('real', 'Candid-B Cream 15gm',         'candid b 15'),
    ('real', 'Otrivin Nasal Drops 10ml',    'otrivin nasal 10'),
    ('real', 'Volini Gel 30g',              'volini 30'),
    ('real', 'Zincovit 10 Tablets',         'zincovit 10'),
    ('real', 'Shelcal 500 Strip',           'shelcal 500'),
    -- currency and bracket junk the till sometimes picks up
    ('real', 'Dolo 650 ₹32',                'dolo 650 32'),
    ('real', 'Azithral-500 (AZEE)',         'azithral 500 azee'),
    -- degenerate inputs
    ('real', 'TAB',                         ''),
    ('real', 'tablet',                      ''),
    ('real', '   ',                         ''),
    ('real', '',                            ''),
    ('real', '500',                         '500'),
    ('real', '650 mg',                      '650'),

    /* ── KNOWN LIMITATIONS, PINNED DELIBERATELY ──────────────────────────────
       These three are NOT what you would want the answer to be. They are
       recorded as the CURRENT answer so that the port is provably faithful and
       so that fixing normName() makes this file fail loudly instead of letting
       the two sides drift apart in silence.

       1. 'dolo650' stays one word — no space is inserted between a name and a
          number that were typed together, so it never merges with 'Dolo 650'.
       2. 'TAB.' with a trailing full stop is NOT stripped: '.' is kept as a
          word character, so the word is 'tab.' which is not in the dosage-form
          list. A very common way to type it, and it splits the product in two.
       3. Word ORDER is significant, so 'Augmentin 625 Duo' and 'Augmentin Duo
          625' are two different medicines.
       ─────────────────────────────────────────────────────────────────────── */
    ('real', 'dolo650',                     'dolo650'),
    ('real', 'dolo  650   TAB.',            'dolo 650 tab.'),
    ('real', 'inj.',                        'inj.'),

    -- THE CONTROL. Must diverge. See the header.
    ('control', 'DOLO-650mg TAB',           'deliberately-wrong-value')
),
cmp as (
    select kind, input, expected,
           coalesce(public.mm_norm_product(input), '') as got
    from fixtures
),
tally as (
    select
        count(*) filter (where kind = 'real')                                    as n_real,
        count(*) filter (where kind = 'real'    and got is distinct from expected) as bad_real,
        count(*) filter (where kind = 'control' and got is distinct from expected) as fired
    from cmp
)
select 1 as ord,
       case
         when bad_real = 0 and fired = 1
           then '✅ PASS · ' || n_real || ' real fixtures matched · control fired as intended'
         when fired = 0
           then '🚨 BROKEN TEST · the control did NOT diverge, so this check is comparing nothing. Ignore any green result.'
         else '❌ FAIL · ' || bad_real || ' of ' || n_real || ' fixtures diverged — see the rows below'
       end                                    as verdict,
       null::text as input, null::text as js_normName, null::text as sql_mm_norm_product
from tally
union all
select 2, '↳ diverged', input, expected, got
from cmp
where kind = 'real' and got is distinct from expected
order by ord, input;
