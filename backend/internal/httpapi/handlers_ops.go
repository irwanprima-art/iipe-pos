package httpapi

import (
	"net/http"

	"iipe/backend/internal/service"
)

func (s *Server) handlePosProducts(w http.ResponseWriter, r *http.Request) {
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
	var out []eventProductLite
	for _, id := range ids {
		ep, err := s.eventProduct(r.Context(), eventID, id)
		if err == nil {
			out = append(out, eventProductLite{
				ProductID: ep.ProductID, SKU: ep.Product.SKU, Name: ep.Product.Name,
				BarcodePCS: ep.Product.BarcodePCS, BarcodeCarton: ep.Product.BarcodeCarton,
				QtyPerCarton: ep.Product.QtyPerCarton, IsBundle: ep.Product.IsBundle,
				Price: ep.Price, Available: ep.Available, Images: ep.Product.Images,
			})
		}
	}
	writeJSON(w, http.StatusOK, out)
}

type eventProductLite struct {
	ProductID     int64    `json:"product_id"`
	SKU           string   `json:"sku"`
	Name          string   `json:"name"`
	BarcodePCS    string   `json:"barcode_pcs"`
	BarcodeCarton string   `json:"barcode_carton"`
	QtyPerCarton  int      `json:"qty_per_carton"`
	IsBundle      bool     `json:"is_bundle"`
	Price         int      `json:"price"`
	Available     int      `json:"available"`
	Images        []string `json:"images"`
}

func (s *Server) handlePosCheckout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EventID      int64              `json:"event_id"`
		Method       string             `json:"method"`
		CustomerName string             `json:"customer_name"`
		ProviderRef  string             `json:"provider_ref"`
		Items        []service.CartItem `json:"items"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Method != "edc" {
		writeErr(w, http.StatusBadRequest, "POS hanya mendukung pembayaran EDC")
		return
	}
	if body.ProviderRef == "" {
		writeErr(w, 400, "nomor referensi EDC wajib diisi")
		return
	}
	order, err := s.orders.PosCheckout(r.Context(), body.EventID, body.Method, body.Items, body.CustomerName, actorName(r), body.ProviderRef)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) handleFulfillmentOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.orders.List(r.Context(), "", queryInt(r, "event_id"))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var out []any
	for _, o := range orders {
		switch o.Status {
		case "paid", "picking", "picked", "packing", "packed", "ready":
			out = append(out, o)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePick(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	if err := s.orders.PickAll(r.Context(), id, actorName(r)); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ord, _ := s.orders.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, ord)
}

// handlePickItem: pick sebagian produk berdasarkan scan barcode (pcs=1, carton=qty_per_carton).
func (s *Server) handlePickItem(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		ProductID int64 `json:"product_id"`
		Qty       int64 `json:"qty"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if err := s.orders.PickItem(r.Context(), id, body.ProductID, body.Qty, actorName(r)); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ord, _ := s.orders.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, ord)
}

func (s *Server) handlePack(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	pickupNo, err := s.orders.Pack(r.Context(), id, actorName(r))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ord, _ := s.orders.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"pickup_no": pickupNo, "order": ord})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	if err := s.orders.MarkReady(r.Context(), id, actorName(r)); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ord, _ := s.orders.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, ord)
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	ord, err := s.orders.GetByToken(r.Context(), body.Token)
	if err != nil {
		writeErr(w, 404, "order tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, ord)
}

func (s *Server) handleHandover(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	if err := s.orders.Handover(r.Context(), id, actorName(r)); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ord, _ := s.orders.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, ord)
}

func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = readJSON(r, &body)
	if body.Reason == "" {
		body.Reason = "dibatalkan admin"
	}
	if err := s.orders.Cancel(r.Context(), id, actorName(r), body.Reason); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ord, _ := s.orders.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, ord)
}

func actorName(r *http.Request) string {
	c := claimsFrom(r)
	if c == nil {
		return "system"
	}
	return c.Name + " (" + c.Role + ")"
}
