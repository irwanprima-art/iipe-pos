import { useEffect, useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../api'

interface UserRow { id: number; email: string; name: string; role: string; created_at: string }

const roleLabels: Record<string, string> = {
  admin: 'Admin', cashier: 'Kasir', picker: 'Picker', packer: 'Packer', operator: 'Operator',
}
const roleOpts = Object.keys(roleLabels).map((r) => ({ value: r, label: roleLabels[r] }))

export default function AdminUsers() {
  const [rows, setRows] = useState<UserRow[]>([])
  const [openCreate, setOpenCreate] = useState(false)
  const [openEdit, setOpenEdit] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [formCreate] = Form.useForm()
  const [formEdit] = Form.useForm()
  const [saving, setSaving] = useState(false)

  function load() { api.get<UserRow[]>('/admin/users').then(setRows).catch((e) => message.error(e.message)) }
  useEffect(load, [])

  async function onCreate() {
    const v = await formCreate.validateFields()
    setSaving(true)
    try {
      await api.post('/admin/users', { email: v.email, name: v.name, role: v.role, password: v.password })
      message.success('User dibuat')
      setOpenCreate(false)
      formCreate.resetFields()
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  async function onEdit() {
    const v = await formEdit.validateFields()
    setSaving(true)
    try {
      await api.patch(`/admin/users/${editing!.id}`, { name: v.name, role: v.role, password: v.password || undefined })
      message.success('User diperbarui')
      setOpenEdit(false)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(false) }
  }

  async function onDelete(u: UserRow) {
    try {
      await api.del(`/admin/users/${u.id}`)
      message.success('User dihapus')
      load()
    } catch (e: any) { message.error(e.message) }
  }

  return (
    <Card
      title="Staff & User"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { formCreate.resetFields(); setOpenCreate(true) }}>+ User</Button>}
    >
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Role', dataIndex: 'role', render: (r: string) => <Tag color={r === 'admin' ? 'red' : 'blue'}>{roleLabels[r] || r}</Tag> },
          { title: 'Dibuat', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString('id-ID') },
          {
            title: 'Aksi', render: (_: any, u: UserRow) => (
              <Space>
                <Button size="small" onClick={() => { setEditing(u); formEdit.setFieldsValue({ name: u.name, role: u.role, password: '' }); setOpenEdit(true) }}>Edit / Reset</Button>
                <Popconfirm title={`Hapus ${u.name}?`} onConfirm={() => onDelete(u)}>
                  <Button size="small" danger>Hapus</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal title="Tambah User" open={openCreate} onCancel={() => setOpenCreate(false)} onOk={onCreate} confirmLoading={saving}>
        <Form form={formCreate} layout="vertical">
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]} initialValue="cashier">
            <Select options={roleOpts} />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]} extra="Minimal 6 karakter">
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`Edit / Reset — ${editing?.name || ''}`} open={openEdit} onCancel={() => setOpenEdit(false)} onOk={onEdit} confirmLoading={saving}>
        <Form form={formEdit} layout="vertical">
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={roleOpts} />
          </Form.Item>
          <Form.Item name="password" label="Password Baru (kosongkan jika tidak diganti)" rules={[{ min: 6 }]}>
            <Input.Password placeholder="Kosongkan jika tidak diganti" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
