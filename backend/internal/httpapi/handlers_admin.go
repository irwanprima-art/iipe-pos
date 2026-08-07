package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"iipe/backend/internal/domain"

	"github.com/disintegration/imaging"
	"github.com/jackc/pgx/v5"
)

func (s *Server) loadProduct(ctx context.Context, id int64) (domain.Product, error) {
	var pr domain.Product
	var imgs []string
	err := s.pool.QueryRow(ctx, `
		SELECT id, sku, name, COALESCE(category,''), COALESCE(description,''), COALESCE(barcode_pcs,''),
		       COALESCE(barcode_carton,''), qty_per_carton, COALESCE(marketplace_link,''), COALESCE(custom_affiliate_link,''), is_bundle, images
		FROM products WHERE id=$1`, id).Scan(
		&pr.ID, &pr.SKU, &pr.Name, &pr.Category, &pr.Description, &pr.BarcodePCS,
		&pr.BarcodeCarton, &pr.QtyPerCarton, &pr.MarketplaceLink, &pr.CustomAffiliateLink, &pr.IsBundle, &imgs)
	if err != nil {
		return pr, err
	}
	pr.Images = s.rewriteImages(imgs)
	// Link yang dipakai: pakai affiliate bila diisi manual, selain itu link asli.
	pr.AffiliateLink = pr.CustomAffiliateLink
	if pr.AffiliateLink == "" {
		pr.AffiliateLink = pr.MarketplaceLink
	}
	if pr.IsBundle {
		rows, err := s.pool.Query(ctx, `
			SELECT bc.component_id, bc.component_qty, pr.sku, pr.name
			FROM bundle_components bc JOIN products pr ON pr.id=bc.component_id
			WHERE bc.bundle_id=$1`, id)
		if err != nil {
			return pr, err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.Component
			if err := rows.Scan(&c.ProductID, &c.Qty, &c.SKU, &c.Name); err != nil {
				return pr, err
			}
			pr.Components = append(pr.Components, c)
		}
	}
	return pr, nil
}

func (s *Server) handleListProducts(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT id FROM products ORDER BY id`)
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
	var out []domain.Product
	for _, id := range ids {
		pr, err := s.loadProduct(r.Context(), id)
		if err == nil {
			out = append(out, pr)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateProduct(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SKU             string   `json:"sku"`
		Name            string   `json:"name"`
		Category        string   `json:"category"`
		Description     string   `json:"description"`
		BarcodePCS      string   `json:"barcode_pcs"`
		BarcodeCarton   string   `json:"barcode_carton"`
		QtyPerCarton    int      `json:"qty_per_carton"`
		MarketplaceLink string   `json:"marketplace_link"`
		CustomAffiliateLink string `json:"custom_affiliate_link"`
		Images          []string `json:"images"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.SKU == "" || body.Name == "" {
		writeErr(w, 400, "sku dan nama wajib diisi")
		return
	}
	if body.QtyPerCarton <= 0 {
		body.QtyPerCarton = 1
	}
	var id int64
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO products (sku, name, category, description, barcode_pcs, barcode_carton, qty_per_carton, marketplace_link, custom_affiliate_link, images)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,$8,NULLIF($9,''),$10) RETURNING id`,
		body.SKU, body.Name, body.Category, body.Description, body.BarcodePCS, body.BarcodeCarton,
		body.QtyPerCarton, body.MarketplaceLink, body.CustomAffiliateLink, body.Images).Scan(&id)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	pr, err := s.loadProduct(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (s *Server) handleUpdateProduct(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		Name            *string  `json:"name"`
		Category        *string  `json:"category"`
		Description     *string  `json:"description"`
		BarcodePCS      *string  `json:"barcode_pcs"`
		BarcodeCarton   *string  `json:"barcode_carton"`
		QtyPerCarton    *int     `json:"qty_per_carton"`
		MarketplaceLink *string  `json:"marketplace_link"`
		CustomAffiliateLink *string `json:"custom_affiliate_link"`
		Images          []string `json:"images"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Name != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET name=$1 WHERE id=$2`, *body.Name, id)
	}
	if body.Category != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET category=$1 WHERE id=$2`, *body.Category, id)
	}
	if body.Description != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET description=$1 WHERE id=$2`, *body.Description, id)
	}
	if body.BarcodePCS != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET barcode_pcs=NULLIF($1,'') WHERE id=$2`, *body.BarcodePCS, id)
	}
	if body.BarcodeCarton != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET barcode_carton=NULLIF($1,'') WHERE id=$2`, *body.BarcodeCarton, id)
	}
	if body.QtyPerCarton != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET qty_per_carton=$1 WHERE id=$2`, *body.QtyPerCarton, id)
	}
	if body.MarketplaceLink != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET marketplace_link=NULLIF($1,'') WHERE id=$2`, *body.MarketplaceLink, id)
	}
	if body.CustomAffiliateLink != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET custom_affiliate_link=NULLIF($1,'') WHERE id=$2`, *body.CustomAffiliateLink, id)
	}
	if len(body.Images) > 0 {
		_, _ = s.pool.Exec(r.Context(), `UPDATE products SET images=$1 WHERE id=$2`, body.Images, id)
	}
	pr, err := s.loadProduct(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "file 'file' diperlukan")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".png"
	}
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// kompres / resize gambar (tidak perlu resolusi asli, yang penting tetap ok)
	if strings.HasPrefix(contentType, "image/") {
		if comp, newType := compressImage(data, s.cfg.MaxImageDim); comp != nil {
			data, contentType = comp, newType
		}
	}
	switch contentType {
	case "image/png":
		ext = ".png"
	case "image/jpeg":
		ext = ".jpg"
	}
	name := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), randomSuffix(6), ext)

	// S3 / object storage (CloudEka box) bila dikonfigurasi
	if s.storage.Enabled() {
		url, err := s.storage.Put(r.Context(), "products/"+name, bytes.NewReader(data), int64(len(data)), contentType)
		if err != nil {
			writeErr(w, 500, "gagal upload ke S3: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": url})
		return
	}

	// fallback: simpan lokal
	if err := os.MkdirAll(s.cfg.UploadDir, 0o755); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	dst, err := os.Create(filepath.Join(s.cfg.UploadDir, name))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer dst.Close()
	if _, err := dst.Write(data); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": "/uploads/" + name})
}

