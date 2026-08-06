import { useEffect, useState } from 'react'
import { Card, Tabs, List, Button, Tag, Space, Input, message, Descriptions, Alert, Typography, Select } from 'antd'
import { ScanOutlined } from '@ant-design/icons'
import { api, Order, Event, fmtRp, STATUS_LABEL } from '../api'

export default function FulfillPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState(0)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [scanToken, setScanToken] = useState('')
  const [scanned, setScanned] = useState<Order | null>(null)

  function load() {
    setLoading(true)
    api.get<Order[]>(`/fulfillment/orders?event_id=${eventId || ''}`)
      .then(setOrders).catch((e) => message.error(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { api.get<Event[]>('/store/events').then((e) => { setEvents(e); if (e.length) setEventId(e[0].id) }) }, [])
  useEffect(load, [eventId])

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

  function orderCard(o: Order, actions: React.ReactNode) {
    const displayItems = o.items.filter((i) => i.item_type !== 'component')
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
          renderItem={(i) => (
            <List.Item style={{ padding: '4px 0' }}>
              <Space>
                {i.item_type === 'bundle' && <Tag color="gold">Bundle</Tag>}
                <span>{i.name}</span>
                <span style={{ color: '#888' }}>×{i.qty}</span>
                {i.item_type === 'component' && <Tag>komponen</Tag>}
              </Space>
            </List.Item>
          )}
        />
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
            key: 'pick', label: `Pick (${filter(['paid', 'picking', 'picked']).length})`,
            children: filter(['paid', 'picking', 'picked']).map((o) => orderCard(o, (
              <Button type="primary" size="large" disabled={o.status === 'picked'} onClick={() => act(`/orders/${o.id}/pick`, 'Order di-pick')}>
                {o.status === 'picked' ? 'Sudah di-pick' : 'Pick Semua'}
              </Button>
            ))),
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
