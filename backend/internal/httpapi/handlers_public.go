package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"iipe/backend/internal/domain"
	"iipe/backend/internal/service"
)

// ---------- Auth ----------

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	token, user, err := s.auth.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

// ---------- Storefront ----------

func (s *Server) handleStoreEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT id, code, name, location, is_active, lat, lng FROM events WHERE is_active ORDER BY id`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []domain.Event
	for rows.Next() {
		var e domain.Event
		if err := rows.Scan(&e.ID, &e.Code, &e.Name, &e.Location, &e.IsActive, &e.Lat, &e.Lng); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleStoreProducts(w http.ResponseWriter, r *http.Request) {
	eventID := queryInt(r, "event_id")
	if eventID == 0 {
		if err := s.pool.QueryRow(r.Context(), `SELECT id FROM events WHERE is_active ORDER BY id LIMIT 1`).Scan(&eventID); err != nil {
			writeErr(w, 400, "tidak ada event aktif")
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `SELECT product_id FROM event_products WHERE event_id=$1 AND is_active ORDER BY id`, eventID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()

	var out []domain.EventProduct
	for _, id := range ids {
		ep, err := s.eventProduct(r.Context(), eventID, id)
		if err == nil {
			out = append(out, ep)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleStoreProductDetail(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	eventID := queryInt(r, "event_id")
	if eventID == 0 {
		_ = s.pool.QueryRow(r.Context(), `SELECT id FROM events WHERE is_active ORDER BY id LIMIT 1`).Scan(&eventID)
	}
	ep, err := s.eventProduct(r.Context(), eventID, id)
	if err != nil {
		writeErr(w, 404, "produk tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, ep)
}

// handleSuggestions: produk lain yang disarankan "beli bersama" (kategori sama didahulukan).
func (s *Server) handleSuggestions(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	eventID := queryInt(r, "event_id")
	if eventID == 0 {
		if err := s.pool.QueryRow(r.Context(), `SELECT id FROM events WHERE is_active ORDER BY id LIMIT 1`).Scan(&eventID); err != nil {
			writeErr(w, 400, "tidak ada event aktif")
			return
		}
	}
	limit := queryInt(r, "limit")
	if limit <= 0 || limit > 12 {
		limit = 4
	}
	var cat string
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(category,'') FROM products WHERE id=$1`, id).Scan(&cat)
	rows, err := s.pool.Query(r.Context(), `
		SELECT ep.product_id FROM event_products ep
		JOIN products pr ON pr.id = ep.product_id
		WHERE ep.event_id=$1 AND ep.is_active AND ep.product_id<>$2
		ORDER BY (pr.category = $3) DESC, ep.id
		LIMIT $4`, eventID, id, cat, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var ids []int64
	for rows.Next() {
		var pid int64
		if err := rows.Scan(&pid); err != nil {
			rows.Close()
			writeErr(w, 500, err.Error())
			return
		}
		ids = append(ids, pid)
	}
	rows.Close()
	var out []domain.EventProduct
	for _, pid := range ids {
		ep, err := s.eventProduct(r.Context(), eventID, pid)
		if err == nil {
			out = append(out, ep)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// eventProduct menggabungkan event_products + products + availability (+ bundle components).
func (s *Server) eventProduct(ctx context.Context, eventID, productID int64) (domain.EventProduct, error) {
	var ep domain.EventProduct
	var pr domain.Product
	var imgs []string
	err := s.pool.QueryRow(ctx, `
		SELECT ep.event_id, ep.product_id, ep.price, ep.stock_total, ep.is_active,
		       pr.id, pr.sku, pr.name, pr.category, COALESCE(pr.description,''), COALESCE(pr.barcode_pcs,''), COALESCE(pr.barcode_carton,''),
		       pr.qty_per_carton, COALESCE(pr.marketplace_link,''), COALESCE(pr.custom_affiliate_link,''), pr.is_bundle, pr.images
		FROM event_products ep JOIN products pr ON pr.id=ep.product_id
		WHERE ep.event_id=$1 AND ep.product_id=$2`, eventID, productID).Scan(
		&ep.EventID, &ep.ProductID, &ep.Price, &ep.StockTotal, &ep.IsActive,
		&pr.ID, &pr.SKU, &pr.Name, &pr.Category, &pr.Description, &pr.BarcodePCS, &pr.BarcodeCarton,
		&pr.QtyPerCarton, &pr.MarketplaceLink, &pr.CustomAffiliateLink, &pr.IsBundle, &imgs)
	if err != nil {
		return ep, err
	}
	pr.Images = s.rewriteImages(imgs)
	// Link yang dipakai: pakai affiliate bila diisi manual, selain itu link asli.
	pr.AffiliateLink = pr.CustomAffiliateLink
	if pr.AffiliateLink == "" {
		pr.AffiliateLink = pr.MarketplaceLink
	}
	ep.Product = &pr

	if pr.IsBundle {
		rows, err := s.pool.Query(ctx, `
			SELECT bc.component_id, bc.component_qty, pr.sku, pr.name
			FROM bundle_components bc JOIN products pr ON pr.id=bc.component_id
			WHERE bc.bundle_id=$1`, productID)
		if err != nil {
			return ep, err
		}
		avail := 1 << 30
		for rows.Next() {
			var c domain.Component
			var cqty int
			if err := rows.Scan(&c.ProductID, &cqty, &c.SKU, &c.Name); err != nil {
				rows.Close()
				return ep, err
			}
			c.Qty = cqty
			pr.Components = append(pr.Components, c)
			_, _, _, a, err := s.stock.Availability(ctx, eventID, c.ProductID)
			if err == nil && cqty > 0 {
				if a/cqty < avail {
					avail = a / cqty
				}
			}
		}
		rows.Close()
		ep.Product = &pr
		ep.Available = avail
		return ep, nil
	}

	total, reserved, sold, available, err := s.stock.Availability(ctx, eventID, productID)
	if err == nil {
		ep.StockTotal, ep.Reserved, ep.Sold, ep.Available = total, reserved, sold, available
	}
	return ep, nil
}

// ---------- Checkout & payment ----------

func (s *Server) handleCheckout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EventID       int64              `json:"event_id"`
		Items         []service.CartItem `json:"items"`
		CustomerName  string             `json:"customer_name"`
		CustomerPhone string             `json:"customer_phone"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.CustomerName == "" {
		writeErr(w, 400, "nama wajib diisi")
		return
	}
	if !service.ValidPhone(body.CustomerPhone) {
		writeErr(w, 400, "nomor WhatsApp tidak valid")
		return
	}
	body.CustomerPhone = service.NormalizePhone(body.CustomerPhone)

	order, err := s.orders.Checkout(r.Context(), body.EventID, body.Items, body.CustomerName, body.CustomerPhone)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	// auto-login customer (identitas via nomor WA)
	customerToken := ""
	if _, err := s.customers.FindOrCreate(r.Context(), body.CustomerName, body.CustomerPhone); err == nil {
		customerToken, _ = s.auth.IssueCustomer(body.CustomerName, body.CustomerPhone)
	}
	b, _ := json.Marshal(order)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	m["customer_token"] = customerToken
	writeJSON(w, http.StatusOK, m)
}

// handleCustomerOTPRequest mengirim kode OTP ke nomor WA (untuk login ulang customer).
func (s *Server) handleCustomerOTPRequest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Phone string `json:"phone"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	code, err := s.customers.RequestOTP(r.Context(), body.Phone)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	resp := map[string]any{"ok": true}
	if code != "" {
		resp["dev_otp"] = code // hanya muncul bila kanal WA belum dikonfigurasi
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleCustomerOTPVerify memvalidasi OTP dan mengembalikan token customer.
func (s *Server) handleCustomerOTPVerify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Phone string `json:"phone"`
		OTP   string `json:"otp"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	token, name, err := s.customers.VerifyOTP(r.Context(), body.Phone, body.OTP)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "name": name, "phone": service.NormalizePhone(body.Phone)})
}

// handleCustomerOrders: daftar order milik customer yang login (role=customer).
func (s *Server) handleCustomerOrders(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	if claims == nil || claims.Phone == "" {
		writeErr(w, 401, "harus login sebagai customer")
		return
	}
	orders, err := s.orders.ListByPhone(r.Context(), claims.Phone)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, orders)
}

func (s *Server) handleOrderStatus(w http.ResponseWriter, r *http.Request) {
	order, err := s.orders.GetByToken(r.Context(), r.PathValue("token"))
	if err != nil {
		writeErr(w, 404, "order tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, order)
}

// handleOrderRefresh: cek ulang status pembayaran. Bila order masih menunggu bayar
// dan sudah lewat batas waktu (reserved_until), otomatis dibatalkan (expired).
func (s *Server) handleOrderRefresh(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	order, err := s.orders.GetByToken(r.Context(), token)
	if err != nil {
		writeErr(w, 404, "order tidak ditemukan")
		return
	}
	if order.Status == "pending_payment" && order.ReservedUntil != nil && time.Now().After(*order.ReservedUntil) {
		if err := s.orders.Cancel(r.Context(), order.ID, "system", "pembayaran kedaluwarsa (melewati batas waktu)"); err == nil {
			order, _ = s.orders.GetByToken(r.Context(), token)
		}
	}
	writeJSON(w, http.StatusOK, order)
}

// handleOrderCancel: customer membatalkan pesanan yang masih menunggu pembayaran.
func (s *Server) handleOrderCancel(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	order, err := s.orders.GetByToken(r.Context(), token)
	if err != nil {
		writeErr(w, 404, "order tidak ditemukan")
		return
	}
	if order.Status != "pending_payment" {
		writeErr(w, 400, "hanya pesanan yang belum dibayar yang bisa dibatalkan")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = readJSON(r, &body)
	reason := body.Reason
	if reason == "" {
		reason = "dibatalkan customer"
	}
	if err := s.orders.Cancel(r.Context(), order.ID, "customer", reason); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	order, _ = s.orders.GetByToken(r.Context(), token)
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) handlePaymentWebhook(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProviderRef string `json:"provider_ref"`
		Status      string `json:"status"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Status == "paid" {
		if err := s.pay.Confirm(r.Context(), body.ProviderRef); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleSumopayWebhook menerima webhook SumoPay (X-Webhook-Token).
// Event: payment.completed | payment.failed | payment.expired | payment.test
func (s *Server) handleSumopayWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	// verifikasi token webhook (opsional bila dikonfigurasi)
	if s.cfg.SumoWebhookToken != "" && r.Header.Get("X-Webhook-Token") != s.cfg.SumoWebhookToken {
		writeErr(w, 401, "invalid webhook token")
		return
	}
	// verifikasi signature Svix — HANYA bila provider mengirim header Svix (SumoPay tidak).
	if s.cfg.SumoWebhookSecret != "" && r.Header.Get("Svix-Signature") != "" {
		if !verifyWebhookSignature(s.cfg.SumoWebhookSecret,
			r.Header.Get("Svix-Id"), r.Header.Get("Svix-Timestamp"), r.Header.Get("Svix-Signature"), body) {
			writeErr(w, 401, "invalid signature")
			return
		}
	}
	var ev struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(body, &ev)
	pid := ""
	if v, ok := ev.Data["payment_id"]; ok {
		pid, _ = v.(string)
	}
	if pid == "" {
		if v, ok := ev.Data["id"]; ok {
			pid, _ = v.(string)
		}
	}
	ctx := r.Context()
	switch ev.Type {
	case "payment.completed":
		if pid != "" {
			if err := s.pay.Confirm(ctx, pid); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
		}
	case "payment.failed":
		if oid, err := s.pay.SetStatus(ctx, pid, "failed"); err == nil && oid > 0 {
			_ = s.orders.Cancel(ctx, oid, "sumopay", "pembayaran gagal")
		}
	case "payment.expired":
		if oid, err := s.pay.SetStatus(ctx, pid, "expired"); err == nil && oid > 0 {
			_ = s.orders.Cancel(ctx, oid, "sumopay", "pembayaran kedaluwarsa")
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAffiliateConvert(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"affiliate_url": s.aff.Convert(body.URL)})
}
