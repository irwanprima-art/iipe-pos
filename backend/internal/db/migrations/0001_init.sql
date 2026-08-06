-- IIPE initial schema
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', -- admin, cashier, picker, packer, operator
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  barcode_pcs TEXT UNIQUE,
  barcode_carton TEXT UNIQUE,
  qty_per_carton INT NOT NULL DEFAULT 1,
  marketplace_link TEXT,
  is_bundle BOOLEAN NOT NULL DEFAULT false,
  images TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bundle_components (
  id BIGSERIAL PRIMARY KEY,
  bundle_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES products(id),
  component_qty INT NOT NULL DEFAULT 1,
  UNIQUE (bundle_id, component_id)
);

CREATE TABLE event_products (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price INT NOT NULL DEFAULT 0,
  stock_total INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (event_id, product_id)
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  event_id BIGINT NOT NULL REFERENCES events(id),
  channel TEXT NOT NULL, -- online | pos
  status TEXT NOT NULL, -- pending_payment | paid | picking | picked | packing | packed | ready | handed_over | completed | cancelled
  customer_name TEXT,
  customer_phone TEXT,
  total INT NOT NULL DEFAULT 0,
  qr_code TEXT,
  pickup_no INT,
  payment_method TEXT,
  provider_ref TEXT,
  reserved_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_event ON orders(event_id);

CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL, -- product | bundle | component
  parent_id BIGINT REFERENCES order_items(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty INT NOT NULL,
  price INT NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'allocated' -- allocated | picked | packed | handed_over | cancelled
);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL, -- qris | edc | cash
  amount INT NOT NULL,
  status TEXT NOT NULL, -- pending | paid | expired | failed | refunded
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL, -- IN | RESERVE | UNRESERVE | PICK | RETURN | ADJUST
  qty INT NOT NULL,
  ref_type TEXT,
  ref_id BIGINT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_product ON stock_movements(event_id, product_id);

CREATE TABLE notification_logs (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  actor TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
