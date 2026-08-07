-- 0007_payments_ref_no.sql
-- Nomor order (order_no) sebagai referensi rekonsiliasi pembayaran.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ref_no TEXT;
