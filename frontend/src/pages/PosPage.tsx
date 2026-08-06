import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Button, Input, Select, Space, Tag, Modal, message, Statistic, Row, Col, Alert, Typography } from 'antd'
import { ScanOutlined, DeleteOutlined } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { api, PosProduct, Event, Order, fmtRp } from '../api'

interface Line { product_id: number; name: string; sku: string; price: number; qty: number; item_type: string; available: number }

export default function PosPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState(0)
  const [products, setProducts] = useState<PosProduct[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [scan, setScan] = useState('')
  const [method, setMethod] = useState('qris')
  const [paying, setPaying] = useState(false)
  const [payModal, setPayModal] = useState(false)
  const [lastOrder, setLastOrder] = useState<Order | null>(null)
  const [search, setSearch] = useState('')

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
    if (method === 'qris') setPayModal(true)
    else doCheckout()
  }

  async function doCheckout() {
    setPaying(true)
    try {
      const order = await api.post<Order>('/pos/checkout', {
        event_id: eventId, method,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, item_type: l.item_type })),
      })
      setLastOrder(order)
      setLines([])
      setPayModal(false)
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {filtered.map((p) => (
                <Button
                  key={p.product_id}
                  size="large"
                  disabled={p.available < 1}
                  onClick={() => addProduct(p, 1)}
                  style={{ height: 'auto', padding: '10px 8px', whiteSpace: 'normal' }}
                >
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: p.available > 0 ? '#52c41a' : '#ff4d4f' }}>
                    {fmtRp(p.price)} · stok {p.available}
                  </div>
                  {p.is_bundle && <div style={{ fontSize: 11 }}><Tag color="gold">Bundle</Tag></div>}
                </Button>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card size="small" title="Keranjang POS" extra={<Statistic title="Total" value={total} formatter={(v) => fmtRp(Number(v))} style={{ fontSize: 12 }} />}>
            <Table
              size="small" pagination={false} rowKey="product_id"
              dataSource={lines}
              locale={{ emptyText: 'Belum ada item' }}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Qty', dataIndex: 'qty', width: 50 },
                { title: 'Subtotal', render: (_: any, l: Line) => fmtRp(l.price * l.qty) },
                { title: '', render: (_: any, l: Line) => <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x !== l))} /> },
              ]}
            />
            <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
              <Select value={method} onChange={setMethod} style={{ width: 130 }}
                options={[
                  { value: 'qris', label: 'QRIS' },
                  { value: 'edc', label: 'EDC' },
                ]} />
              <Button type="primary" size="large" onClick={startPay} loading={paying} disabled={lines.length === 0}>
                Bayar {fmtRp(total)}
              </Button>
            </Space>
            {lastOrder && (
              <Alert style={{ marginTop: 12 }} type="success" showIcon
                message={`${lastOrder.order_no} selesai (${lastOrder.payment_method}) — barang langsung diserahkan`} />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="Bayar QRIS" open={payModal} onCancel={() => setPayModal(false)}
        footer={<Button type="primary" loading={paying} onClick={doCheckout}>Konfirmasi Sudah Bayar</Button>}
      >
        <div style={{ textAlign: 'center' }}>
          <Typography.Paragraph type="secondary">Customer scan QR ini (mode demo), lalu kasir konfirmasi.</Typography.Paragraph>
          <QRCodeSVG value={`POS-QRIS-${Date.now()}`} size={200} style={{ margin: '0 auto' }} />
          <div style={{ marginTop: 8 }}><b>{fmtRp(total)}</b></div>
        </div>
      </Modal>
    </div>
  )
}
