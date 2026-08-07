import { useEffect, useState } from 'react'
import { Card, Tabs, List, Button, Tag, Space, Input, message, Descriptions, Alert, Typography, Select } from 'antd'
import { ScanOutlined } from '@ant-design/icons'
import { api, Order, Event, PosProduct, fmtRp, STATUS_LABEL } from '../api'

export default function FulfillPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState(0)
  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<PosProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [scanToken, setScanToken] = useState('')
  const [scanned, setScanned] = useState<Order | null>(null)

  function load() {
    setLoading(true)
    api.get<Order[]>(`/fulfillment/orders?event_id=${eventId || ''}`)
      .then((res) => setOrders(Array.isArray(res) ? res : []))
      .catch((e) => message.error(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { api.get<Event[]>('/store/events').then((e) => { setEvents(e); if (e.length) setEventId(e[0].id) }) }, [])
  useEffect(load, [eventId])
  // produk per event (untuk verifikasi barcode pcs/carton saat pick)
  useEffect(() => {
    if (eventId) api.get<PosProduct[]>(`/pos/products?event_id=${eventId}`).then(setProducts).catch(() => {})
  }, [eventId])

  function replaceOrder(updated: Order) {
    setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    setScanned((prev) => (prev && prev.id === updated.id ? updated : prev))
  }

  async function act(path: string, done: string) {
    try {
      const id = path.split('/')[2]
      await api.post(path)
      message.success(done)
      if (scanned && String(scanned.id) === id) setScanned(null)
      load()
    } catch (e: any) { message.error(e.message) }
  }

  async function doScan() {
    const t = scanToken.trim()
    if (!t) return
    try {
      const o = await api.post<Order>('/orders/scan', { token: t })
      setScanned(o)
      setScanToken('')
    } catch (e: any) { message.error(e.message) }
  }

  // --- Pick via scan barcode: pcs = 1 pcs, carton = qty_per_carton; verifikasi item order ---
  async function pickByBarcode(o: Order, code: string) {
    const c = (code || '').trim()
    if (!c) return false
    const byPcs = products.find((p) => p.barcode_pcs === c)
    const byCarton = products.find((p) => p.barcode_carton === c)
    const prod = byPcs || byCarton
    if (!prod) { message.warning('Barcode tidak ditemukan'); return false }
    const qty = byCarton ? prod.qty_per_carton : 1
    const item = o.items.find((i) =>
      i.product_id === prod.product_id &&
      (i.item_type === 'product' || i.item_type === 'component') &&
      i.state !== 'cancelled' && i.qty > (i.picked_qty || 0))
    if (!item) { message.warning(`Barcode ${prod.sku} bukan item order ini (atau sudah penuh)`); return false }
    try {
      const updated = await api.post<Order>(`/orders/${o.id}/pick-item`, { product_id: prod.product_id, qty })
      message.success(`${prod.sku} +${qty} di-pick (${byCarton ? 'box' : 'pcs'})`)
      replaceOrder(updated)
      return true
    } catch (e: any) { message.error(e.message); return false }
  }

  function PickScan({ o }: { o: Order }) {
    const [code, setCode] = useState('')
    const doPick = async () => { if (await pickByBarcode(o, code)) setCode('') }
    return (
      <Space wrap style={{ marginTop: 8 }}>
        <Input
          prefix={<ScanOutlined />} placeholder="Scan barcode PCS / CARTON lalu Enter" value={code}
          onChange={(e) => setCode(e.target.value)} onPressEnter={doPick} style={{ width: 280 }}
        />
        <Button onClick={doPick}>Scan Pick</Button>
      </Space>
    )
  }

  function orderCard(o: Order, actions: React.ReactNode, showPickProgress = false) {
    const picking = o.status === 'paid' || o.status === 'picking'
    const displayItems = showPickProgress
      ? o.items.filter((i) => (i.item_type === 'product' || i.item_type === 'component') && i.state !== 'cancelled')
      : o.items.filter((i) => i.item_type !== 'component')
    return (
      <Card size="small" style={{ marginBottom: 12 }} key={o.id}
        title={<Space>{o.order_no} {o.pickup_no != null && <Tag color="gold">#{String(o.pickup_no).padStart(3, '0')}</Tag>}</Space>}
        extra={<Tag>{STATUS_LABEL[o.status] || o.status}</Tag>}
      >
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Customer">{o.customer_name}</Descriptions.Item>
          <Descriptions.Item label="WA">{o.customer_phone}</Descriptions.Item>
        </Descriptions>
        <List
          size="small" dataSource={displayItems}
          renderItem={(i) => {
            const picked = i.picked_qty || 0
            const done = picked >= i.qty
            return (
              <List.Item style={{ padding: '4px 0' }}>
                <Space wrap>
                  {i.item_type === 'bundle' && <Tag color="gold">Bundle</Tag>}
                  {i.item_type === 'component' && <Tag>komponen</Tag>}
                  <span>{i.name}</span>
                  <span style={{ color: '#888' }}>×{i.qty}</span>
                  {showPickProgress && (
                    <Tag color={done ? 'green' : 'blue'}>{picked}/{i.qty} picked</Tag>
                  )}
                </Space>
              </List.Item>
            )
          }}
        />
        {picking && <PickScan o={o} />}
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <b>{fmtRp(o.total)}</b>
          {actions}
        </div>
      </Card>
    )
  }

  const filter = (statuses: string[]) => orders.filter((o) => statuses.includes(o.status))

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text strong>Portal Fulfillment (mobile-first)</Typography.Text>
        <Select size="small" style={{ width: 220 }} value={eventId || undefined} onChange={setEventId}
          options={events.map((e) => ({ value: e.id, label: e.name }))} />
        <Button size="small" onClick={load}>Refresh</Button>
      </Space>

      <Tabs
        defaultActiveKey="pick"
        items={[
          {
            key: 'pick', label: `Pick (${filter(['paid', 'picking']).length})`,
            children: filter(['paid', 'picking']).length ? filter(['paid', 'picking']).map((o) => orderCard(o, null, true)) : (
              <Alert type="info" showIcon message="Tidak ada order yang menunggu pick. Order yang sudah di-pick otomatis pindah ke tab Pack." />
            ),
          },
          {
            key: 'pack', label: `Pack (${filter(['picked', 'packing']).length})`,
            children: filter(['picked', 'packing']).map((o) => orderCard(o, (
              <Button type="primary" size="large" onClick={() => act(`/orders/${o.id}/pack`, 'Pack + nomor pickup dibuat')}>Pack & Beri Nomor</Button>
            ))),
          },
          {
            key: 'ready', label: `Ready (${filter(['packed']).length})`,
            children: filter(['packed']).map((o) => orderCard(o, (
              <Button type="primary" size="large" onClick={() => act(`/orders/${o.id}/ready`, 'Ready — notifikasi WA terkirim')}>Tandai Ready</Button>
            ))),
          },
          {
            key: 'handover', label: `Handover (${filter(['ready']).length})`,
            children: (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="Scan QR customer (atau ketik kode) → dapat nomor pickup → cari paket → konfirmasi serah terima." />
                <Space style={{ marginBottom: 12 }}>
                  <Input
                    prefix={<ScanOutlined />} placeholder="Scan QR / kode order" value={scanToken}
                    onChange={(e) => setScanToken(e.target.value)} onPressEnter={doScan} style={{ width: 300 }}
                  />
                  <Button type="primary" onClick={doScan}>Scan</Button>
                </Space>
                {scanned && (
                  <Card size="small" style={{ marginBottom: 12 }} title={`Order ${scanned.order_no}`} extra={<Tag color="gold">#{scanned.pickup_no != null ? String(scanned.pickup_no).padStart(3, '0') : '-'}</Tag>}>
                    <Descriptions column={2} size="small">
                      <Descriptions.Item label="Customer">{scanned.customer_name}</Descriptions.Item>
                      <Descriptions.Item label="Status">{STATUS_LABEL[scanned.status]}</Descriptions.Item>
                      {scanned.pickup_no != null && <Descriptions.Item label="Cari paket no."><b>#{String(scanned.pickup_no).padStart(3, '0')}</b></Descriptions.Item>}
                    </Descriptions>
                    {(scanned.status === 'ready' || scanned.status === 'packed') && (
                      <Button type="primary" size="large" style={{ marginTop: 8 }} onClick={() => act(`/orders/${scanned.id}/handover`, 'Handover selesai')}>
                        Konfirmasi Handover
                      </Button>
                    )}
                  </Card>
                )}
                {filter(['ready']).map((o) => orderCard(o, (
                  <Button type="primary" size="large" onClick={() => act(`/orders/${o.id}/handover`, 'Handover selesai')}>Handover</Button>
                )))}
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
