-- SumoPay: simpan payment link untuk redirect pembayaran (hosted payment page)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
