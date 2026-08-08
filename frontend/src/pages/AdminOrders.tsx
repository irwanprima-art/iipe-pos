import { useEffect, useState } from 'react'
import { Card, Table, Select, Space, Tag, Button, Drawer, Descriptions, message, Alert, DatePicker } from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, Order, Event, fmtRp, STATUS_LABEL } from '../api'

const STATUSES = ['pending_payment', 'paid', 'picking', 'picked', 'packing', 'packed', 'ready', 'handed_over', 'completed', 'cancelled']

function esc(v: any) { return String(v ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export default function AdminOrders() {
  const [rows, setRows] = useState<Order[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [status, setStatus] = useState('')
  const [eventId, setEventId] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detail, setDetail] = useState<Order | null>(null)

  function load() {
    api.get<Order[]>(`/admin/orders?status=${status}&event_id=${eventId}&from=${from}&to=${to}`)
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((e) => message.error(e.message))
  }
  useEffect(() => { api.get<Event[]>('/admin/events').then(setEvents).catch(() => {}) }, [])
  useEffect(load, [status, eventId, from, to])

  // Export data yang tampil (hasil filter) ke Excel (.xls)
  function exportExcel() {
    const head = ['No. Order', 'Tanggal', 'Event', 'Channel', 'Customer', 'WA', 'Total', 'Status', 'Metode', 'No. Reff', 'No. Ambil']
    const body = rows.map((o) => [
      o.order_no,
      new Date(o.created_at).toLocaleString('id-ID'),
      o.event_name,
      o.channel,
      o.customer_name,
      o.customer_phone,
      o.total,
      STATUS_LABEL[o.status] || o.status,
      o.payment_method || '',
      o.payment?.ref_no || o.provider_ref || '',
      o.pickup_no != null ? `#${String(o.pickup_no).padStart(3, '0')}` : '',
    ])
    const html = `<table border="1"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
      body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') + '</table>'
    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders-${from || new Date().toISOString().slice(0, 10)}-${to || 'semua'}.xls`
    a.click()
    URL.revokeObjectURL(url)
    message.success(`${rows.length} order diexport`)
  }

  return (
    <Card title="Order" extra={
      <Space wrap>
        <DatePicker.RangePicker
          size="small"
          onChange={(d) => {
            setFrom(d && d[0] ? d[0].format('YYYY-MM-DD') : '')
            setTo(d && d[1] ? d[1].format('YYYY-MM-DD') : '')
          }}
        />
        <Select style={{ width: 200 }} value={status} onChange={setStatus}
          options={[{ value: '', label: 'Semua status' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] || s }))]} />
        <Select style={{ width: 220 }} value={eventId || undefined} onChange={(v) => setEventId(v || 0)} placeholder="Semua event"
          options={[{ value: 0, label: 'Semua event' }, ...events.map((e) => ({ value: e.id, label: e.name }))]} />
        <Button size="small" icon={<FileExcelOutlined />} onClick={exportExcel} disabled={rows.length === 0}>Export Excel</Button>
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
            {detail.status === 'pending_payment' && (
              <Alert type="warning" showIcon message="Order menunggu pembayaran. Konfirmasi lewat halaman status customer atau webhook payment." />
            )}
          </Space>
        )}
      </Drawer>
    </Card>
  )
}
