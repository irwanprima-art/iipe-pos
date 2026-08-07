import { useEffect, useState } from 'react'
import { Card, Table, Button, Input, Space, Typography, message, Alert, Tag, Empty } from 'antd'
import { Link } from 'react-router-dom'
import { api, apiCust, Order, STATUS_LABEL, fmtRp, customerToken, setCustomerToken, clearCustomerToken, isValidWaPhone, normalizePhone } from '../api'

// Halaman customer: login via WA+OTP lalu melihat daftar pesanan sendiri.
export default function MyOrders() {
  const [tok, setTok] = useState(customerToken())
  const [orders, setOrders] = useState<Order[]>([])
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  function load() {
    if (!tok) { setOrders([]); setLoadError(''); return }
    setLoading(true); setLoadError('')
    apiCust.get<Order[]>('/customer/orders').then(setOrders).catch((e) => setLoadError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [tok])

  async function sendOtp() {
    if (!isValidWaPhone(phone)) { message.warning('Nomor WhatsApp tidak valid (08xx / 62xx, 10-15 digit)'); return }
    setLoading(true)
    try {
      const r = await api.post<{ ok: boolean; dev_otp?: string }>('/auth/customer/otp', { phone })
      setDevOtp(r.dev_otp || '')
      setStep('otp')
      message.success(r.dev_otp ? 'Kode OTP (mode dev) tersedia di bawah' : 'Kode OTP terkirim ke WhatsApp Anda')
    } catch (e: any) { message.error(e.message) } finally { setLoading(false) }
  }

  async function verify() {
    setLoading(true)
    try {
      const r = await api.post<{ token: string; name: string }>('/auth/customer/otp/verify', { phone, otp })
      setCustomerToken(r.token)
      setTok(r.token)
      setStep('phone')
      setOtp(''); setDevOtp('')
      message.success(`Selamat datang, ${r.name || 'customer'}!`)
    } catch (e: any) { message.error(e.message) } finally { setLoading(false) }
  }

  return (
    <div style={{ maxWidth: 820, margin: '24px auto', padding: '0 16px' }}>
      <Card title="Pesanan Saya">
        {!tok ? (
          step === 'phone' ? (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Typography.Paragraph type="secondary">
                Masukkan nomor WhatsApp untuk melihat pesanan Anda. Kode OTP akan dikirim ke WhatsApp.
              </Typography.Paragraph>
              <Space wrap>
                <Input placeholder="Nomor WA, mis. 0812xxxx" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: 260 }} />
                <Button type="primary" loading={loading} onClick={sendOtp}>Kirim OTP</Button>
              </Space>
            </Space>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Alert type="info" showIcon message={`Kode OTP dikirim ke ${normalizePhone(phone)}`} />
              {devOtp && <Alert type="warning" showIcon message={`Mode dev (WhatsApp belum terhubung): kode OTP Anda = ${devOtp}`} />}
              <Space wrap>
                <Input placeholder="Kode OTP 6 digit" value={otp} onChange={(e) => setOtp(e.target.value)} style={{ width: 180 }} />
                <Button type="primary" loading={loading} onClick={verify}>Verifikasi</Button>
                <Button onClick={() => setStep('phone')}>Ubah nomor</Button>
              </Space>
            </Space>
          )
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Typography.Text type="secondary">Login sebagai customer via WhatsApp</Typography.Text>
              <Button size="small" onClick={() => { clearCustomerToken(); setTok(''); setOrders([]); setLoadError('') }}>Keluar</Button>
            </div>
            {loadError && <Alert type="error" showIcon message="Gagal memuat pesanan" description={loadError} />}
            {orders.length === 0 && !loading ? (
              <Empty description="Belum ada pesanan" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Link to="/"><Button type="primary">Mulai Belanja</Button></Link>
              </Empty>
            ) : (
              <Table
                rowKey="id"
                loading={loading}
                dataSource={orders}
                pagination={false}
                columns={[
                  { title: 'No. Order', dataIndex: 'order_no' },
                  { title: 'Tanggal', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString('id-ID') },
                  { title: 'Total', dataIndex: 'total', render: (v: number) => fmtRp(v) },
                  { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'completed' ? 'green' : s === 'cancelled' ? 'red' : 'blue'}>{STATUS_LABEL[s] || s}</Tag> },
                  { title: 'Nomor Ambil', dataIndex: 'pickup_no', render: (v?: number) => v ? `#${String(v).padStart(3, '0')}` : '-' },
                  { title: '', render: (_: any, o: Order) => <Link to={`/status/${o.qr_code}`}>Lihat</Link> },
                ]}
              />
            )}
          </Space>
        )}
      </Card>
    </div>
  )
}
