import { Card, Typography, Row, Col, Divider } from 'antd'
import { Link } from 'react-router-dom'
import pkg from '../../package.json'

// Halaman "Tentang" — info singkat & fitur SuperBazaar (tidak menonjol)
export default function AboutPage() {
  const features = [
    ['🛍️ Storefront Online', 'Katalog per event, keranjang, checkout dengan nama & no. WA.'],
    ['💳 Pembayaran', 'QRIS via SumoPay, atau bayar di kasir (toggle per event).'],
    ['🧾 POS Kasir', 'Scan barcode PCS/CARTON, pembayaran EDC + nomor reff, struk otomatis.'],
    ['📦 Fulfillment', 'Pick via scan barcode, pack + label pickup 10×10 cm, handover scan QR.'],
    ['📊 Stok Real-time', 'Ledger anti-oversell, terima barang, inventory log lengkap (siapa & kapan).'],
    ['🗂️ Admin', 'Produk, bundle, event, order (filter tanggal + export Excel), dashboard, staff.'],
    ['📲 WhatsApp', 'Notifikasi otomatis via n8n + GOWA.'],
    ['📱 PWA', 'Bisa dipasang di HP — khusus halaman fulfillment (mobile-first).'],
  ]
  return (
    <div style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <Card>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>SuperBazaar</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Sistem POS & E-Commerce terpadu untuk event bazaar — satu sumber stok untuk belanja
          online dan kasir offline, dengan alur fulfillment dari pick hingga serah terima.
        </Typography.Paragraph>
        <Divider style={{ margin: '12px 0' }} />
        <Typography.Text strong>Fitur Utama</Typography.Text>
        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          {features.map(([t, d]) => (
            <Col key={t} xs={24} md={12}>
              <Card size="small" style={{ height: '100%' }}>
                <b>{t}</b>
                <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>{d}</div>
              </Card>
            </Col>
          ))}
        </Row>
        <Divider style={{ margin: '16px 0' }} />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Versi {pkg.version} · <Link to="/">Kembali ke beranda</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
