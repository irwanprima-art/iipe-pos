package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Notifier mengirim webhook ke n8n (untuk notifikasi WhatsApp) saat order ready.
type Notifier struct {
	pool  *pgxpool.Pool
	url   string
	httpC *http.Client
}

func NewNotifier(pool *pgxpool.Pool, url string) *Notifier {
	return &Notifier{pool: pool, httpC: &http.Client{Timeout: 5 * time.Second}, url: url}
}

func (n *Notifier) OrderReady(ctx context.Context, orderID int64, phone, name, eventName, orderNo string, pickupNo *int) {
	payload := map[string]any{
		"event":          "order.ready",
		"order_id":       orderID,
		"order_no":       orderNo,
		"customer_name":  name,
		"customer_phone": phone,
		"event_name":     eventName,
		"pickup_no":      pickupNo,
		"message":        "Halo " + name + ", pesanan Anda sudah siap diambil di event " + eventName + ". Silakan datang dengan menunjukkan QR code order Anda. Terima kasih!",
	}
	status := "sent"
	if n.url != "" {
		body, _ := json.Marshal(payload)
		go func() {
			resp, err := n.httpC.Post(n.url, "application/json", bytes.NewReader(body))
			if err != nil {
				status = "failed"
			} else {
				resp.Body.Close()
			}
			_ = status
		}()
	} else {
		status = "skipped" // dev mode tanpa n8n: dicatat saja
	}
	pb, _ := json.Marshal(payload)
	_, _ = n.pool.Exec(context.Background(),
		`INSERT INTO notification_logs (order_id, channel, status, payload) VALUES ($1,'whatsapp',$2,$3)`,
		orderID, status, pb)
}

// HasChannel true bila kanal WhatsApp (n8n) dikonfigurasi.
func (n *Notifier) HasChannel() bool { return n.url != "" }

// SendWhatsApp mengirim pesan WA via n8n (best-effort, async).
func (n *Notifier) SendWhatsApp(phone, message string) {
	if n.url == "" {
		return
	}
	payload := map[string]any{"event": "whatsapp", "phone": phone, "message": message}
	body, _ := json.Marshal(payload)
	go func() {
		resp, err := n.httpC.Post(n.url, "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
		}
	}()
}
