package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Stock mengelola ledger stock_movements dengan reservasi atomik (anti-oversell).
type Stock struct {
	pool *pgxpool.Pool
}

func NewStock(pool *pgxpool.Pool) *Stock { return &Stock{pool: pool} }

// Availability menghitung total, reserved, sold, available untuk produk di event.
func (s *Stock) Availability(ctx context.Context, eventID, productID int64) (total, reserved, sold, available int, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT ep.stock_total,
		       COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='RESERVE'),0)
		       - COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='UNRESERVE'),0)
		       - COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='PICK'),0),
		       COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='PICK'),0)
		       - COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='RETURN'),0)
		FROM event_products ep WHERE ep.event_id=$1 AND ep.product_id=$2`,
		eventID, productID).Scan(&total, &reserved, &sold)
	if err == pgx.ErrNoRows {
		return 0, 0, 0, 0, nil
	}
	if err != nil {
		return 0, 0, 0, 0, err
	}
	return total, reserved, sold, total - reserved - sold, nil
}

// availabilityTx menghitung available di dalam transaksi dengan row lock.
func availabilityTx(ctx context.Context, tx pgx.Tx, eventID, productID int64) (int, error) {
	var avail int
	err := tx.QueryRow(ctx, `
		SELECT ep.stock_total
		       - COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='RESERVE'),0)
		       + COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='UNRESERVE'),0)
		       + COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='RETURN'),0)
		FROM event_products ep WHERE ep.event_id=$1 AND ep.product_id=$2 FOR UPDATE`,
		eventID, productID).Scan(&avail)
	return avail, err
}

func insertMovement(ctx context.Context, tx pgx.Tx, eventID, productID, qty int64, typ, refType string, refID int64, reason, actor string) error {
	_, err := tx.Exec(ctx, `INSERT INTO stock_movements (event_id, product_id, type, qty, ref_type, ref_id, reason, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		eventID, productID, typ, qty, refType, refID, reason, actor)
	return err
}

// Reserve mereservasi stok. Error jika available tidak cukup.
func (s *Stock) Reserve(ctx context.Context, eventID, productID, qty int64, refType string, refID int64, reason, actor string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	avail, err := availabilityTx(ctx, tx, eventID, productID)
	if err != nil {
		return err
	}
	if int64(avail) < qty {
		return fmt.Errorf("stok tidak cukup: butuh %d, tersedia %d", qty, avail)
	}
	if err := insertMovement(ctx, tx, eventID, productID, qty, "RESERVE", refType, refID, reason, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Unreserve melepas reservasi (batal sebelum di-pick).
func (s *Stock) Unreserve(ctx context.Context, eventID, productID, qty int64, refType string, refID int64, reason, actor string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	reserved, err := reservedTx(ctx, tx, eventID, productID)
	if err != nil {
		return err
	}
	if int64(reserved) < qty {
		return fmt.Errorf("reservasi tidak cukup: butuh %d, ada %d", qty, reserved)
	}
	if err := insertMovement(ctx, tx, eventID, productID, qty, "UNRESERVE", refType, refID, reason, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Pick memindahkan stok dari reserved ke sold (picked).
func (s *Stock) Pick(ctx context.Context, eventID, productID, qty int64, refType string, refID int64, reason, actor string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	reserved, err := reservedTx(ctx, tx, eventID, productID)
	if err != nil {
		return err
	}
	if int64(reserved) < qty {
		return fmt.Errorf("reservasi tidak cukup untuk dipick: butuh %d, ada %d", qty, reserved)
	}
	if err := insertMovement(ctx, tx, eventID, productID, qty, "PICK", refType, refID, reason, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Return mengembalikan stok yang sudah dipick ke available.
func (s *Stock) Return(ctx context.Context, eventID, productID, qty int64, refType string, refID int64, reason, actor string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := insertMovement(ctx, tx, eventID, productID, qty, "RETURN", refType, refID, reason, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Adjust mengubah stock_total dengan pencatatan AUDIT (alasan wajib).
func (s *Stock) Adjust(ctx context.Context, eventID, productID, newTotal int64, reason, actor string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var oldTotal int64
	if err := tx.QueryRow(ctx, `SELECT stock_total FROM event_products WHERE event_id=$1 AND product_id=$2 FOR UPDATE`, eventID, productID).Scan(&oldTotal); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE event_products SET stock_total=$1 WHERE event_id=$2 AND product_id=$3`, newTotal, eventID, productID); err != nil {
		return err
	}
	if err := insertMovement(ctx, tx, eventID, productID, newTotal-oldTotal, "ADJUST", "", 0, reason, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Inbound menambah stok fisik (terima barang masuk) dengan pencatatan ledger.
func (s *Stock) Inbound(ctx context.Context, eventID, productID, qty int64, reason, actor string) error {
	if qty <= 0 {
		return fmt.Errorf("qty harus lebih dari 0")
	}
	if reason == "" {
		return fmt.Errorf("alasan wajib diisi")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE event_products SET stock_total = stock_total + $1 WHERE event_id=$2 AND product_id=$3`, qty, eventID, productID); err != nil {
		return err
	}
	if err := insertMovement(ctx, tx, eventID, productID, qty, "IN", "", 0, reason, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func reservedTx(ctx context.Context, tx pgx.Tx, eventID, productID int64) (int, error) {
	var r int
	err := tx.QueryRow(ctx, `
		SELECT COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='RESERVE'),0)
		       - COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='UNRESERVE'),0)
		       - COALESCE((SELECT SUM(qty) FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='PICK'),0)`,
		eventID, productID).Scan(&r)
	return r, err
}
