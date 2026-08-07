import { useEffect, useState } from 'react'
import { Card, Table, Select, Button, Modal, Input, Space, message, Tag, Drawer } from 'antd'
import { api, num, currentUser, EventProduct, Event, StockMovement } from '../api'

// Hanya admin yang boleh mengubah stok (terima barang / sesuaikan); staff lain hanya lihat + log.
const isAdmin = currentUser()?.role === 'admin'

const TYPE_META: Record<string, { label: string; color: string }> = {
  IN: { label: 'Terima Barang', color: 'green' },
  ADJUST: { label: 'Sesuaikan', color: 'orange' },
  RESERVE: { label: 'Reservasi', color: 'blue' },
  UNRESERVE: { label: 'Batal Reservasi', color: 'cyan' },
  PICK: { label: 'Diambil', color: 'purple' },
  RETURN: { label: 'Retur', color: 'magenta' },
}

function fmtQty(m: StockMovement) {
  const plus = m.type === 'IN' || m.type === 'UNRESERVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && m.qty > 0)
  return `${plus ? '+' : ''}${m.qty}`
}

function fmtTime(t: string) {
  return new Date(t).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AdminStock() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<number>(0)
  const [rows, setRows] = useState<EventProduct[]>([])
  const [editing, setEditing] = useState<EventProduct | null>(null)
  const [newTotal, setNewTotal] = useState(0)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  // inbound (terima barang)
  const [inboundTarget, setInboundTarget] = useState<EventProduct | null>(null)
  const [inQty, setInQty] = useState(0)
  const [inReason, setInReason] = useState('')
  // inventory log
  const [logOpen, setLogOpen] = useState(false)
  const [logRows, setLogRows] = useState<StockMovement[]>([])
  const [logProduct, setLogProduct] = useState<EventProduct | null>(null)
  const [logLoading, setLogLoading] = useState(false)

  useEffect(() => {
    api.get<Event[]>('/admin/events').then((evs) => { setEvents(evs); if (evs.length) setEventId(evs[0].id) })
  }, [])

  function load() {
    if (!eventId) return
    api.get<EventProduct[]>(`/admin/events/${eventId}/products`).then(setRows).catch((e) => message.error(e.message))
  }
  useEffect(load, [eventId])

  function loadLog(product?: EventProduct | null) {
    if (!eventId) return
    setLogLoading(true)
    const q = product ? `&product_id=${product.product_id}` : ''
    api.get<StockMovement[]>(`/admin/stock/movements?event_id=${eventId}${q}`).then(setLogRows).catch((e) => message.error(e.message)).finally(() => setLogLoading(false))
  }

  async function doAdjust() {
    if (!editing) return
    setSaving(true)
    try {
      await api.post(`/admin/events/${eventId}/products/${editing.product_id}/stock`, { stock_total: num(newTotal), reason })
      message.success('Stok disesuaikan')
      setEditing(null)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  async function doInbound() {
    if (!inboundTarget) return
    setSaving(true)
    try {
      await api.post(`/admin/events/${eventId}/products/${inboundTarget.product_id}/inbound`, { qty: num(inQty), reason: inReason })
      message.success('Barang diterima')
      setInboundTarget(null)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Card title="Manajemen Stok" extra={
      <Space wrap>
        <Button size="small" onClick={() => { setLogProduct(null); setLogOpen(true); loadLog() }}>Log Stok</Button>
        <Select style={{ width: 260 }} value={eventId || undefined} onChange={setEventId}
          options={events.map((e) => ({ value: e.id, label: e.name }))} />
      </Space>
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
              <Space wrap>
                {isAdmin && (
                  <>
                    <Button size="small" type="primary" disabled={r.product?.is_bundle} onClick={() => { setInboundTarget(r); setInQty(0); setInReason('') }}>Terima Barang</Button>
                    <Button size="small" disabled={r.product?.is_bundle} onClick={() => { setEditing(r); setNewTotal(r.stock_total); setReason('') }}>Sesuaikan</Button>
                  </>
                )}
                <Button size="small" onClick={() => { setLogProduct(r); setLogOpen(true); loadLog(r) }}>Log</Button>
              </Space>
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

      <Modal
        title={`Terima Barang — ${inboundTarget?.product?.name || ''}`}
        open={!!inboundTarget} onCancel={() => setInboundTarget(null)} onOk={doInbound} confirmLoading={saving}
        okText="Terima"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input type="number" min={1} value={inQty} onChange={(e) => setInQty(Number(e.target.value))} addonBefore="Jumlah masuk" />
          <Input placeholder="Sumber / alasan (wajib), mis. terima dari supplier" value={inReason} onChange={(e) => setInReason(e.target.value)} />
        </Space>
      </Modal>

      <Drawer
        title={logProduct ? `Log Stok — ${logProduct.product?.name || ''}` : 'Inventory Log'}
        width={860}
        open={logOpen}
        onClose={() => { setLogOpen(false); setLogProduct(null) }}
        extra={
          <Button size="small" onClick={() => { setLogProduct(null); loadLog() }}>Semua Produk</Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={logLoading}
          dataSource={logRows}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: 'Waktu', dataIndex: 'created_at', width: 150, render: fmtTime },
            { title: 'SKU', dataIndex: 'sku', width: 110 },
            { title: 'Produk', dataIndex: 'product', ellipsis: true },
            { title: 'Tipe', dataIndex: 'type', width: 140, render: (t: string) => <Tag color={TYPE_META[t]?.color || 'default'}>{TYPE_META[t]?.label || t}</Tag> },
            { title: 'Qty', dataIndex: 'qty', width: 80, render: (_: number, m: StockMovement) => <b>{fmtQty(m)}</b> },
            { title: 'Oleh', dataIndex: 'actor', width: 160, ellipsis: true, render: (v: string) => v || '-' },
            { title: 'No. Order', dataIndex: 'ref_no', width: 130, render: (v: string) => v || '-' },
            { title: 'Alasan', dataIndex: 'reason', ellipsis: true, render: (_: string, m: StockMovement) => m.reason || (m.ref_type ? `${m.ref_type} #${m.ref_id || 0}` : '-') },
          ]}
        />
      </Drawer>
    </Card>
  )
}
