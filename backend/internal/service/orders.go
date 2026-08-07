package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"iipe/backend/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CartItem struct {
	ProductID int64  `json:"product_id"`
	Qty       int    `json:"qty"`
	ItemType  string `json:"item_type"` // product | bundle
}

type Orders struct {
	pool   *pgxpool.Pool
	notify *Notifier
	pay    *Payments
}

func NewOrders(pool *pgxpool.Pool, notify *Notifier, pay *Payments) *Orders {
	return &Orders{pool: pool, notify: notify, pay: pay}
}

func tokenStr(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func setOrderStatusTx(ctx context.Context, tx pgx.Tx, orderID int64, status, actor string) error {
	if _, err := tx.Exec(ctx, `UPDATE orders SET status=$1, updated_at=now() WHERE id=$2`, status, orderID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, status, actor) VALUES ($1,$2,$3)`, orderID, status, actor)
	return err
}

// Checkout membuat order online (pending_payment), mereservasi stok, membuat payment QRIS.
func (o *Orders) Checkout(ctx context.Context, eventID int64, items []CartItem, name, phone string) (domain.Order, error) {
	if len(items) == 0 {
		return domain.Order{}, errors.New("keranjang kosong")
	}
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return domain.Order{}, err
	}
	defer tx.Rollback(ctx)

	orderNo := "IIPE-" + time.Now().Format("20060102") + "-" + tokenStr(3)[:6]
	qr := tokenStr(16)
	reservedUntil := time.Now().Add(15 * time.Minute)

	var orderID int64
	var total int
	var itemRows []domain.OrderItem

	for _, it := range items {
		if it.Qty <= 0 {
			return domain.Order{}, errors.New("qty tidak valid")
		}
		var price int
		var sku, pname string
		err := tx.QueryRow(ctx, `
			SELECT ep.price, pr.sku, pr.name FROM event_products ep
			JOIN products pr ON pr.id = ep.product_id
			WHERE ep.event_id=$1 AND ep.product_id=$2 AND ep.is_active`, eventID, it.ProductID).
			Scan(&price, &sku, &pname)
		if err != nil {
			return domain.Order{}, fmt.Errorf("produk tidak tersedia: %w", err)
		}

		if it.ItemType == "bundle" {
			rows, err := tx.Query(ctx, `SELECT component_id, component_qty FROM bundle_components WHERE bundle_id=$1`, it.ProductID)
			if err != nil {
				return domain.Order{}, err
			}
			type comp struct {
				id  int64
				qty int
			}
			var comps []comp
			for rows.Next() {
				var c comp
				if err := rows.Scan(&c.id, &c.qty); err != nil {
					rows.Close()
					return domain.Order{}, err
				}
				comps = append(comps, c)
			}
			rows.Close()
			if len(comps) == 0 {
				return domain.Order{}, errors.New("bundle tanpa komponen")
			}
			// baris bundle (untuk display/harga)
			itemRows = append(itemRows, domain.OrderItem{ItemType: "bundle", ProductID: it.ProductID, SKU: sku, Name: pname, Qty: it.Qty, Price: price, State: "allocated"})
			for _, c := range comps {
				avail, err := availabilityTx(ctx, tx, eventID, c.id)
				if err != nil {
					return domain.Order{}, err
				}
				need := c.qty * it.Qty
				if avail < need {
					return domain.Order{}, fmt.Errorf("stok komponen %s tidak cukup", sku)
				}
				if err := insertMovement(ctx, tx, eventID, c.id, int64(need), "RESERVE", "order", 0, "checkout bundle", name); err != nil {
					return domain.Order{}, err
				}
				itemRows = append(itemRows, domain.OrderItem{ItemType: "component", ProductID: c.id, SKU: sku, Name: pname, Qty: need, Price: 0, State: "allocated"})
			}
		} else {
			avail, err := availabilityTx(ctx, tx, eventID, it.ProductID)
			if err != nil {
				return domain.Order{}, err
			}
			if avail < it.Qty {
				return domain.Order{}, fmt.Errorf("stok %s tidak cukup (sisa %d)", sku, avail)
			}
			if err := insertMovement(ctx, tx, eventID, it.ProductID, int64(it.Qty), "RESERVE", "order", 0, "checkout", name); err != nil {
				return domain.Order{}, err
			}
			itemRows = append(itemRows, domain.OrderItem{ItemType: "product", ProductID: it.ProductID, SKU: sku, Name: pname, Qty: it.Qty, Price: price, State: "allocated"})
		}
		total += price * it.Qty
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO orders (order_no, event_id, channel, status, customer_name, customer_phone, total, qr_code, reserved_until)
		VALUES ($1,$2,'online','pending_payment',$3,$4,$5,$6,$7) RETURNING id`,
		orderNo, eventID, name, phone, total, qr, reservedUntil).Scan(&orderID)
	if err != nil {
		return domain.Order{}, err
	}

	var parentID int64
	for _, it := range itemRows {
		var pID sql.NullInt64
		if it.ItemType == "component" {
			pID = sql.NullInt64{Int64: parentID, Valid: true}
		}
		var id int64
		err := tx.QueryRow(ctx, `
			INSERT INTO order_items (order_id, item_type, parent_id, product_id, qty, price, state)
			VALUES ($1,$2,$3,$4,$5,$6,'allocated') RETURNING id`,
			orderID, it.ItemType, pID, it.ProductID, it.Qty, it.Price).Scan(&id)
		if err != nil {
			return domain.Order{}, err
		}
		if it.ItemType == "bundle" {
			parentID = id
		}
	}
	// tandai semua movement RESERVE milik order ini
	if _, err := tx.Exec(ctx, `UPDATE stock_movements SET ref_id=$1 WHERE ref_type='order' AND ref_id=0`, orderID); err != nil {
		return domain.Order{}, err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "pending_payment", "checkout"); err != nil {
		return domain.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Order{}, err
	}

	pay, err := o.pay.CreateQRIS(ctx, orderID, total, orderNo)
	if err != nil {
		return domain.Order{}, err
	}
	// perpanjang reservasi stok mengikuti masa berlaku pembayaran (mis. SumoPay hingga 24 jam)
	if pay.ExpiresAt != nil {
		_, _ = o.pool.Exec(ctx, `UPDATE orders SET reserved_until=$1, updated_at=now() WHERE id=$2`, *pay.ExpiresAt, orderID)
	}

	ord, err := o.Get(ctx, orderID)
	if err != nil {
		return domain.Order{}, err
	}
	ord.Payment = &pay
	return ord, nil
}

