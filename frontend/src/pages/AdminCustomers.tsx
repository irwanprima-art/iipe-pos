import { useEffect, useState } from 'react'
import { Card, Table, Tag } from 'antd'
import { api, Customer, fmtRp } from '../api'

export default function AdminCustomers() {
  const [rows, setRows] = useState<Customer[]>([])
  useEffect(() => { api.get<Customer[]>('/admin/customers').then(setRows).catch(() => {}) }, [])
  return (
    <Card title="Customer">
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'No. WhatsApp', dataIndex: 'phone', render: (v: string) => <Tag>{v}</Tag> },
          { title: 'Jumlah Order', dataIndex: 'orders' },
          { title: 'Total Belanja (selesai)', dataIndex: 'spent', render: (v: number) => fmtRp(v) },
          { title: 'Terdaftar', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString('id-ID') },
        ]}
      />
    </Card>
  )
}