// compressImage meresize (sisi terpanjang = maxDim) & re-encode gambar.
// PNG dipertahankan hanya jika ada transparansi (logo/cutout); selain itu diubah ke JPEG kualitas 80
// (jauh lebih kecil untuk foto). Mengembalikan nil bila gagal → pakai file asli.
func compressImage(data []byte, maxDim int) ([]byte, string) {
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil || maxDim <= 0 {
		return nil, ""
	}
	keepPng := format == "png" && hasTransparency(img)
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > maxDim || h > maxDim {
		if w >= h {
			h = int(float64(h) * float64(maxDim) / float64(w))
			w = maxDim
		} else {
			w = int(float64(w) * float64(maxDim) / float64(h))
			h = maxDim
		}
		img = imaging.Resize(img, w, h, imaging.Lanczos)
	}
	var buf bytes.Buffer
	if keepPng {
		if err := imaging.Encode(&buf, img, imaging.PNG); err != nil {
			return nil, ""
		}
		return buf.Bytes(), "image/png"
	}
	flat := image.NewNRGBA(img.Bounds())
	draw.Draw(flat, flat.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), img, image.Point{}, draw.Over) // transparansi diisi putih sebelum jadi JPEG
	if err := imaging.Encode(&buf, flat, imaging.JPEG, imaging.JPEGQuality(80)); err != nil {
		return nil, ""
	}
	return buf.Bytes(), "image/jpeg"
}

// hasTransparency mendeteksi alpha < 255 pada gambar RGBA/NRGBA.
func hasTransparency(img image.Image) bool {
	switch m := img.(type) {
	case *image.NRGBA:
		for i := 3; i < len(m.Pix); i += 4 {
			if m.Pix[i] != 255 {
				return true
			}
		}
	case *image.RGBA:
		for i := 3; i < len(m.Pix); i += 4 {
			if m.Pix[i] != 255 {
				return true
			}
		}
	}
	return false
}

type shopeeRow struct {
	ID                  int64  `json:"id"`
	SKU                 string `json:"sku"`
	Name                string `json:"name"`
	MarketplaceLink     string `json:"marketplace_link"`
	CustomAffiliateLink string `json:"custom_affiliate_link"`
	AutoAffiliateLink   string `json:"auto_affiliate_link"`
	AffiliateLink       string `json:"affiliate_link"`
}

