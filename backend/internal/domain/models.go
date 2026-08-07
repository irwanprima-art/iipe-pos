package domain

import "time"

type User struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

type Product struct {
	ID                  int64       `json:"id"`
	SKU                 string      `json:"sku"`
	Name                string      `json:"name"`
	Category            string      `json:"category"`
	Description         string      `json:"description"`
	BarcodePCS          string      `json:"barcode_pcs"`
	BarcodeCarton       string      `json:"barcode_carton"`
	QtyPerCarton        int         `json:"qty_per_carton"`
	MarketplaceLink     string      `json:"marketplace_link"`
	CustomAffiliateLink string      `json:"custom_affiliate_link"`
	AffiliateLink       string      `json:"affiliate_link"`
	IsBundle            bool        `json:"is_bundle"`
	Images              []string    `json:"images"`
	Components          []Component `json:"components,omitempty"`
}

type Component struct {
	ProductID int64  `json:"product_id"`
	SKU       string `json:"sku"`
	Name      string `json:"name"`
	Qty       int    `json:"qty"`
}

type Event struct {
	ID       int64    `json:"id"`
	Code     string   `json:"code"`
	Name     string   `json:"name"`
	Location string   `json:"location"`
	IsActive bool     `json:"is_active"`
	Lat      *float64 `json:"lat"`
	Lng      *float64 `json:"lng"`
}

type EventProduct struct {
	EventID    int64    `json:"event_id"`
	ProductID  int64    `json:"product_id"`
	Price      int      `json:"price"`
	StockTotal int      `json:"stock_total"`
	Available  int      `json:"available"`
	Reserved   int      `json:"reserved"`
	Sold       int      `json:"sold"`
	IsActive   bool     `json:"is_active"`
	Product    *Product `json:"product,omitempty"`
}

// StockMovement adalah satu baris ledger stock_movements (inventory log).
type StockMovement struct {
	ID        int64     `json:"id"`
	EventID   int64     `json:"event_id"`
	EventName string    `json:"event_name"`
	ProductID int64     `json:"product_id"`
	SKU       string    `json:"sku"`
	Product   string    `json:"product"`
	Type      string    `json:"type"` // IN | RESERVE | UNRESERVE | PICK | RETURN | ADJUST
	Qty       int       `json:"qty"`
	RefType   string    `json:"ref_type"`
	RefID     int64     `json:"ref_id"`
	RefNo     string    `json:"ref_no"` // nomor order bila ref_type='order'
	Reason    string    `json:"reason"`
	Actor     string    `json:"actor"` // siapa yang melakukan (admin/operator/customer)
	CreatedAt time.Time `json:"created_at"`
}

type OrderItem struct {
	ID        int64  `json:"id"`
	ItemType  string `json:"item_type"`
	ParentID  int64  `json:"parent_id,omitempty"`
	ProductID int64  `json:"product_id"`
	SKU       string `json:"sku"`
	Name      string `json:"name"`
	Qty       int    `json:"qty"`
	Price     int    `json:"price"`
	State     string `json:"state"`
}

type Payment struct {
	ID             int64      `json:"id"`
	OrderID        int64      `json:"order_id"`
	Method         string     `json:"method"`
	Amount         int        `json:"amount"`
	Status         string     `json:"status"`
	ProviderRef    string     `json:"provider_ref"`
	RefNo          string     `json:"ref_no"` // nomor order untuk rekonsiliasi
	PaymentLinkURL string     `json:"payment_link_url"`
	ExpiresAt      *time.Time `json:"expires_at"`
}

type Order struct {
	ID            int64       `json:"id"`
	OrderNo       string      `json:"order_no"`
	EventID       int64       `json:"event_id"`
	EventName     string      `json:"event_name"`
	Channel       string      `json:"channel"`
	Status        string      `json:"status"`
	CustomerName  string      `json:"customer_name"`
	CustomerPhone string      `json:"customer_phone"`
	Total         int         `json:"total"`
	QRCode        string      `json:"qr_code"`
	PickupNo      *int        `json:"pickup_no"`
	PaymentMethod string      `json:"payment_method"`
	ProviderRef   string      `json:"provider_ref"`
	ReservedUntil *time.Time  `json:"reserved_until"`
	CreatedAt     time.Time   `json:"created_at"`
	Items         []OrderItem `json:"items"`
	Payment       *Payment    `json:"payment,omitempty"`
}

type Dashboard struct {
	TodaySales       int            `json:"today_sales"`
	OrderCount       int            `json:"order_count"`
	ActiveOrders     int            `json:"active_orders"`
	ReadyOrders      int            `json:"ready_orders"`
	CompletedOrders  int            `json:"completed_orders"`
	RevenueByMethod  map[string]int `json:"revenue_by_method"`
	MethodCount      map[string]int `json:"method_count"`
	QrisFee          int            `json:"qris_fee"`
	ProductsLowStock int            `json:"products_low_stock"`
}
