import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Button, Input, Space, Tag, Modal, message, Statistic, Row, Col, Alert, Typography } from 'antd'
import { ScanOutlined, DeleteOutlined, PrinterOutlined } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { api, PosProduct, Event, Order, fmtRp } from '../api'

const imgFallback = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#f0f0f0"/><text x="60" y="66" font-size="12" fill="#aaa" text-anchor="middle">No Image</text></svg>')

interface Line { product_id: number; name: string; sku: string; price: number; qty: number; item_type: string; available: number }

// Struk EDC: list barang, nama event, dan QR untuk ambil barang
function Receipt({ order }: { order: Order }) {
  const items = order.items.filter((i) => i.item_type !== 'component')
  return (
    <div className="receipt-area" style={{ fontFamily: '"Courier New", monospace', fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ textAlign: 'center' }}>
        <b style={{ fontSize: 16 }}>SUPERBAZAAR</b><br />
        {order.event_name}<br />
        <span style={{ fontSize: 11 }}>POS — Struk Penjualan</span>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0', paddingTop: 6 }}>
        Order: {order.order_no}<br />
        Tanggal: {new Date(order.created_at).toLocaleString('id-ID')}<br />
        Metode: <b>EDC</b> · No. Reff: {order.provider_ref || order.payment?.provider_ref || '-'}
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0', paddingTop: 6 }}>
        {items.map((i) => (
          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ flex: 1 }}>{i.name} ×{i.qty}</span>
            <span>{fmtRp(i.price * i.qty)}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <b>Total</b>
        <b>{fmtRp(order.total)}</b>
      </div>
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <QRCodeSVG value={order.qr_code} size={140} style={{ margin: '0 auto' }} />
        <div style={{ fontSize: 11 }}>Tunjukkan QR ini saat mengambil barang</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>Terima kasih telah berbelanja! 🛍️</div>
      </div>
    </div>
  )
}

export default function PosPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState(0)
  const [products, setProducts] = useState<PosProduct[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [scan, setScan] = useState('')
  const [paying, setPaying] = useState(false)
  const [lastOrder, setLastOrder] = useState<Order | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [custName, setCustName] = useState('')
  const [edcRef, setEdcRef] = useState('')

  useEffect(() => { api.get<Event[]>('/store/events').then((e) => { setEvents(e); if (e.length) setEventId(e[0].id) }) }, [])
  useEffect(() => {
    if (!eventId) return
    api.get<PosProduct[]>(`/pos/products?event_id=${eventId}`).then(setProducts).catch((e) => message.error(e.message))
  }, [eventId])

  function addProduct(p: PosProduct, qty = 1) {
    setLines((prev) => {
      const found = prev.find((l) => l.product_id === p.product_id)
      if (found) {
        if (found.qty + qty > p.available) { message.warning('Melebihi stok'); return prev }
        return prev.map((l) => (l.product_id === p.product_id ? { ...l, qty: l.qty + qty } : l))
      }
      if (qty > p.available) { message.warning('Stok habis'); return prev }
      return [...prev, { product_id: p.product_id, name: p.name, sku: p.sku, price: p.price, qty, item_type: p.is_bundle ? 'bundle' : 'product', available: p.available }]
    })
  }

  function onScan(e: any) {
    const code = scan.trim()
    if (!code) return
    const byPcs = products.find((p) => p.barcode_pcs === code)
    const byCarton = products.find((p) => p.barcode_carton === code)
    if (byPcs) addProduct(byPcs, 1)
    else if (byCarton) addProduct(byCarton, byCarton.qty_per_carton || 1)
    else message.warning('Barcode tidak ditemukan')
    setScan('')
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
  }, [products, search])

  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)

  function startPay() {
    if (lines.length === 0) { message.warning('Keranjang kosong'); return }
    if (!edcRef.trim()) { message.warning('Nomor reff EDC wajib diisi (dari struk mesin EDC)'); return }
    doCheckout()
  }

  async function doCheckout() {
    setPaying(true)
    try {
      const order = await api.post<Order>('/pos/checkout', {
        event_id: eventId, method: 'edc',
        customer_name: custName.trim(),
        provider_ref: edcRef.trim(),
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, item_type: l.item_type })),
      })
      setLastOrder(order)
      setLines([])
      setEdcRef('')
      setReceiptOpen(true)
      message.success(`Transaksi selesai: ${order.order_no}`)
    } catch (e: any) { message.error(e.message) } finally { setPaying(false) }
  }

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card
            size="small" title="Cari / Scan Produk"
            extra={
              <Select size="small" style={{ width: 200 }} value={eventId || undefined} onChange={setEventId}
                options={events.map((e) => ({ value: e.id, label: e.name }))} />
            }
          >
            <Space style={{ marginBottom: 8 }} wrap>
              <Input
                placeholder="Scan barcode PCS / CARTON lalu Enter"
                prefix={<ScanOutlined />} value={scan} onChange={(e) => setScan(e.target.value)}
                onPressEnter={onScan} style={{ width: 320 }}
              />
              <Input.Search placeholder="Cari nama / SKU" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            </Space>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {filtered.map((p) => (
                <button
                  key={p.product_id}
                  type="button"
                  disabled={p.available < 1}
                  onClick={() => addProduct(p, 1)}
                  style={{
                    border: '1px solid #d9d9d9', borderRadius: 8, background: '#fff', cursor: 'pointer',
                    padding: 0, overflow: 'hidden', textAlign: 'left', display: 'flex', flexDirection: 'column',
                    minHeight: 158, opacity: p.available < 1 ? 0.45 : 1, boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                  }}
                >
                  <div style={{ height: 84, overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={p.images?.[0] || imgFallback} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ padding: '6px 8px', flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.name}</div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>{fmtRp(p.price)}</div>
                    <div style={{ fontSize: 11, color: p.available > 0 ? '#52c41a' : '#ff4d4f' }}>stok {p.available}</div>
                    {p.is_bundle && <div style={{ marginTop: 2 }}><Tag color="gold" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>Bundle</Tag></div>}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card size="small" title="Keranjang POS" extra={<Statistic title="Total" value={total} formatter={(v) => fmtRp(Number(v))} style={{ fontSize: 12 }} />}>
            <Table
              size="small" pagination={false} rowKey="product_id"
              scroll={{ x: 'max-content' }}
              dataSource={lines}
              locale={{ emptyText: 'Belum ada item' }}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Qty', dataIndex: 'qty', width: 50 },
                { title: 'Subtotal', render: (_: any, l: Line) => fmtRp(l.price * l.qty) },
                { title: '', render: (_: any, l: Line) => <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x !== l))} /> },
              ]}
            />
            <Input
              placeholder="Nama pembeli (opsional)" value={custName} allowClear
              onChange={(e) => setCustName(e.target.value)} style={{ marginTop: 12 }}
            />
            <Space style={{ marginTop: 8, width: '100%' }} wrap>
              <Tag color="blue" style={{ lineHeight: '22px' }}>EDC</Tag>
              <Input
                placeholder="Nomor Reff EDC (dari struk mesin) — wajib" value={edcRef} allowClear
                onChange={(e) => setEdcRef(e.target.value)} style={{ flex: 1, minWidth: 200 }}
              />
            </Space>
            <Space style={{ marginTop: 12, width: '100%', justifyContent: 'flex-end' }} wrap>
              <Button type="primary" size="large" onClick={startPay} loading={paying} disabled={lines.length === 0}>
                Bayar EDC {fmtRp(total)}
              </Button>
            </Space>
            {lastOrder && (
              <Alert style={{ marginTop: 12 }} type="success" showIcon
                message={`${lastOrder.order_no} selesai (EDC) — struk siap dicetak`} />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title={null} open={receiptOpen && !!lastOrder} onCancel={() => setReceiptOpen(false)}
        footer={null} width={380}
      >
        {lastOrder && <Receipt order={lastOrder} />}
        <div className="no-print" style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 8 }}>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>Cetak Struk</Button>
          <Button onClick={() => setReceiptOpen(false)}>Selesai</Button>
        </div>
      </Modal>
    </div>
  )
}
