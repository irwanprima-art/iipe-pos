import { useEffect, useState } from 'react'
import { Card, Table, Select, Space, Tag, Button, Drawer, Descriptions, message, Popconfirm, Alert } from 'antd'
import { api, Order, Event, fmtRp, STATUS_LABEL } from '../api'

const STATUSES = ['pending_payment', 'paid', 'picking', 'picked', 'packing', 'packed', 'ready', 'handed_over', 'completed', 'cancelled']

export default function AdminOrders() {
  const [rows, setRows] = useState<Order[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [status, setStatus] = useState('')
  const [eventId, setEventId] = useState(0)
  const [detail, setDetail] = useState<Order | null>(null)

  function load() {
    api.get<Order[]>(`/admin/orders?status=${status}&event_id=${eventId}`).then(setRows).catch((e) => message.error(e.message))
  }
  useEffect(() => { api.get<Event[]>('/admin/events').then(setEvents).catch(() => {}) }, [])
  useEffect(load, [status, eventId])

  async function act(path: string, body?: any, done?: string) {
    try {
      await api.post(path, body)
      if (done) message.success(done)
      load()
      if (detail) api.get<Order>(`/admin/orders/${detail.id}`).then(setDetail)
    } catch (e: any) { message.error(e.message) }
  }

  return (
    <Card title="Order" extra={
      <Space>
        <Select style={{ width: 200 }} value={status} onChange={setStatus}
          options={[{ value: '', label: 'Semua status' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] || s }))]} />
        <Select style={{ width: 220 }} value={eventId || undefined} onChange={(v) => setEventId(v || 0)} placeholder="Semua event"
          options={[{ value: 0, label: 'Semua event' }, ...events.map((e) => ({ value: e.id, label: e.name }))]} />
      </Space>
    }>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'No. Order', dataIndex: 'order_no' },
          { title: 'Customer', dataIndex: 'customer_name' },
          { title: 'Channel', dataIndex: 'channel', render: (c: string) => <Tag color={c === 'pos' ? 'purple' : 'blue'}>{c.toUpperCase()}</Tag> },
          { title: 'Total', dataIndex: 'total', render: (v: number) => fmtRp(v) },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'completed' ? 'green' : s === 'cancelled' ? 'red' : s === 'ready' ? 'gold' : 'blue'}>{STATUS_LABEL[s] || s}</Tag> },
          { title: 'No. Ambil', dataIndex: 'pickup_no', render: (v?: number) => v ? `#${String(v).padStart(3, '0')}` : '-' },
          { title: 'Waktu', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString('id-ID') },
          { title: '', render: (_: any, o: Order) => <Button size="small" onClick={() => setDetail(o)}>Detail</Button> },
        ]}
      />

      <Drawer title={`Detail Order — ${detail?.order_no || ''}`} width={640} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Status"><Tag>{STATUS_LABEL[detail.status] || detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="Customer">{detail.customer_name} ({detail.customer_phone})</Descriptions.Item>
              <Descriptions.Item label="Event">{detail.event_name}</Descriptions.Item>
              <Descriptions.Item label="Total">{fmtRp(detail.total)}</Descriptions.Item>
              <Descriptions.Item label="Metode">{detail.payment_method || '-'}</Descriptions.Item>
              <Descriptions.Item label="No. Referensi">{detail.payment?.ref_no || detail.provider_ref || '-'}</Descriptions.Item>
              {detail.pickup_no != null && <Descriptions.Item label="Nomor Ambil">#{String(detail.pickup_no).padStart(3, '0')}</Descriptions.Item>}
            </Descriptions>
            <Table
              size="small" pagination={false} rowKey="id"
              dataSource={detail.items.filter((i) => i.item_type !== 'component')}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Tipe', dataIndex: 'item_type', render: (t: string) => <Tag>{t}</Tag> },
                { title: 'Qty', dataIndex: 'qty' },
                { title: 'State', dataIndex: 'state' },
              ]}
            />
            <Space wrap>
              {['paid', 'picking', 'picked'].includes(detail.status) && (
                <Button type="primary" onClick={() => act(`/orders/${detail.id}/pick`, undefined, 'Di-pick')}>Pick</Button>
              )}
              {['picked', 'packing'].includes(detail.status) && (
                <Button onClick={() => act(`/orders/${detail.id}/pack`, undefined, 'Di-pack + nomor pickup')}>Pack</Button>
              )}
              {detail.status === 'packed' && (
                <Button onClick={() => act(`/orders/${detail.id}/ready`, undefined, 'Ready (notifikasi terkirim)')}>Tandai Ready</Button>
              )}
              {['ready', 'packed'].includes(detail.status) && (
                <Button type="primary" onClick={() => act(`/orders/${detail.id}/handover`, undefined, 'Handover')}>Handover</Button>
              )}
              {!['completed', 'handed_over', 'cancelled'].includes(detail.status) && (
                <Popconfirm title="Batalkan order?" onConfirm={() => act(`/orders/${detail.id}/cancel`, { reason: 'dibatalkan admin' }, 'Dibatalkan')}>
                  <Button danger>Batalkan</Button>
                </Popconfirm>
              )}
            </Space>
            {detail.status === 'pending_payment' && (
              <Alert type="warning" showIcon message="Order menunggu pembayaran QRIS. Di mode demo, konfirmasi dari halaman status customer (Simulasi Bayar)." />
            )}
          </Space>
        )}
      </Drawer>
    </Card>
  )
}
