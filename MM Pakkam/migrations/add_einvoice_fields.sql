-- ══════════════════════════════════════════════════════════════════════
-- add_einvoice_fields.sql — city + PIN for the e-invoice / e-way bill JSON
--
-- WHY
-- GSTR-1 only ever needed a GSTIN. The NIC e-invoice schema (INV-01) makes
-- Loc (town/city), Pin and Stcd MANDATORY for both the seller and the buyer,
-- and the e-way bill needs the same pair on both ends to compute distance.
-- Nothing in the app stored them: shop_profiles has two free-text address
-- lines, and customers has a single `address` blob. A free-text line cannot
-- be split into a reliable 6-digit PIN, so these are captured as their own
-- columns instead of parsed out.
--
-- Stcd is NOT stored: it is the first two digits of the GSTIN by definition,
-- so storing it separately only creates a second copy that can disagree.
--
-- Safe to run more than once.
-- ══════════════════════════════════════════════════════════════════════

alter table public.shop_profiles add column if not exists city    text;
alter table public.shop_profiles add column if not exists pincode text;

alter table public.customers     add column if not exists city    text;
alter table public.customers     add column if not exists pincode text;

-- Only a registered buyer (clinic, nursing home, another chemist) ever needs
-- these, so an index on "which customers still lack them" would be nearly the
-- whole table and is not worth carrying. The export lists the gaps itself.

comment on column public.customers.pincode is
  '6-digit PIN of the buyer''s place of supply. Mandatory for e-invoice (INV-01 BuyerDtls.Pin).';
comment on column public.shop_profiles.pincode is
  '6-digit PIN of the shop. Mandatory for e-invoice (INV-01 SellerDtls.Pin).';
