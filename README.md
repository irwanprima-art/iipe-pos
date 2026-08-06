# IIPE — Sistem POS & E-Commerce Hibrida untuk Event Bazaar

Satu sistem terpadu untuk event bazaar: **e-commerce** (belanja online + bayar QRIS + pickup) dan **POS** (kasir offline, QRIS/EDC), dengan satu sumber stok (PostgreSQL), state machine order, fulfillment (pick & pack), notifikasi WhatsApp via n8n, bundle, barcode pcs/carton, dan link affiliate Shopee.

Dokumen lengkap: [`docs/PRD.md`](docs/PRD.md)

## Fitur Utama
- **Storefront**: katalog per event, keranjang, checkout (nama + no. WA), QRIS (mock), status order + QR code, tooltip "Beli di Shopee" (link affiliate).
- **Admin**: produk (gambar, barcode pcs/carton, qty per carton, link Shopee → affiliate), bundle, event & katalog/harga/stok, order, stock ledger, dashboard.
- **Fulfillment (mobile-first)**: pick → pack (nomor pickup #001 → label 10×10 cm) → ready → handover (scan QR customer).
- **POS**: scan barcode (pcs/carton), keranjang, bayar QRIS/EDC/tunai, langsung handed over.
- **Stok**: ledger `stock_movements` + reservasi atomik (anti-oversell), bundle derived dari komponen.

## Quick Start (Docker)

```bash
docker compose up --build
```

- Storefront: http://localhost:8090
- Admin / POS / Fulfillment: http://localhost:8090 (login: `admin@iipe.dev` / `admin123`)
- Backend API: http://localhost:8080/api/v1
- PostgreSQL: localhost:55432 (iipe/iipe)

**Login admin:** `admin@iipe.dev` / `admin123`

> Mapping port disesuaikan karena port default (5432/3000) dipakai proses lain di mesin ini — ubah di `docker-compose.yml` bila perlu. Data demo (event, produk, bundle, stok, admin) **otomatis di-seed saat backend start** (idempotent).

## Struktur

```
backend/   Go REST API (pgx, JWT, stdlib mux)
frontend/  React + TypeScript + Ant Design (Vite)
docs/      PRD
docker-compose.yml
```

## Pengembangan Lokal (tanpa Docker)

Backend:
```bash
cd backend
go mod tidy
DATABASE_URL=postgres://iipe:iipe@localhost:5432/iipe?sslmode=disable go run ./cmd/server
```

Frontend:
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173 (proxy /api → :8080)
```

## Konfigurasi (env)

> Semua environment variable dibaca dari file **`.env`** di root proyek (docker compose memuatnya otomatis).
> Salin `.env.example` → `.env`, lalu isi nilai rahasia Anda. Tidak ada secret yang di-hardcode di `docker-compose.yml`.

| Var | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | postgres://iipe:iipe@localhost:5432/iipe | koneksi PostgreSQL |
| `JWT_SECRET` | dev-secret-change-me | secret JWT (ganti di produksi) |
| `PORT` | 8080 | port backend |
| `MOCK_PAYMENTS` | true | true = mock; `false` + `SUMO_API_KEY` = pakai SumoPay (QRIS) |
| `SUMO_API_URL` | https://api-pay-sandbox.sumopod.com | endpoint SumoPay (sandbox/produksi) |
| `SUMO_API_KEY` | (kosong) | API key SumoPay |
| `SUMO_WEBHOOK_SECRET` | (kosong) | signing secret `whsec_...` (verifikasi signature Svix) |
| `SUMO_WEBHOOK_TOKEN` | (kosong) | webhook token `whtok_...` (header X-Webhook-Token) |
| `S3_ENDPOINT` | (kosong) | host S3-compatible, mis. `kencana.basic.box.cloudeka.id` |
| `S3_BUCKET` | (kosong) | nama bucket S3 (kosong = pakai penyimpanan lokal) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | (kosong) | kredensial S3 |
| `S3_PUBLIC_URL` | (kosong) | URL publik, mis. `https://kencana.basic.box.cloudeka.id` |
| `S3_SECURE` | true | pakai HTTPS untuk S3 |
| `AFFILIATE_CODE` | iipe-affiliate | kode affiliate Shopee untuk generate link |
| `N8N_WEBHOOK_URL` | (kosong) | endpoint n8n; dikirim saat order `ready` |

## Catatan MVP
- **Pembayaran**: SumoPay (QRIS). Aktifkan dengan `MOCK_PAYMENTS=false` + isi `SUMO_API_KEY` di `.env`. Saat checkout, customer diarahkan ke `payment_link_url` SumoPay. Webhook (`/api/v1/webhooks/sumopay`) memverifikasi **signature Svix** + **token**, lalu menandai order paid/failed/expired. Untuk webhook diterima, URL harus publik (mis. ngrok saat dev lokal) dan didaftarkan di dashboard SumoPay.
- Notifikasi WhatsApp via **n8n**: backend mengirim webhook `order.ready` ke `N8N_WEBHOOK_URL`; jika kosong, notifikasi hanya dicatat di `notification_logs`.
- Link affiliate Shopee dibuat deterministik (menambah parameter kode affiliate). Untuk komisi resmi, hubungkan dengan tool resmi Shopee Affiliate.
- **Gambar produk**: simpan di **S3 / object storage** (CloudEka box) dengan mengisi `S3_*`. 1 SKU bisa punya banyak gambar (array URL). Tombol "Upload Gambar (S3)" ada di form Produk. Jika S3 belum diisi, upload jatuh ke penyimpanan lokal `/uploads`.
- **Menu internal (Admin/POS/Fulfillment) tersembunyi** dari pengunjung — hanya muncul link kecil "Login"; menu internal muncul setelah login.
