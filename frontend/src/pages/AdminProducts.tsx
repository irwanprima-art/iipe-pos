import { useEffect, useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, InputNumber, Tag, Space, message, Typography, Upload } from 'antd'
import { ShopOutlined, UploadOutlined } from '@ant-design/icons'
import { api, Product, token } from '../api'

export default function AdminProducts() {
  const [rows, setRows] = useState<Product[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [activeAffiliate, setActiveAffiliate] = useState('')

  function load() { api.get<Product[]>('/admin/products').then(setRows).catch((e) => message.error(e.message)) }
  useEffect(load, [])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    setActiveAffiliate('')
    setOpen(true)
  }
  function openEdit(p: Product) {
    setEditing(p)
    form.setFieldsValue({
      sku: p.sku, name: p.name, category: p.category, description: p.description,
      barcode_pcs: p.barcode_pcs, barcode_carton: p.barcode_carton, qty_per_carton: p.qty_per_carton,
      marketplace_link: p.marketplace_link, images: (p.images || []).join('\n'),
    })
    setActiveAffiliate(p.affiliate_link || '')
    setOpen(true)
  }

  async function onOk() {
    const v = await form.validateFields()
    const payload = {
      ...v,
      images: (v.images || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
      qty_per_carton: v.qty_per_carton || 1,
    }
    setSaving(true)
    try {
      if (editing) await api.patch(`/admin/products/${editing.id}`, payload)
      else await api.post('/admin/products', payload)
      message.success('Produk tersimpan')
      setOpen(false)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Card
      title="Produk"
      extra={<Button type="primary" onClick={openCreate}>+ Produk</Button>}
    >
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: 'SKU', dataIndex: 'sku' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Kategori', dataIndex: 'category' },
          { title: 'Barcode PCS', dataIndex: 'barcode_pcs' },
          { title: 'Barcode Carton', dataIndex: 'barcode_carton' },
          { title: 'Qty/Carton', dataIndex: 'qty_per_carton' },
          { title: 'Tipe', dataIndex: 'is_bundle', render: (b: boolean) => (b ? <Tag color="gold">Bundle</Tag> : <Tag>Produk</Tag>) },
          {
            title: 'Shopee', dataIndex: 'marketplace_link',
            render: (v: string, p: Product) => v ? (
              <a href={p.affiliate_link || v} target="_blank" rel="noreferrer"><ShopOutlined /> Link</a>
            ) : <Tag>—</Tag>,
          },
          {
            title: 'Aksi', render: (_: any, p: Product) => (
              <Button size="small" onClick={() => openEdit(p)}>Edit</Button>
            ),
          },
        ]}
      />
      <Modal title={editing ? 'Edit Produk' : 'Tambah Produk'} open={open} onCancel={() => setOpen(false)} onOk={onOk} confirmLoading={saving} width={640}>
        <Form form={form} layout="vertical">
          <Space style={{ width: '100%' }} wrap>
            <Form.Item name="sku" label="SKU" rules={[{ required: true }]} style={{ width: 190 }}>
              <Input disabled={!!editing} />
            </Form.Item>
            <Form.Item name="name" label="Nama" rules={[{ required: true }]} style={{ width: 300 }}>
              <Input />
            </Form.Item>
            <Form.Item name="category" label="Kategori" style={{ width: 130 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Deskripsi">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="barcode_pcs" label="Barcode PCS"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="barcode_carton" label="Barcode Carton"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="qty_per_carton" label="Qty / Carton"><InputNumber min={1} /></Form.Item>
          </Space>
          <Form.Item name="marketplace_link" label="Link Shopee (opsional)">
            <Input placeholder="https://shopee.co.id/product/..." />
          </Form.Item>
          {activeAffiliate && (
            <Typography.Paragraph style={{ marginBottom: 16 }} type="secondary" copyable>
              Link affiliate aktif: {activeAffiliate}
            </Typography.Paragraph>
          )}
          <Form.Item name="images" label="Gambar (satu URL per baris)">
            <Input.TextArea rows={3} placeholder="https://...\nhttps://..." />
          </Form.Item>
          <Space style={{ marginBottom: 16 }}>
            <Upload
              accept="image/*"
              showUploadList={false}
              customRequest={async ({ file, onSuccess, onError }) => {
                const fd = new FormData()
                fd.append('file', file as any)
                try {
                  const res = await fetch('/api/v1/admin/uploads', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token() },
                    body: fd,
                  })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error || 'upload gagal')
                  const cur = form.getFieldValue('images') || ''
                  form.setFieldValue('images', cur ? cur + '\n' + data.url : data.url)
                  message.success('Gambar terupload')
                  onSuccess?.(data)
                } catch (e: any) {
                  message.error(e.message)
                  onError?.(e)
                }
              }}
            >
              <Button icon={<UploadOutlined />}>Upload Gambar (S3)</Button>
            </Upload>
          </Space>
        </Form>
      </Modal>
    </Card>
  )
}