// PosCheckout membuat order POS yang langsung selesai (handed over) dengan stock PICK langsung.
// edcRef: nomor referensi struk EDC (wajib untuk metode edc).
func (o *Orders) PosCheckout(ctx context.Context, eventID int64, method string, items []CartItem, customerName, actor, edcRef string) (domain.Order, error) {
	if len(items) == 0 {
		return domain.Order{}, errors.New("keranjang kosong")
	}
	if customerName == "" {
		customerName = "Kasir POS"
	}
	if edcRef == "" {
		edcRef = "POS-" + tokenStr(4)
	}
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return domain.Order{}, err
	}
	defer tx.Rollback(ctx)

	orderNo := "POS-" + time.Now().Format("20060102") + "-" + tokenStr(3)[:6]
	qr := tokenStr(16)
	var orderID int64
	var total int
	var itemRows []domain.OrderItem

	for _, it := range items {
		var price int
		var sku, pname string
		if err := tx.QueryRow(ctx, `
			SELECT ep.price, pr.sku, pr.name FROM event_products ep
			JOIN products pr ON pr.id = ep.product_id
			WHERE ep.event_id=$1 AND ep.product_id=$2 AND ep.is_active`, eventID, it.ProductID).
			Scan(&price, &sku, &pname); err != nil {
			return domain.Order{}, fmt.Errorf("produk tidak tersedia: %w", err)
		}

		if it.ItemType == "bundle" {
			rows, err := tx.Query(ctx, `SELECT component_id, component_qty FROM bundle_components WHERE bundle_id=$1`, it.ProductID)
			if err != nil {
				return domain.Order{}, err
			}
			type comp struct {
				id  int64
				qty int
			}
			var comps []comp
			for rows.Next() {
				var c comp
				rows.Scan(&c.id, &c.qty)
				comps = append(comps, c)
			}
			rows.Close()
			if len(comps) == 0 {
				return domain.Order{}, errors.New("bundle tanpa komponen")
			}
			itemRows = append(itemRows, domain.OrderItem{ItemType: "bundle", ProductID: it.ProductID, SKU: sku, Name: pname, Qty: it.Qty, Price: price, State: "picked"})
			for _, c := range comps {
				avail, err := availabilityTx(ctx, tx, eventID, c.id)
				if err != nil {
					return domain.Order{}, err
				}
				need := c.qty * it.Qty
				if avail < need {
					return domain.Order{}, fmt.Errorf("stok komponen %s tidak cukup", sku)
				}
				if err := insertMovement(ctx, tx, eventID, c.id, int64(need), "RESERVE", "order", 0, "pos", actor); err != nil {
					return domain.Order{}, err
				}
				if err := insertMovement(ctx, tx, eventID, c.id, int64(need), "PICK", "order", 0, "pos", actor); err != nil {
					return domain.Order{}, err
				}
				itemRows = append(itemRows, domain.OrderItem{ItemType: "component", ProductID: c.id, SKU: sku, Name: pname, Qty: need, Price: 0, State: "picked"})
			}
		} else {
			avail, err := availabilityTx(ctx, tx, eventID, it.ProductID)
			if err != nil {
				return domain.Order{}, err
			}
			if avail < it.Qty {
				return domain.Order{}, fmt.Errorf("stok %s tidak cukup (sisa %d)", sku, avail)
			}
			if err := insertMovement(ctx, tx, eventID, it.ProductID, int64(it.Qty), "RESERVE", "order", 0, "pos", actor); err != nil {
				return domain.Order{}, err
			}
			if err := insertMovement(ctx, tx, eventID, it.ProductID, int64(it.Qty), "PICK", "order", 0, "pos", actor); err != nil {
				return domain.Order{}, err
			}
			itemRows = append(itemRows, domain.OrderItem{ItemType: "product", ProductID: it.ProductID, SKU: sku, Name: pname, Qty: it.Qty, Price: price, State: "picked"})
		}
		total += price * it.Qty
	}

	if err := tx.QueryRow(ctx, `
		INSERT INTO orders (order_no, event_id, channel, status, customer_name, customer_phone, total, qr_code, payment_method)
		VALUES ($1,$2,'pos','completed',$3,$4,$5,$6,$7) RETURNING id`,
		orderNo, eventID, customerName, "", total, qr, method).Scan(&orderID); err != nil {
		return domain.Order{}, err
	}

	var parentID int64
	for _, it := range itemRows {
		var pID sql.NullInt64
		if it.ItemType == "component" {
			pID = sql.NullInt64{Int64: parentID, Valid: true}
		}
		var id int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO order_items (order_id, item_type, parent_id, product_id, qty, price, state)
			VALUES ($1,$2,$3,$4,$5,$6,'picked') RETURNING id`,
			orderID, it.ItemType, pID, it.ProductID, it.Qty, it.Price).Scan(&id); err != nil {
			return domain.Order{}, err
		}
		if it.ItemType == "bundle" {
			parentID = id
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE stock_movements SET ref_id=$1 WHERE ref_type='order' AND ref_id=0`, orderID); err != nil {
		return domain.Order{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO payments (order_id, method, amount, status, provider_ref, ref_no) VALUES ($1,$2,$3,'paid',$4,$5)`,
		orderID, method, total, edcRef, orderNo); err != nil {
		return domain.Order{}, err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "paid", "pos"); err != nil {
		return domain.Order{}, err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "handed_over", "pos"); err != nil {
		return domain.Order{}, err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "completed", "pos"); err != nil {
		return domain.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Order{}, err
	}
	return o.Get(ctx, orderID)
}

// PickAll mem-pick seluruh item produk/komponen order. Hanya valid dari paid/picking.
func (o *Orders) PickAll(ctx context.Context, orderID int64, actor string) error {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var eventID int64
	if err := tx.QueryRow(ctx, `SELECT status, event_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status, &eventID); err != nil {
		return err
	}
	if status != "paid" && status != "picking" && status != "picked" {
		return fmt.Errorf("order status %s tidak bisa di-pick", status)
	}
	rows, err := tx.Query(ctx, `SELECT id, product_id, qty, state FROM order_items WHERE order_id=$1 AND item_type IN ('product','component')`, orderID)
	if err != nil {
		return err
	}
	type line struct {
		id, pid, qty int64
		state        string
	}
	var lines []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.id, &l.pid, &l.qty, &l.state); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, l)
	}
	rows.Close()
	for _, l := range lines {
		if l.state == "cancelled" {
			continue
		}
		if l.state == "allocated" {
			if err := insertMovement(ctx, tx, eventID, l.pid, l.qty, "PICK", "order", orderID, "pick", actor); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE order_items SET state='picked' WHERE id=$1`, l.id); err != nil {
			return err
		}
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "picked", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PickItem mem-pick sebagian produk dari order berdasarkan scan barcode
// (pcs = 1, carton = qty_per_carton). Memverifikasi item ada & tidak melebihi qty order.
func (o *Orders) PickItem(ctx context.Context, orderID, productID, qty int64, actor string) error {
	if qty <= 0 {
		return fmt.Errorf("qty harus lebih dari 0")
	}
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var eventID int64
	if err := tx.QueryRow(ctx, `SELECT status, event_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status, &eventID); err != nil {
		return err
	}
	if status != "paid" && status != "picking" && status != "picked" {
		return fmt.Errorf("order status %s tidak bisa di-pick", status)
	}
	var itemQty int
	if err := tx.QueryRow(ctx, `
		SELECT qty FROM order_items
		WHERE order_id=$1 AND product_id=$2 AND item_type IN ('product','component') AND state != 'cancelled'`,
		orderID, productID).Scan(&itemQty); err != nil {
		return fmt.Errorf("produk tidak ada di order ini")
	}
	var picked int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(qty),0) FROM stock_movements
		WHERE ref_type='order' AND ref_id=$1 AND product_id=$2 AND type='PICK'`,
		orderID, productID).Scan(&picked); err != nil {
		return err
	}
	if qty > int64(itemQty-picked) {
		return fmt.Errorf("scan berlebih: butuh %d, sudah di-pick %d", itemQty, picked)
	}
	if err := insertMovement(ctx, tx, eventID, productID, qty, "PICK", "order", orderID, "pick barcode", actor); err != nil {
		return err
	}
	if picked+int(qty) >= itemQty {
		if _, err := tx.Exec(ctx, `UPDATE order_items SET state='picked'
			WHERE order_id=$1 AND product_id=$2 AND item_type IN ('product','component') AND state != 'cancelled'`,
			orderID, productID); err != nil {
			return err
		}
	}
	// status order: picking saat masih ada sisa, picked saat semua item selesai
	var remaining int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM order_items
		WHERE order_id=$1 AND item_type IN ('product','component') AND state='allocated'`, orderID).Scan(&remaining); err != nil {
		return err
	}
	if remaining == 0 {
		if err := setOrderStatusTx(ctx, tx, orderID, "picked", actor); err != nil {
			return err
		}
	} else if status == "paid" {
		if err := setOrderStatusTx(ctx, tx, orderID, "picking", actor); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Pack menandai order packed dan memberi nomor pickup berurutan per event.
func (o *Orders) Pack(ctx context.Context, orderID int64, actor string) (int, error) {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var status string
	var eventID int64
	if err := tx.QueryRow(ctx, `SELECT status, event_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status, &eventID); err != nil {
		return 0, err
	}
	if status != "picked" && status != "packing" {
		return 0, fmt.Errorf("order status %s tidak bisa di-pack", status)
	}
	var max sql.NullInt64
	if err := tx.QueryRow(ctx, `SELECT MAX(pickup_no) FROM orders WHERE event_id=$1 AND pickup_no IS NOT NULL`, eventID).Scan(&max); err != nil {
		return 0, err
	}
	pickupNo := 1
	if max.Valid {
		pickupNo = int(max.Int64) + 1
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET pickup_no=$1, status='packed', updated_at=now() WHERE id=$2`, pickupNo, orderID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `UPDATE order_items SET state='packed' WHERE order_id=$1 AND item_type IN ('product','component') AND state IN ('allocated','picked')`, orderID); err != nil {
		return 0, err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "packed", actor); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return pickupNo, nil
}

// MarkReady menandai ready dan mengirim notifikasi (n8n/WhatsApp).
func (o *Orders) MarkReady(ctx context.Context, orderID int64, actor string) error {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return err
	}
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status); err != nil {
		tx.Rollback(ctx)
		return err
	}
	if status != "packed" && status != "ready" {
		tx.Rollback(ctx)
		return fmt.Errorf("order status %s tidak bisa jadi ready", status)
	}
	if status != "ready" {
		if err := setOrderStatusTx(ctx, tx, orderID, "ready", actor); err != nil {
			tx.Rollback(ctx)
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if o.notify != nil {
		ord, err := o.Get(ctx, orderID)
		if err == nil {
			o.notify.OrderReady(ctx, ord.ID, ord.CustomerPhone, ord.CustomerName, ord.EventName, ord.OrderNo, ord.PickupNo)
		}
	}
	return nil
}

// Handover menandai order selesai diserahkan ke customer.
func (o *Orders) Handover(ctx context.Context, orderID int64, actor string) error {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status); err != nil {
		return err
	}
	if status != "ready" && status != "packed" {
		return fmt.Errorf("order status %s tidak bisa handover", status)
	}
	if _, err := tx.Exec(ctx, `UPDATE order_items SET state='handed_over' WHERE order_id=$1 AND item_type IN ('product','component')`, orderID); err != nil {
		return err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "handed_over", actor); err != nil {
		return err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "completed", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Cancel membatalkan order: melepas reservasi atau mengembalikan stok yang sudah dipick.
func (o *Orders) Cancel(ctx context.Context, orderID int64, actor, reason string) error {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var eventID int64
	if err := tx.QueryRow(ctx, `SELECT status, event_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status, &eventID); err != nil {
		return err
	}
	if status == "completed" || status == "handed_over" || status == "cancelled" {
		return fmt.Errorf("order status %s tidak bisa dibatalkan", status)
	}
	rows, err := tx.Query(ctx, `SELECT product_id, qty, state FROM order_items WHERE order_id=$1 AND item_type IN ('product','component')`, orderID)
	if err != nil {
		return err
	}
	type line struct {
		pid, qty int64
		state    string
	}
	var lines []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.pid, &l.qty, &l.state); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, l)
	}
	rows.Close()
	for _, l := range lines {
		if l.state == "cancelled" {
			continue
		}
		if l.state == "allocated" {
			if err := insertMovement(ctx, tx, eventID, l.pid, l.qty, "UNRESERVE", "order", orderID, reason, actor); err != nil {
				return err
			}
		} else if l.state == "picked" || l.state == "packed" {
			if err := insertMovement(ctx, tx, eventID, l.pid, l.qty, "RETURN", "order", orderID, reason, actor); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE order_items SET state='cancelled' WHERE order_id=$1 AND product_id=$2`, orderID, l.pid); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status='refunded' WHERE order_id=$1 AND status='paid'`, orderID); err != nil {
		return err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "cancelled", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SweepExpired membatalkan order pending_payment yang reservasinya kedaluwarsa.
func (o *Orders) SweepExpired(ctx context.Context) error {
	rows, err := o.pool.Query(ctx, `SELECT id FROM orders WHERE status='pending_payment' AND reserved_until < now() LIMIT 100`)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		_ = o.Cancel(ctx, id, "system", "timeout pembayaran")
	}
	return nil
}

func (o *Orders) Get(ctx context.Context, orderID int64) (domain.Order, error) {
	return o.loadOrder(ctx, `ord.id=$1`, orderID)
}

func (o *Orders) GetByToken(ctx context.Context, token string) (domain.Order, error) {
	return o.loadOrder(ctx, `(ord.qr_code=$1 OR ord.order_no=$1)`, token)
}

func (o *Orders) List(ctx context.Context, status string, eventID int64, from, to string) ([]domain.Order, error) {
	q := `SELECT id FROM orders WHERE 1=1`
	var args []any
	if status != "" {
		args = append(args, status)
		q += fmt.Sprintf(" AND status=$%d", len(args))
	}
	if eventID > 0 {
		args = append(args, eventID)
		q += fmt.Sprintf(" AND event_id=$%d", len(args))
	}
	if from != "" {
		args = append(args, from)
		q += fmt.Sprintf(" AND created_at::date >= $%d", len(args))
	}
	if to != "" {
		args = append(args, to)
		q += fmt.Sprintf(" AND created_at::date <= $%d", len(args))
	}
	q += ` ORDER BY id DESC LIMIT 300`
	rows, err := o.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Order{}
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ord, err := o.Get(ctx, id)
		if err == nil {
			out = append(out, ord)
		}
	}
	return out, rows.Err()
}

// ListByPhone mengembalikan order milik customer (berdasarkan nomor WA).
func (o *Orders) ListByPhone(ctx context.Context, phone string) ([]domain.Order, error) {
	rows, err := o.pool.Query(ctx, `SELECT id FROM orders WHERE customer_phone=$1 ORDER BY id DESC LIMIT 50`, phone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Order{}
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ord, err := o.Get(ctx, id)
		if err == nil {
			out = append(out, ord)
		}
	}
	return out, rows.Err()
}

func (o *Orders) loadOrder(ctx context.Context, where string, args ...any) (domain.Order, error) {
	var ord domain.Order
	var eventName string
	var pickup sql.NullInt64
	err := o.pool.QueryRow(ctx, `
		SELECT ord.id, ord.order_no, ord.event_id, ev.name, ord.channel, ord.status,
		       COALESCE(ord.customer_name,''), COALESCE(ord.customer_phone,''),
		       ord.total, ord.qr_code, ord.pickup_no, COALESCE(ord.payment_method,''), COALESCE(ord.provider_ref,''),
		       ord.reserved_until, ord.created_at
		FROM orders ord JOIN events ev ON ev.id = ord.event_id
		WHERE `+where, args...).Scan(&ord.ID, &ord.OrderNo, &ord.EventID, &eventName, &ord.Channel, &ord.Status,
		&ord.CustomerName, &ord.CustomerPhone, &ord.Total, &ord.QRCode, &pickup, &ord.PaymentMethod, &ord.ProviderRef,
		&ord.ReservedUntil, &ord.CreatedAt)
	if err != nil {
		return ord, err
	}
	ord.EventName = eventName
	if pickup.Valid {
		p := int(pickup.Int64)
		ord.PickupNo = &p
	}

	rows, err := o.pool.Query(ctx, `
		SELECT oi.id, oi.item_type, oi.parent_id, pr.sku, pr.name, oi.qty, oi.price, oi.state,
		       COALESCE((SELECT SUM(sm.qty) FROM stock_movements sm
		                 WHERE sm.ref_type='order' AND sm.ref_id=oi.order_id
		                   AND sm.product_id=oi.product_id AND sm.type='PICK'),0)
		FROM order_items oi JOIN products pr ON pr.id = oi.product_id
		WHERE oi.order_id=$1 ORDER BY oi.id`, ord.ID)
	if err != nil {
		return ord, err
	}
	defer rows.Close()
	for rows.Next() {
		var it domain.OrderItem
		var pid sql.NullInt64
		if err := rows.Scan(&it.ID, &it.ItemType, &pid, &it.SKU, &it.Name, &it.Qty, &it.Price, &it.State, &it.PickedQty); err != nil {
			return ord, err
		}
		if pid.Valid {
			it.ParentID = pid.Int64
		}
		ord.Items = append(ord.Items, it)
	}
	if err := rows.Err(); err != nil {
		return ord, err
	}

	var pay domain.Payment
	err = o.pool.QueryRow(ctx, `SELECT id, order_id, method, amount, status, provider_ref, COALESCE(ref_no,'') FROM payments WHERE order_id=$1 ORDER BY id DESC LIMIT 1`, ord.ID).
		Scan(&pay.ID, &pay.OrderID, &pay.Method, &pay.Amount, &pay.Status, &pay.ProviderRef, &pay.RefNo)
	if err == nil {
		ord.Payment = &pay
	}

	// riwayat status order (siapa & kapan setiap tahapan)
	hrows, err := o.pool.Query(ctx, `SELECT status, COALESCE(actor,''), created_at FROM order_status_history WHERE order_id=$1 ORDER BY id`, ord.ID)
	if err == nil {
		defer throws.Close()
		for throws.Next() {
			var h domain.StatusHistory
			if err := throws.Scan(&h.Status, &h.Actor, &h.CreatedAt); err == nil {
				ord.History = append(ord.History, h)
			}
		}
	}
	return ord, nil
}