// handleShopeeList: daftar semua produk + link Shopee + affiliate (auto & custom) untuk super admin.
func (s *Server) handleShopeeList(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, sku, name, COALESCE(marketplace_link,''), COALESCE(custom_affiliate_link,'')
		FROM products ORDER BY id`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []shopeeRow
	for rows.Next() {
		var rw shopeeRow
		if err := rows.Scan(&rw.ID, &rw.SKU, &rw.Name, &rw.MarketplaceLink, &rw.CustomAffiliateLink); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if rw.MarketplaceLink != "" {
			rw.AutoAffiliateLink = s.aff.Convert(rw.MarketplaceLink)
		}
		rw.AffiliateLink = rw.CustomAffiliateLink
		if rw.AffiliateLink == "" {
			rw.AffiliateLink = rw.AutoAffiliateLink
		}
		out = append(out, rw)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleSetAffiliate: update custom affiliate link per produk (kosong = pakai affiliate otomatis).
func (s *Server) handleSetAffiliate(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		CustomAffiliateLink string `json:"custom_affiliate_link"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	body.CustomAffiliateLink = strings.TrimSpace(body.CustomAffiliateLink)
	var val any
	if body.CustomAffiliateLink == "" {
		val = nil // reset → affiliate otomatis
	} else {
		val = body.CustomAffiliateLink
	}
	if _, err := s.pool.Exec(r.Context(), `UPDATE products SET custom_affiliate_link=$1 WHERE id=$2`, val, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	pr, err := s.loadProduct(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func randomSuffix(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))] // simple, non-crypto
	}
	return string(b)
}

func (s *Server) handleCreateBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SKU        string   `json:"sku"`
		Name       string   `json:"name"`
		BarcodePCS string   `json:"barcode_pcs"`
		Category   string   `json:"category"`
		Images     []string `json:"images"`
		Components []struct {
			ProductID int64 `json:"product_id"`
			Qty       int   `json:"qty"`
		} `json:"components"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.SKU == "" || body.Name == "" || len(body.Components) == 0 {
		writeErr(w, 400, "sku, nama, dan komponen wajib diisi")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var id int64
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO products (sku, name, category, barcode_pcs, is_bundle, images)
		VALUES ($1,$2,$3,NULLIF($4,''),true,$5) RETURNING id`,
		body.SKU, body.Name, body.Category, body.BarcodePCS, body.Images).Scan(&id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	for _, c := range body.Components {
		if c.Qty <= 0 {
			c.Qty = 1
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO bundle_components (bundle_id, component_id, component_qty) VALUES ($1,$2,$3)`, id, c.ProductID, c.Qty); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	pr, err := s.loadProduct(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT id, code, name, COALESCE(location,''), is_active FROM events ORDER BY id DESC`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []domain.Event
	for rows.Next() {
		var e domain.Event
		if err := rows.Scan(&e.ID, &e.Code, &e.Name, &e.Location, &e.IsActive); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Name     string `json:"name"`
		Location string `json:"location"`
		IsActive bool   `json:"is_active"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Code == "" || body.Name == "" {
		writeErr(w, 400, "code dan nama wajib diisi")
		return
	}
	var e domain.Event
	if err := s.pool.QueryRow(r.Context(), `INSERT INTO events (code, name, location, is_active) VALUES ($1,$2,$3,$4) RETURNING id, code, name, location, is_active`,
		body.Code, body.Name, body.Location, body.IsActive).Scan(&e.ID, &e.Code, &e.Name, &e.Location, &e.IsActive); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleUpdateEvent(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		Name     *string `json:"name"`
		Location *string `json:"location"`
		IsActive *bool   `json:"is_active"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Name != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE events SET name=$1 WHERE id=$2`, *body.Name, id)
	}
	if body.Location != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE events SET location=$1 WHERE id=$2`, *body.Location, id)
	}
	if body.IsActive != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE events SET is_active=$1 WHERE id=$2`, *body.IsActive, id)
	}
	var e domain.Event
	if err := s.pool.QueryRow(r.Context(), `SELECT id, code, name, COALESCE(location,''), is_active FROM events WHERE id=$1`, id).Scan(&e.ID, &e.Code, &e.Name, &e.Location, &e.IsActive); err != nil {
		writeErr(w, 404, "event tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleEventProducts(w http.ResponseWriter, r *http.Request) {
	eventID, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT product_id FROM event_products WHERE event_id=$1 ORDER BY id`, eventID)
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

func (s *Server) handleAddEventProduct(w http.ResponseWriter, r *http.Request) {
	eventID, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		ProductID  int64 `json:"product_id"`
		Price      int   `json:"price"`
		StockTotal int   `json:"stock_total"`
		IsActive   bool  `json:"is_active"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO event_products (event_id, product_id, price, stock_total, is_active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (event_id, product_id) DO UPDATE SET price=EXCLUDED.price, stock_total=EXCLUDED.stock_total, is_active=EXCLUDED.is_active`,
		eventID, body.ProductID, body.Price, body.StockTotal, body.IsActive); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	var hasIn bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM stock_movements WHERE event_id=$1 AND product_id=$2 AND type='IN')`, eventID, body.ProductID).Scan(&hasIn); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if !hasIn && body.StockTotal > 0 {
		if _, err := tx.Exec(r.Context(), `INSERT INTO stock_movements (event_id, product_id, type, qty, reason) VALUES ($1,$2,'IN',$3,'admin')`, eventID, body.ProductID, body.StockTotal); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	ep, err := s.eventProduct(r.Context(), eventID, body.ProductID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ep)
}

func (s *Server) handleAdjustStock(w http.ResponseWriter, r *http.Request) {
	eventID, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	pid, err := pathID(r, "pid")
	if err != nil {
		writeErr(w, 400, "pid tidak valid")
		return
	}
	var body struct {
		StockTotal int64  `json:"stock_total"`
		Reason     string `json:"reason"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Reason == "" {
		writeErr(w, 400, "alasan wajib diisi")
		return
	}
	if err := s.stock.Adjust(r.Context(), eventID, pid, body.StockTotal, body.Reason); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ep, err := s.eventProduct(r.Context(), eventID, pid)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ep)
}

