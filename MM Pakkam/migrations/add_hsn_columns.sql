-- HSN code support for GST tax invoices
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run: "IF NOT EXISTS" makes it idempotent.

-- Source of truth: HSN captured at purchase, carried to each bill line.
alter table public.purchases  add column if not exists hsn text default '';
alter table public.bill_items add column if not exists hsn text default '';
