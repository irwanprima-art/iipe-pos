import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Button, message, Alert, Space } from 'antd'
import { api, fmtRp } from '../api'

interface Dashboard {
  today_sales: number; order_count: number; active_orders: number; ready_orders: number
  completed_orders: number; revenue_by_method: Record<string, number>; products_low_stock: number
}

export default function AdminDashboard() {
  const [d, setD] = useState<Dashboard | null>(null)
  function load() { api.get<Dashboard>('/admin/dashboard').then(setD).catch((e) => message.error(e.message)) }
  useEffect(load, [])

  async function seed() {
    try {
      await api.post('/admin/seed')
      message.success('Seed data berhasil dibuat')
      load()
    } catch (e: any) { message.error(e.message) }
  }

  return (
    <div>
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="Mode demo (MOCK_PAYMENTS=true). Jalankan Seed untuk membuat data contoh (admin@iipe.dev / admin123)."
        action={<Button size="small" onClick={seed}>Jalankan Seed</Button>}
      />
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Card><Statistic title="Penjualan Hari Ini" value={d?.today_sales || 0} formatter={(v) => fmtRp(Number(v))} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Total Order" value={d?.order_count || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Order Aktif" value={d?.active_orders || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Siap Diambil" value={d?.ready_orders || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Selesai" value={d?.completed_orders || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Produk Stok Menipis" value={d?.products_low_stock || 0} /></Card></Col>
        <Col xs={24} md={12}>
          <Card title="Pendapatan per Metode">
            {d && Object.entries(d.revenue_by_method || {}).map(([k, v]) => (
              <Space key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <b>{k || '-'}</b><span>{fmtRp(v)}</span>
              </Space>
            ))}
            {d && Object.keys(d.revenue_by_method || {}).length === 0 && <Alert type="info" message="Belum ada penjualan selesai" />}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