func (s *Server) handleListOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.orders.List(r.Context(), r.URL.Query().Get("status"), queryInt(r, "event_id"))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, orders)
}

func (s *Server) handleGetOrder(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	ord, err := s.orders.Get(r.Context(), id)
	if err != nil {
		writeErr(w, 404, "order tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, ord)
}

func (s *Server) handleStockList(w http.ResponseWriter, r *http.Request) {
	eventID := queryInt(r, "event_id")
	if eventID == 0 {
		if err := s.pool.QueryRow(r.Context(), `SELECT id FROM events WHERE is_active ORDER BY id LIMIT 1`).Scan(&eventID); err != nil {
			writeErr(w, 400, "tidak ada event aktif")
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `SELECT product_id FROM event_products WHERE event_id=$1 ORDER BY id`, eventID)
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

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var d domain.Dashboard
	d.RevenueByMethod = map[string]int{}
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ('completed','handed_over') AND created_at::date=current_date`).Scan(&d.TodaySales)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders`).Scan(&d.OrderCount)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE status IN ('pending_payment','paid','picking','picked','packing','packed')`).Scan(&d.ActiveOrders)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE status='ready'`).Scan(&d.ReadyOrders)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE status IN ('completed','handed_over')`).Scan(&d.CompletedOrders)
	rows, err := s.pool.Query(ctx, `SELECT COALESCE(payment_method,'-'), SUM(total) FROM orders WHERE status IN ('completed','handed_over') GROUP BY payment_method`)
	if err == nil {
		for rows.Next() {
			var m string
			var v int
			rows.Scan(&m, &v)
			d.RevenueByMethod[m] = v
		}
		rows.Close()
	}
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM event_products ep WHERE ep.is_active AND ep.stock_total
		  - COALESCE((SELECT SUM(sm.qty) FROM stock_movements sm WHERE sm.event_id=ep.event_id AND sm.product_id=ep.product_id AND sm.type='RESERVE'),0)
		  + COALESCE((SELECT SUM(sm.qty) FROM stock_movements sm WHERE sm.event_id=ep.event_id AND sm.product_id=ep.product_id AND sm.type='UNRESERVE'),0)
		  + COALESCE((SELECT SUM(sm.qty) FROM stock_movements sm WHERE sm.event_id=ep.event_id AND sm.product_id=ep.product_id AND sm.type='RETURN'),0)
		  <= 5`).Scan(&d.ProductsLowStock)
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleSeed(w http.ResponseWriter, r *http.Request) {
	if err := s.seed.Seed(r.Context()); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleListCustomers: daftar customer + ringkasan order & total belanja (admin).
func (s *Server) handleListCustomers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.name, c.phone, c.created_at,
		       (SELECT COUNT(*) FROM orders o WHERE o.customer_phone=c.phone) AS total_orders,
		       (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_phone=c.phone AND o.status IN ('completed','handed_over')) AS total_spent
		FROM customers c ORDER BY c.id DESC LIMIT 300`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var name, phone string
		var created time.Time
		var orders, spent int
		if err := rows.Scan(&id, &name, &phone, &created, &orders, &spent); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "phone": phone, "created_at": created, "orders": orders, "spent": spent})
	}
	writeJSON(w, http.StatusOK, out)
}

var _ = pgx.ErrNoRows
