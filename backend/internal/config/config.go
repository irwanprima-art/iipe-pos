package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port          string
	DatabaseURL   string
	JWTSecret     string
	N8NWebhookURL string
	AffiliateCode string
	MidtransKey   string
	MockPayments  bool
	UploadDir     string
	S3Endpoint    string
	S3Bucket      string
	S3AccessKey   string
	S3SecretKey   string
	S3PublicURL   string
	S3Secure      bool
	MaxImageDim   int
	SumoAPIURL    string
	SumoAPIKey    string
	SumoWebhookSecret string
	SumoWebhookToken  string
	PaymentProvider   string
}

func Load() Config {
	c := Config{
		Port:          getenv("PORT", "8080"),
		DatabaseURL:   getenv("DATABASE_URL", "postgres://iipe:iipe@localhost:5432/iipe?sslmode=disable"),
		JWTSecret:     getenv("JWT_SECRET", "dev-secret-change-me"),
		N8NWebhookURL: os.Getenv("N8N_WEBHOOK_URL"),
		AffiliateCode: getenv("AFFILIATE_CODE", ""),
		MidtransKey:   os.Getenv("MIDTRANS_SERVER_KEY"),
		MockPayments:  getenv("MOCK_PAYMENTS", "true") == "true",
		UploadDir:     getenv("UPLOAD_DIR", "/uploads"),
		S3Endpoint:    os.Getenv("S3_ENDPOINT"),
		S3Bucket:      os.Getenv("S3_BUCKET"),
		S3AccessKey:   os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:   os.Getenv("S3_SECRET_KEY"),
		S3PublicURL:   os.Getenv("S3_PUBLIC_URL"),
		S3Secure:      getenv("S3_SECURE", "true") == "true",
		MaxImageDim:   getenvInt("MAX_IMAGE_DIM", 1200),
		SumoAPIURL:    getenv("SUMO_API_URL", "https://api-pay-sandbox.sumopod.com"),
		SumoAPIKey:    os.Getenv("SUMO_API_KEY"),
		SumoWebhookSecret: os.Getenv("SUMO_WEBHOOK_SECRET"),
		SumoWebhookToken:  os.Getenv("SUMO_WEBHOOK_TOKEN"),
	}
	// provider pembayaran: sumopay bila kredensial diisi & mock dimatikan; selain itu mock.
	c.PaymentProvider = "mock"
	if !c.MockPayments && c.SumoAPIKey != "" {
		c.PaymentProvider = "sumopay"
	}
	return c
}

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
