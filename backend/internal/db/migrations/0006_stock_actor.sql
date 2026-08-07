-- 0006_stock_actor.sql
-- Mencatat siapa yang melakukan pergerakan stok (admin/operator/customer/system).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS actor TEXT;
