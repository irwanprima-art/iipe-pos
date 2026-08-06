package service

import (
	"net/url"
	"strings"
)

// Affiliate mengubah link produk (Shopee) menjadi link affiliate.
type Affiliate struct {
	code string
}

func NewAffiliate(code string) *Affiliate { return &Affiliate{code: code} }

// Convert mengubah link biasa menjadi link affiliate. Jika sudah memuat parameter
// tracking, link dibiarkan apa adanya (idempotent).
func (a *Affiliate) Convert(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || a.code == "" {
		return raw
	}
	low := strings.ToLower(raw)
	if strings.Contains(low, "af_id=") || strings.Contains(low, "affiliate") || strings.Contains(low, "sp_") {
		return raw
	}
	sep := "?"
	if strings.Contains(raw, "?") {
		sep = "&"
	}
	return raw + sep + "af_id=" + url.QueryEscape(a.code)
}
