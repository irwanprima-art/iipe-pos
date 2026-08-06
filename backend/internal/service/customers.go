package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NormalizePhone: hanya digit; 08xx → 628xx.
func NormalizePhone(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if strings.HasPrefix(s, "0") {
		s = "62" + s[1:]
	}
	return s
}

// ValidPhone: panjang 10-15 digit (setelah normalisasi).
func ValidPhone(raw string) bool {
	n := len(NormalizePhone(raw))
	return n >= 10 && n <= 15
}

// Customers mengelola akun customer (identitas via nomor WA) + login OTP.
type Customers struct {
	pool   *pgxpool.Pool
	auth   *Auth
	notify *Notifier
}

func NewCustomers(pool *pgxpool.Pool, auth *Auth, notify *Notifier) *Customers {
	return &Customers{pool: pool, auth: auth, notify: notify}
}

// FindOrCreate membuat atau mengambil customer berdasarkan nomor WA.
func (c *Customers) FindOrCreate(ctx context.Context, name, phone string) (int64, error) {
	var id int64
	err := c.pool.QueryRow(ctx, `
		INSERT INTO customers (name, phone) VALUES ($1,$2)
		ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name
		RETURNING id`, name, NormalizePhone(phone)).Scan(&id)
	return id, err
}

// RequestOTP membuat kode OTP dan mengirim via WhatsApp. Jika kanal WA belum
// dikonfigurasi (n8n kosong), kode dikembalikan agar alur bisa dites (dev echo).
func (c *Customers) RequestOTP(ctx context.Context, rawPhone string) (string, error) {
	phone := NormalizePhone(rawPhone)
	if !ValidPhone(phone) {
		return "", errors.New("nomor WhatsApp tidak valid")
	}
	n, _ := rand.Int(rand.Reader, big.NewInt(1000000))
	code := fmt.Sprintf("%06d", n.Int64())
	_, _ = c.pool.Exec(ctx, `DELETE FROM otp_codes WHERE phone=$1`, phone)
	if _, err := c.pool.Exec(ctx, `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1,$2,$3)`, phone, code, time.Now().Add(5*time.Minute)); err != nil {
		return "", err
	}
	if c.notify.HasChannel() {
		c.notify.SendWhatsApp(phone, "Kode OTP pesanan IIPE Anda: "+code+" (berlaku 5 menit). Jangan bagikan ke siapa pun.")
		return "", nil
	}
	return code, nil // dev: kanal WA belum ada → echo kode
}

// VerifyOTP memvalidasi kode dan mengembalikan token customer (role=customer).
func (c *Customers) VerifyOTP(ctx context.Context, rawPhone, code string) (string, string, error) {
	phone := NormalizePhone(rawPhone)
	var expiresAt time.Time
	err := c.pool.QueryRow(ctx, `SELECT expires_at FROM otp_codes WHERE phone=$1 AND code=$2 AND used=false`, phone, code).Scan(&expiresAt)
	if err != nil || time.Now().After(expiresAt) {
		return "", "", errors.New("kode OTP salah atau kedaluwarsa")
	}
	_, _ = c.pool.Exec(ctx, `UPDATE otp_codes SET used=true WHERE phone=$1 AND code=$2`, phone, code)
	var name string
	_ = c.pool.QueryRow(ctx, `SELECT name FROM customers WHERE phone=$1`, phone).Scan(&name)
	token, err := c.auth.IssueCustomer(name, phone)
	return token, name, err
}
