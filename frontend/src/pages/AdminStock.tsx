import { useEffect, useState } from 'react'
import { Card, Table, Select, Button, Modal, Input, Space, message, Tag } from 'antd'
import { api, EventProduct, Event, fmtRp } from '../api'

export default function AdminStock() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<number>(0)
  const [rows, setRows] = useState<EventProduct[]>([])
  const [editing, setEditing] = useState<EventProduct | null>(null)
  const [newTotal, setNewTotal] = useState(0)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<Event[]>('/admin/events').then((evs) => { setEvents(evs); if (evs.length) setEventId(evs[0].id) })
  }, [])

  function load() {
    if (!eventId) return
    api.get<EventProduct[]>(`/admin/events/${eventId}/products`).then(setRows).catch((e) => message.error(e.message))
  }
  useEffect(load, [eventId])

  async function doAdjust() {
    if (!editing) return
    setSaving(true)
    try {
      await api.post(`/admin/events/${eventId}/products/${editing.product_id}/stock`, { stock_total: newTotal, reason })
      message.success('Stok disesuaikan')
      setEditing(null)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Card title="Manajemen Stok" extra={
      <Select style={{ width: 260 }} value={eventId || undefined} onChange={setEventId}
        options={events.map((e) => ({ value: e.id, label: e.name }))} />
    }>
      <Table
        rowKey="product_id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'SKU', dataIndex: ['product', 'sku'] },
          { title: 'Nama', dataIndex: ['product', 'name'] },
          { title: 'Stok Total', dataIndex: 'stock_total' },
          { title: 'Reserved', dataIndex: 'reserved' },
          { title: 'Terjual', dataIndex: 'sold' },
          { title: 'Tersedia', dataIndex: 'available', render: (v: number) => <Tag color={v > 0 ? 'green' : 'red'}>{v}</Tag> },
          {
            title: 'Aksi', render: (_: any, r: EventProduct) => (
              <Button size="small" disabled={r.product?.is_bundle} onClick={() => { setEditing(r); setNewTotal(r.stock_total); setReason('') }}>Sesuaikan</Button>
            ),
          },
        ]}
      />
      <Modal
        title={`Sesuaikan Stok — ${editing?.product?.name || ''}`}
        open={!!editing} onCancel={() => setEditing(null)} onOk={doAdjust} confirmLoading={saving}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input type="number" value={newTotal} onChange={(e) => setNewTotal(Number(e.target.value))} addonBefore="Stok baru" />
          <Input placeholder="Alasan (wajib)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Space>
      </Modal>
    </Card>
  )
}
