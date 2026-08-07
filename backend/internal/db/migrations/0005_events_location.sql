-- Koordinat lokasi event untuk auto-pilih lokasi terdekat di storefront
ALTER TABLE events ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
