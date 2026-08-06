import { useEffect, useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Switch, Space, Tag, message, Drawer, Select } from 'antd'
import { api, Event, EventProduct, Product, fmtRp } from '../api'

export default function AdminEvents() {
  const [rows, setRows] = useState<Event[]>([])
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [productOpts, setProductOpts] = useState<{ value: number; label: string }[]>([])

  const [drawerEvent, setDrawerEvent] = useState<Event | null>(null)
  const [catalog, setCatalog] = useState<EventProduct[]>([])
  const [addForm] = Form.useForm()
  const [adjusting, setAdjusting] = useState<EventProduct | null>(null)
  const [adjustTotal, setAdjustTotal] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')

  function load() {
    api.get<Event[]>('/admin/events').then(setRows).catch((e) => message.error(e.message))
    api.get<Product[]>('/admin/products').then((ps) =>
      setProductOpts(ps.filter((p) => !p.is_bundle).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })))
    ).catch(() => {})
  }
  useEffect(load, [])

  function openDrawer(ev: Event) {
    setDrawerEvent(ev)
    api.get<EventProduct[]>(`/admin/events/${ev.id}/products`).then(setCatalog).catch((e) => message.error(e.message))
  }

  async function createEvent() {
    const v = await form.validateFields()
    try {
      await api.post('/admin/events', { code: v.code, name: v.name, location: v.location, is_active: true })
      message.success('Event dibuat')
      setOpen(false)
      load()
    } catch (e: any) { message.error(e.message) }
  }

  async function addProduct() {
    if (!drawerEvent) return
    const v = await addForm.validateFields()
    try {
      await api.post(`/admin/events/${drawerEvent.id}/products`, { product_id: v.product_id, price: v.price, stock_total: v.stock_total || 0, is_active: true })
      message.success('Produk ditambahkan ke event')
      addForm.resetFields()
      openDrawer(drawerEvent)
    } catch (e: any) { message.error(e.message) }
  }

  async function doAdjust() {
    if (!drawerEvent || !adjusting) return
    try {
      await api.post(`/admin/events/${drawerEvent.id}/products/${adjusting.product_id}/stock`, { stock_total: adjustTotal, reason: adjustReason })
      message.success('Stok disesuaikan')
      setAdjusting(null)
      openDrawer(drawerEvent)
    } catch (e: any) { message.error(e.message) }
  }

  async function toggleActive(ev: Event) {
    try {
      await api.patch(`/admin/events/${ev.id}`, { is_active: !ev.is_active })
      load()
    } catch (e: any) { message.error(e.message) }
  }

  return (
    <Card title="Event Bazaar" extra={<Button type="primary" onClick={() => { form.resetFields(); setOpen(true) }}>+ Event</Button>}>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Lokasi', dataIndex: 'location' },
          { title: 'Aktif', dataIndex: 'is_active', render: (v: boolean) => <Switch size="small" checked={v} onChange={() => {}} onClick={() => {}} /> },
          {
            title: 'Aksi', render: (_: any, ev: Event) => (
              <Space>
                <Button size="small" type="primary" onClick={() => openDrawer(ev)}>Katalog & Stok</Button>
                <Button size="small" onClick={() => toggleActive(ev)}>{ev.is_active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal title="Tambah Event" open={open} onCancel={() => setOpen(false)} onOk={createEvent}>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Kode" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="location" label="Lokasi"><Input /></Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`Katalog & Stok — ${drawerEvent?.name || ''}`}
        width={720}
        open={!!drawerEvent}
        onClose={() => setDrawerEvent(null)}
      >
        <Card size="small" title="Tambah Produk ke Event" style={{ marginBottom: 16 }}>
          <Form form={addForm} layout="inline">
            <Form.Item name="product_id" rules={[{ required: true }]}>
              <Select style={{ width: 320 }} showSearch optionFilterProp="label" placeholder="Produk" options={productOpts} />
            </Form.Item>
            <Form.Item name="price" rules={[{ required: true, message: 'Harga' }]}>
              <Input type="number" placeholder="Harga (Rp)" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="stock_total">
              <Input type="number" placeholder="Stok" style={{ width: 90 }} />
            </Form.Item>
            <Button type="primary" onClick={addProduct}>Tambah</Button>
          </Form>
        </Card>
        <Table
          rowKey="product_id"
          size="small"
          dataSource={catalog}
          pagination={false}
          columns={[
            { title: 'SKU', dataIndex: ['product', 'sku'] },
            { title: 'Nama', dataIndex: ['product', 'name'] },
            { title: 'Harga', dataIndex: 'price', render: (v: number) => fmtRp(v) },
            { title: 'Stok', dataIndex: 'stock_total' },
            { title: 'Tersedia', dataIndex: 'available', render: (v: number) => <Tag color={v > 0 ? 'green' : 'red'}>{v}</Tag> },
            {
              title: '', render: (_: any, ep: EventProduct) => (
                <Button size="small" disabled={ep.product?.is_bundle} onClick={() => { setAdjusting(ep); setAdjustTotal(ep.stock_total); setAdjustReason('') }}>
                  Sesuaikan Stok
                </Button>
              ),
            },
          ]}
        />
      </Drawer>

      <Modal title={`Sesuaikan Stok — ${adjusting?.product?.name || ''}`} open={!!adjusting} onCancel={() => setAdjusting(null)} onOk={doAdjust}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input type="number" value={adjustTotal} onChange={(e) => setAdjustTotal(Number(e.target.value))} addonBefore="Stok baru" />
          <Input placeholder="Alasan (wajib)" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
        </Space>
      </Modal>
    </Card>
  )
}
