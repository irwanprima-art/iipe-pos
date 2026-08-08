-- 0008_events_online_payment.sql
-- Toggle pembayaran online per event: false = bayar hanya di kasir (POS).
ALTER TABLE events ADD COLUMN IF NOT EXISTS online_payment BOOLEAN NOT NULL DEFAULT true;
