import { useEffect, useRef, useState } from 'react'
import { Card, Result, Button, Alert, Spin, Space } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useSearchParams, Link } from 'react-router-dom'
import { api, Order, fmtRp, STATUS_LABEL } from '../api'

// Halaman redirect dari SumoPay setelah customer selesai / membatalkan pembayaran.
// SumoPay menambahkan query &order_id=<order_no>&status=<status>; kita juga kirim result.
// Query: ?token=<qr_code>&result=... ATAU ?order_id=<order_no>&result=...&status=...
export default function PaymentResultPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const orderId = params.get('order_id') || ''
  const ref = orderId || token // order_no atau qr_code (keduanya didukung /orders/status/{x})
  const rawResult = params.get('result') || ''
  const status = params.get('status') || ''
  // result default dari status yang dikirim SumoPay (completed/failed/expired/cancelled)
  const result = rawResult || (status === 'completed' ? 'success' : (status === 'cancelled' || status === 'failed' || status === 'expired') ? 'cancelled' : '')
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const attempts = useRef(0)

  function load() {
    if (!ref) { setError('Link pembayaran tidak valid.'); return }
    api.get<Order>(`/orders/status/${ref}`).then(setOrder).catch((e) => setError(e.message))
  }
  useEffect(load, [ref])

  // Jika redirect "success" tapi order masih pending (webhook belum proses), polling sebentar.
  useEffect(() => {
    if (!order || order.status !== 'pending_payment' || result !== 'success') return
    attempts.current = 0
    const t = setInterval(() => {
      attempts.current += 1
      if (attempts.current > 5) { clearInterval(t); return }
      api.get<Order>(`/orders/status/${ref}`).then((o) => { setOrder(o); if (o.status !== 'pending_payment') clearInterval(t) }).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [order, result, ref])

  async function recheck() {
    setChecking(true)
    try {
      const o = await api.get<Order>(`/orders/status/${ref}`)
      setOrder(o)
      setError('')
    } catch (e: any) { setError(e.message) } finally { setChecking(false) }
  }

  if (!ref) return <Card style={{ maxWidth: 560, margin: '48px auto' }}><Result status="warning" title="Link tidak valid" extra={<Link to="/"><Button type="primary">Kembali ke Beranda</Button></Link>} /></Card>
  if (error) return <Card style={{ maxWidth: 560, margin: '48px auto' }}><Result status="error" title="Terjadi Kesalahan" subTitle={error} extra={<Button onClick={recheck} loading={checking}>Coba Lagi</Button>} /></Card>
  if (!order) return <Card loading style={{ maxWidth: 560, margin: '48px auto' }} />

  const isPaid = order.status !== 'pending_payment' && order.status !== 'cancelled'
  const paid = result === 'success' || isPaid

  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px' }}>
      <Card>
        {paid ? (
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            title="Pembayaran Berhasil!"
            subTitle={
              <Space direction="vertical" size={4}>
                <span>Order <b>{order.order_no}</b> — {fmtRp(order.total)}</span>
                <span>Status: <b>{STATUS_LABEL[order.status] || order.status}</b></span>
              </Space>
            }
            extra={
              <Space wrap>
                <Link to={`/status/${ref}`}><Button type="primary">Lihat Status Order</Button></Link>
                <Link to="/"><Button>Kembali Belanja</Button></Link>
              </Space>
            }
          />
        ) : result === 'cancelled' ? (
          <Result
            status="info"
            icon={<CloseCircleOutlined style={{ color: '#faad14' }} />}
            title="Pembayaran Dibatalkan"
            subTitle={`Order ${order.order_no} masih menunggu pembayaran. Anda bisa membayar lagi kapan saja.`}
            extra={
              <Space wrap>
                <Link to={`/status/${ref}`}><Button type="primary">Bayar / Lihat Order</Button></Link>
                <Link to="/"><Button>Kembali Belanja</Button></Link>
              </Space>
            }
          />
        ) : (
          <Result
            status="info"
            icon={<ClockCircleOutlined style={{ color: '#1677ff' }} />}
            title="Menunggu Konfirmasi Pembayaran"
            subTitle={`Order ${order.order_no} — ${fmtRp(order.total)}. Kami sedang menunggu konfirmasi dari penyedia pembayaran.`}
            extra={<Button type="primary" onClick={recheck} loading={checking}>Periksa Status</Button>}
          />
        )}

        {order.status === 'pending_payment' && result === 'success' && (
          <Alert type="warning" showIcon style={{ marginTop: 8 }}
            message="Konfirmasi pembayaran sedang diproses. Halaman ini akan memeriksa ulang secara otomatis." />
        )}
        {order.status === 'cancelled' && (
          <Alert type="error" showIcon style={{ marginTop: 8 }} message="Order ini telah dibatalkan. Hubungi admin bila ada kendala." />
        )}
      </Card>
    </div>
  )
}
