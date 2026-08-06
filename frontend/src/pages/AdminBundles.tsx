import { useEffect, useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Space, Tag, message } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { api, Product } from '../api'

export default function AdminBundles() {
  const [rows, setRows] = useState<Product[]>([])
  const [productOpts, setProductOpts] = useState<{ value: number; label: string }[]>([])
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  function load() {
    api.get<Product[]>('/admin/products').then((ps) => {
      setRows(ps.filter((p) => p.is_bundle))
      setProductOpts(ps.filter((p) => !p.is_bundle).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })))
    }).catch((e) => message.error(e.message))
  }
  useEffect(load, [])

  async function onOk() {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api.post('/admin/bundles', {
        sku: v.sku, name: v.name, barcode_pcs: v.barcode_pcs, category: v.category,
        images: (v.images || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
        components: (v.components || []).map((c: any) => ({ product_id: c.product_id, qty: c.qty || 1 })),
      })
      message.success('Bundle dibuat')
      setOpen(false)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Card title="Bundle" extra={<Button type="primary" onClick={() => { form.resetFields(); setOpen(true) }}>+ Bundle</Button>}>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'SKU', dataIndex: 'sku' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Barcode', dataIndex: 'barcode_pcs' },
          {
            title: 'Komponen (SKU × qty)', render: (_: any, p: Product) => (
              <Space direction="vertical" size={2}>
                {p.components?.map((c) => (
                  <Tag key={c.product_id} style={{ textAlign: 'left' }}>{c.sku} — {c.name} ×{c.qty}</Tag>
                ))}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Buat Bundle" open={open} onCancel={() => setOpen(false)} onOk={onOk} confirmLoading={saving} width={640}>
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="sku" label="SKU Bundle" rules={[{ required: true }]} style={{ width: 190 }}><Input /></Form.Item>
            <Form.Item name="name" label="Nama Bundle" rules={[{ required: true }]} style={{ width: 300 }}><Input /></Form.Item>
            <Form.Item name="barcode_pcs" label="Barcode"><Input style={{ width: 130 }} /></Form.Item>
            <Form.Item name="category" label="Kategori"><Input style={{ width: 130 }} /></Form.Item>
          </Space>
          <Form.Item name="images" label="Gambar (satu URL per baris)">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="Komponen Penyusun (bundle dipecah jadi SKU ini saat fulfillment)" required>
            <Form.List name="components">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex' }}>
                      <Form.Item {...rest} name={[name, 'product_id']} rules={[{ required: true, message: 'Pilih produk' }]}>
                        <Select style={{ width: 360 }} showSearch optionFilterProp="label" placeholder="Pilih produk komponen" options={productOpts} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'qty']} initialValue={1}>
                        <Input type="number" style={{ width: 70 }} min={1} addonBefore="x" />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} />
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>Tambah komponen</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
