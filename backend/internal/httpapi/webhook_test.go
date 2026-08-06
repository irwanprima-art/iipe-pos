package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestVerifyWebhookSignature(t *testing.T) {
	key := []byte("test-secret-bytes")
	secret := "whsec_" + base64.StdEncoding.EncodeToString(key)

	body := []byte(`{"type":"payment.completed","data":{"payment_id":"abc-123"}}`)
	id := "msg_2026"
	ts := "1785990000"

	signed := id + "." + ts + "." + string(body)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(signed))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// valid
	if !verifyWebhookSignature(secret, id, ts, "v1,"+sig, body) {
		t.Fatal("signature valid harus diterima")
	}
	// salah
	if verifyWebhookSignature(secret, id, ts, "v1,AAAA===", body) {
		t.Fatal("signature tidak valid harus ditolak")
	}
	// tanpa secret (dev) → diterima
	if !verifyWebhookSignature("", id, ts, "v1,xxx", body) {
		t.Fatal("tanpa secret harus diterima")
	}
}
