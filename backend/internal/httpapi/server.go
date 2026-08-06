package httpapi

import (
	"context"
	"log"
	"net/http"
	"time"

	"iipe/backend/internal/config"
	"iipe/backend/internal/service"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	pool    *pgxpool.Pool
	cfg     config.Config
	auth    *service.Auth
	stock   *service.Stock
	orders  *service.Orders
	pay     *service.Payments
	aff     *service.Affiliate
	notify  *service.Notifier
	seed    *service.Seeder
	storage *service.Storage
	customers *service.Customers
	uploads http.Handler
}

func NewServer(pool *pgxpool.Pool, cfg config.Config) *Server {
	notify := service.NewNotifier(pool, cfg.N8NWebhookURL)
	payments := service.NewPayments(pool, cfg.PaymentProvider, cfg.SumoAPIURL, cfg.SumoAPIKey)
	auth := service.NewAuth(pool, cfg.JWTSecret)
	customers := service.NewCustomers(pool, auth, notify)
	storage, err := service.NewStorage(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket, cfg.S3PublicURL, cfg.S3Secure)
	if err != nil {
		log.Printf("storage S3: %v", err)
	}
	return &Server{
		pool:      pool,
		cfg:       cfg,
		auth:      auth,
		stock:     service.NewStock(pool),
		orders:    service.NewOrders(pool, notify, payments),
		pay:       payments,
		aff:       service.NewAffiliate(cfg.AffiliateCode),
		notify:    notify,
		seed:      service.NewSeeder(pool),
		storage:   storage,
		customers: customers,
		uploads:   http.StripPrefix("/uploads/", http.FileServer(http.Dir(cfg.UploadDir))),
	}
}

func (s *Server) StartSweeper(ctx context.Context) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = s.orders.SweepExpired(ctx)
		}
	}
}

// Seed menjalankan seeding data demo (idempotent). Dipanggil saat startup.
func (s *Server) Seed(ctx context.Context) error {
	return s.seed.Seed(ctx)
}

var staffRoles = []string{"admin", "cashier", "picker", "packer", "operator"}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// ---- public ----
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/customer/otp", s.handleCustomerOTPRequest)
	mux.HandleFunc("POST /api/v1/auth/customer/otp/verify", s.handleCustomerOTPVerify)
	mux.HandleFunc("GET /api/v1/customer/orders", s.requireAuth(s.handleCustomerOrders, "customer"))
	mux.HandleFunc("GET /api/v1/store/events", s.handleStoreEvents)
	mux.HandleFunc("GET /api/v1/store/products", s.handleStoreProducts)
	mux.HandleFunc("GET /api/v1/store/products/{id}", s.handleStoreProductDetail)
	mux.HandleFunc("GET /api/v1/store/products/{id}/suggestions", s.handleSuggestions)
	mux.HandleFunc("POST /api/v1/checkout", s.handleCheckout)
	mux.HandleFunc("GET /api/v1/orders/status/{token}", s.handleOrderStatus)
	mux.HandleFunc("POST /api/v1/webhooks/payment", s.handlePaymentWebhook)
	mux.HandleFunc("POST /api/v1/webhooks/sumopay", s.handleSumopayWebhook)
	mux.HandleFunc("POST /api/v1/affiliate/convert", s.handleAffiliateConvert)
	mux.Handle("/uploads/", s.uploads)

	// ---- admin (role admin) ----
	mux.HandleFunc("GET /api/v1/admin/dashboard", s.requireAuth(s.handleDashboard, "admin"))
	mux.HandleFunc("GET /api/v1/admin/products", s.requireAuth(s.handleListProducts, "admin"))
	mux.HandleFunc("POST /api/v1/admin/products", s.requireAuth(s.handleCreateProduct, "admin"))
	mux.HandleFunc("PATCH /api/v1/admin/products/{id}", s.requireAuth(s.handleUpdateProduct, "admin"))
	mux.HandleFunc("POST /api/v1/admin/uploads", s.requireAuth(s.handleUpload, "admin"))
	mux.HandleFunc("GET /api/v1/admin/shopee", s.requireAuth(s.handleShopeeList, "admin"))
	mux.HandleFunc("POST /api/v1/admin/products/{id}/affiliate", s.requireAuth(s.handleSetAffiliate, "admin"))
	mux.HandleFunc("POST /api/v1/admin/bundles", s.requireAuth(s.handleCreateBundle, "admin"))
	mux.HandleFunc("GET /api/v1/admin/events", s.requireAuth(s.handleListEvents, "admin"))
	mux.HandleFunc("POST /api/v1/admin/events", s.requireAuth(s.handleCreateEvent, "admin"))
	mux.HandleFunc("PATCH /api/v1/admin/events/{id}", s.requireAuth(s.handleUpdateEvent, "admin"))
	mux.HandleFunc("GET /api/v1/admin/events/{id}/products", s.requireAuth(s.handleEventProducts, "admin"))
	mux.HandleFunc("POST /api/v1/admin/events/{id}/products", s.requireAuth(s.handleAddEventProduct, "admin"))
	mux.HandleFunc("POST /api/v1/admin/events/{id}/products/{pid}/stock", s.requireAuth(s.handleAdjustStock, "admin"))
	mux.HandleFunc("GET /api/v1/admin/orders", s.requireAuth(s.handleListOrders, "admin"))
	mux.HandleFunc("GET /api/v1/admin/orders/{id}", s.requireAuth(s.handleGetOrder, "admin"))
	mux.HandleFunc("GET /api/v1/admin/stock", s.requireAuth(s.handleStockList, "admin"))
	mux.HandleFunc("GET /api/v1/admin/customers", s.requireAuth(s.handleListCustomers, "admin"))
	mux.HandleFunc("POST /api/v1/admin/seed", s.requireAuth(s.handleSeed, "admin"))

	// ---- POS + fulfillment (semua staf) ----
	mux.HandleFunc("GET /api/v1/pos/products", s.requireAuth(s.handlePosProducts, staffRoles...))
	mux.HandleFunc("POST /api/v1/pos/checkout", s.requireAuth(s.handlePosCheckout, staffRoles...))
	mux.HandleFunc("GET /api/v1/fulfillment/orders", s.requireAuth(s.handleFulfillmentOrders, staffRoles...))
	mux.HandleFunc("POST /api/v1/orders/{id}/pick", s.requireAuth(s.handlePick, staffRoles...))
	mux.HandleFunc("POST /api/v1/orders/{id}/pack", s.requireAuth(s.handlePack, staffRoles...))
	mux.HandleFunc("POST /api/v1/orders/{id}/ready", s.requireAuth(s.handleReady, staffRoles...))
	mux.HandleFunc("POST /api/v1/orders/scan", s.requireAuth(s.handleScan, staffRoles...))
	mux.HandleFunc("POST /api/v1/orders/{id}/handover", s.requireAuth(s.handleHandover, staffRoles...))
	mux.HandleFunc("POST /api/v1/orders/{id}/cancel", s.requireAuth(s.handleCancel, staffRoles...))

	return s.withLog(s.withCORS(mux))
}
