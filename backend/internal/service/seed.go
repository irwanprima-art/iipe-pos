package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Seeder membuat data contoh untuk pengujian (idempotent).
type Seeder struct {
	pool *pgxpool.Pool
}

func NewSeeder(pool *pgxpool.Pool) *Seeder { return &Seeder{pool: pool} }

func (s *Seeder) Seed(ctx context.Context) error {
	// admin user
	var cnt int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE lower(email)='admin@iipe.dev'`).Scan(&cnt); err != nil {
		return err
	}
	if cnt == 0 {
		hash, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		if _, err := s.pool.Exec(ctx, `INSERT INTO users (email, password_hash, name, role) VALUES ('admin@iipe.dev',$1,'Admin IIPE','admin')`, hash); err != nil {
			return err
		}
	}

	var eventID int64
	err := s.pool.QueryRow(ctx, `SELECT id FROM events WHERE code='BAZAR-2026'`).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := s.pool.QueryRow(ctx, `INSERT INTO events (code, name, location, is_active) VALUES ('BAZAR-2026','Bazaar IIPE 2026','Lapangan Merdeka',true) RETURNING id`).Scan(&eventID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	// products
	prods := []struct {
		sku, name, cat, bpcs, bcarton string
		desc                          string
		qtyCarton                     int
		shopee                        string
		price, stock                  int
	}{
		{"KAOS-001", "Kaos Polos Premium", "Pakaian", "8991000000001", "8991000000018", "Kaos katun combed 24s yang adem dan nyaman. Tersedia berbagai warna, cocok untuk daily wear maupun merchandise event.", 12, "https://shopee.co.id/product/123456789/987654321", 100000, 50},
		{"TMB-001", "Tumbler Stainless 500ml", "Aksesoris", "8991000000025", "8991000000032", "Tumbler stainless steel double-wall 500ml, menjaga minuman tetap dingin/panas lebih lama. Anti bocor, mudah dibawa.", 24, "", 50000, 30},
		{"TTG-001", "Tote Bag Kanvas", "Aksesoris", "8991000000049", "8991000000056", "Tote bag kanvas tebal dengan sablon tahan lama. Muat banyak, ramah lingkungan, cocok untuk belanja harian.", 20, "", 75000, 20},
	}
	var kaosID, tumblerID int64
	for _, p := range prods {
		var pid int64
		if err := s.pool.QueryRow(ctx, `SELECT id FROM products WHERE sku=$1`, p.sku).Scan(&pid); errors.Is(err, pgx.ErrNoRows) {
			if err := s.pool.QueryRow(ctx, `
				INSERT INTO products (sku, name, category, barcode_pcs, barcode_carton, qty_per_carton, marketplace_link)
				VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
				p.sku, p.name, p.cat, p.bpcs, p.bcarton, p.qtyCarton, p.shopee).Scan(&pid); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if p.sku == "KAOS-001" {
			kaosID = pid
		}
		if p.sku == "TMB-001" {
			tumblerID = pid
		}
		// update deskripsi (idempotent, berlaku juga untuk produk lama)
		if _, err := s.pool.Exec(ctx, `UPDATE products SET description=$1 WHERE id=$2`, p.desc, pid); err != nil {
			return err
		}
		// add to event (upsert price & stock)
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO event_products (event_id, product_id, price, stock_total, is_active)
			VALUES ($1,$2,$3,$4,true)
			ON CONFLICT (event_id, product_id) DO UPDATE SET price=EXCLUDED.price`, eventID, pid, p.price, p.stock); err != nil {
			return err
		}
		var hasIn bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='IN')`, eventID, pid).Scan(&hasIn); err != nil {
			return err
		}
		if !hasIn {
			if _, err := s.pool.Exec(ctx, `INSERT INTO stock_movements (event_id, product_id, type, qty, reason, actor) VALUES ($1,$2,'IN',$3,'seed','seed')`, eventID, pid, p.stock); err != nil {
				return err
			}
		}
	}

	// bundle
	var bundleID int64
	if err := s.pool.QueryRow(ctx, `SELECT id FROM products WHERE sku='PKG-001'`).Scan(&bundleID); errors.Is(err, pgx.ErrNoRows) {
		if err := s.pool.QueryRow(ctx, `INSERT INTO products (sku, name, category, is_bundle) VALUES ('PKG-001','Paket Hemat Bazaar','Paket',true) RETURNING id`).Scan(&bundleID); err != nil {
			return err
		}
		if _, err := s.pool.Exec(ctx, `INSERT INTO bundle_components (bundle_id, component_id, component_qty) VALUES ($1,$2,1),($1,$3,1)`, bundleID, kaosID, tumblerID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO event_products (event_id, product_id, price, stock_total, is_active)
		VALUES ($1,$2,130000,0,true)
		ON CONFLICT (event_id, product_id) DO UPDATE SET price=EXCLUDED.price`, eventID, bundleID); err != nil {
		return err
	}
	return nil
}
