package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
)

// verifyWebhookSignature memverifikasi signature Svix (dipakai SumoPay).
// Header: Svix-Id, Svix-Timestamp, Svix-Signature ("v1,<sig>" ... bisa lebih dari satu).
func verifyWebhookSignature(secret, svixID, svixTimestamp, svixSignature string, rawBody []byte) bool {
	if secret == "" {
		return true // dev tanpa secret → lewati verifikasi
	}
	secretBytes, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return false
	}
	signedContent := svixID + "." + svixTimestamp + "." + string(rawBody)
	mac := hmac.New(sha256.New, secretBytes)
	mac.Write([]byte(signedContent))
	expectedSignature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	for _, part := range strings.Fields(svixSignature) {
		sig := strings.TrimPrefix(part, "v1,")
		if hmac.Equal([]byte(sig), []byte(expectedSignature)) {
			return true
		}
	}
	return false
}
