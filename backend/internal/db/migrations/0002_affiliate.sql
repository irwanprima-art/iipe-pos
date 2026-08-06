-- Tambahan: link affiliate kustom per produk (Shopee)
-- Jika diisi, dipakai langsung; jika kosong, sistem memakai affiliate otomatis.
ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_affiliate_link TEXT;
