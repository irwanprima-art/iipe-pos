package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"iipe/backend/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Payments struct {
	pool     *pgxpool.Pool
	provider string // mock | sumopay
	sumoURL  string
	sumoKey  string
	baseURL  string // URL publik aplikasi untuk redirect payment
	httpC    *http.Client
}

func NewPayments(pool *pgxpool.Pool, provider, sumoURL, sumoKey, baseURL string) *Payments {
	return &Payments{
		pool:     pool,
		provider: provider,
		sumoURL:  strings.TrimSuffix(sumoURL, "/"),
		sumoKey:  sumoKey,
		baseURL:  strings.TrimSuffix(baseURL, "/"),
		httpC:    &http.Client{Timeout: 15 * time.Second},
	}
}

// CreateQRIS membuat pembayaran QRIS untuk sebuah order.
// provider=sumopay → panggil SumoPay API dan simpan payment link (hosted payment page).
// provider=mock → payment pending tiruan (demo / tanpa kredensial).
func (p *Payments) CreateQRIS(ctx context.Context, orderID int64, amount int, ref string) (domain.Payment, error) {
	if p.provider == "sumopay" {
		return p.createSumopay(ctx, orderID, amount, ref)
	}
	pay := domain.Payment{
		OrderID:     orderID,
		Method:      "qris",
		Amount:      amount,
		Status:      "pending",
		ProviderRef: "MOCK-QRIS-" + ref,
	}
	var id int64
	err := p.pool.QueryRow(ctx, `
		INSERT INTO payments (order_id, method, amount, status, provider_ref, payment_link_url)
		VALUES ($1,$2,$3,$4,$5,'') RETURNING id`,
		pay.OrderID, pay.Method, pay.Amount, pay.Status, pay.ProviderRef).Scan(&id)
	pay.ID = id
	return pay, err
}

type sumopayCreateResp struct {
	PaymentID       string `json:"payment_id"`
	OrderID         string `json:"order_id"`
	Amount          int    `json:"amount"`
	Fee             int    `json:"fee"`
	NetAmount       int    `json:"net_amount"`
	PaymentLinkURL  string `json:"payment_link_url"`
	PaymentCode     string `json:"payment_code"`
	PaymentCodeType string `json:"payment_code_type"`
	PaymentChannel  string `json:"payment_channel_used"`
	Status          string `json:"status"`
	ExpiresAt       string `json:"expires_at"`
}

func (p *Payments) createSumopay(ctx context.Context, orderID int64, amount int, ref string) (domain.Payment, error) {
	body := map[string]any{
		"order_id":                 ref,
		"amount":                   amount,
		"currency":                 "IDR",
		"expires_in_hours":         24,
		"payment_method_type_code": "QRIS",
	}
	// Redirect hasil pembayaran. SumoPay menambahkan &order_id=...&status=... sendiri,
	// jadi kirim order_id (order_no) sebagai param agar halaman tahu order mana.
	if p.baseURL != "" {
		body["success_return_url"] = p.baseURL + "/payment/result?result=success&order_id=" + url.QueryEscape(ref)
		body["cancel_return_url"] = p.baseURL + "/payment/result?result=cancelled&order_id=" + url.QueryEscape(ref)
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.sumoURL+"/api/v1/payments", bytes.NewReader(payload))
	if err != nil {
		return domain.Payment{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", p.sumoKey)

	resp, err := p.httpC.Do(req)
	if err != nil {
		return domain.Payment{}, fmt.Errorf("sumopay: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return domain.Payment{}, fmt.Errorf("sumopay: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var sr sumopayCreateResp
	if err := json.Unmarshal(respBody, &sr); err != nil {
		return domain.Payment{}, fmt.Errorf("sumopay: parse response: %w", err)
	}
	if sr.PaymentID == "" {
		return domain.Payment{}, fmt.Errorf("sumopay: response tanpa payment_id: %s", string(respBody))
	}
	pay := domain.Payment{
		OrderID:        orderID,
		Method:         "qris",
		Amount:         amount,
		Status:         "pending",
		ProviderRef:    sr.PaymentID,
		PaymentLinkURL: sr.PaymentLinkURL,
	}
	if t, err := time.Parse(time.RFC3339, sr.ExpiresAt); err == nil {
		pay.ExpiresAt = &t
	}
	var id int64
	err = p.pool.QueryRow(ctx, `
		INSERT INTO payments (order_id, method, amount, status, provider_ref, payment_link_url)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		pay.OrderID, pay.Method, pay.Amount, pay.Status, pay.ProviderRef, pay.PaymentLinkURL).Scan(&id)
	pay.ID = id
	return pay, err
}

// Confirm menandai payment + order menjadi PAID berdasarkan provider_ref (idempotent).
func (p *Payments) Confirm(ctx context.Context, providerRef string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var payID, orderID int64
	err = tx.QueryRow(ctx, `SELECT id, order_id FROM payments WHERE provider_ref=$1 FOR UPDATE`, providerRef).Scan(&payID, &orderID)
	if err != nil {
		return fmt.Errorf("pembayaran tidak ditemukan: %w", err)
	}
	var payStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM payments WHERE id=$1`, payID).Scan(&payStatus); err != nil {
		return err
	}
	if payStatus == "paid" {
		return nil // idempotent
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status='paid' WHERE id=$1`, payID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET payment_method='qris', provider_ref=$1, updated_at=now() WHERE id=$2`, providerRef, orderID); err != nil {
		return err
	}
	if err := setOrderStatusTx(ctx, tx, orderID, "paid", "payment-webhook"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetStatus memperbarui status payment (failed/expired) bila masih pending, dan mengembalikan orderID.
func (p *Payments) SetStatus(ctx context.Context, providerRef, status string) (int64, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var orderID int64
	var cur string
	err = tx.QueryRow(ctx, `SELECT order_id, status FROM payments WHERE provider_ref=$1 FOR UPDATE`, providerRef).Scan(&orderID, &cur)
	if err != nil {
		return 0, fmt.Errorf("pembayaran tidak ditemukan: %w", err)
	}
	if cur != "pending" {
		return orderID, nil // sudah final
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status=$1 WHERE provider_ref=$2`, status, providerRef); err != nil {
		return 0, err
	}
	return orderID, tx.Commit(ctx)
}
