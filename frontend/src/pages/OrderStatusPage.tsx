import { useEffect, useState } from 'react'
import { Card, Steps, Descriptions, Table, Button, message, Tag, Typography, Alert, Space, Modal } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import { useParams, Link } from 'react-router-dom'
import { api, Order, fmtRp, STATUS_LABEL } from '../api'

const STEP_ORDER = ['pending_payment', 'paid', 'picked', 'packed', 'ready', 'completed']

export default function OrderStatusPage() {
  const { token } = useParams()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const [busy, setBusy] = useState(false)

  function load() {
    api.get<Order>(`/orders/status/${token}`).then(setOrder).catch((e) => setError(e.message))
  }
  useEffect(load, [token])

  if (error) return <Card style={{ maxWidth: 600, margin: '40px auto' }}><Alert type="error" message={error} showIcon /></Card>
  if (!order) return <Card loading style={{ maxWidth: 600, margin: '40px auto' }} />

  const stepIdx = STEP_ORDER.indexOf(order.status)
  const step = Math.max(0, stepIdx === -1 ? STEP_ORDER.length : stepIdx)
  // QR pickup hanya ditampilkan setelah pembayaran sukses (bukan saat menunggu bayar / dibatalkan)
  const showQR = order.status !== 'pending_payment' && order.status !== 'cancelled'

  async function simulatePay() {
    setPaying(true)
    try {
      await api.post('/webhooks/payment', { provider_ref: order.payment?.provider_ref, status: 'paid' })
      message.success('Pembayaran berhasil (simulasi)')
      load()
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setPaying(false)
    }
  }

  // Cek ulang status pembayaran (backend otomatis membatalkan bila lewat batas waktu)
  async function refreshStatus() {
    setBusy(true)
    try {
      const o = await api.post<Order>(`/orders/status/${token}/refresh`)
      setOrder(o)
      if (o.status === 'cancelled') message.warning('Pembayaran kedaluwarsa — pesanan dibatalkan otomatis')
      else message.success('Status diperiksa — masih menunggu pembayaran')
    } catch (e: any) { message.error(e.message) } finally { setBusy(false) }
  }

  // Batalkan pesanan (hanya yang belum dibayar)
  function confirmCancel() {
    Modal.confirm({
      title: 'Batalkan pesanan?',
      content: `Order ${order.order_no} akan dibatalkan dan stok dilepas kembali.`,
      okText: 'Ya, batalkan',
      okButtonProps: { danger: true },
      cancelText: 'Tidak',
      onOk: async () => {
        setBusy(true)
        try {
          const o = await api.post<Order>(`/orders/status/${token}/cancel`, { reason: 'dibatalkan customer' })
          setOrder(o)
          message.success('Pesanan dibatalkan')
        } catch (e: any) { message.error(e.message) } finally { setBusy(false) }
      },
    })
  }

  // Cek ulang status pembayaran (backend otomatis membatalkan bila lewat batas waktu)
  async function refreshStatus() {
    setBusy(true)
    try {
      const o = await api.post<Order>(`/orders/status/${token}/refresh`)
      setOrder(o)
      if (o.status === 'cancelled') message.warning('Pembayaran kedaluwarsa — pesanan dibatalkan otomatis')
      else message.success('Status diperiksa — masih menunggu pembayaran')
    } catch (e: any) { message.error(e.message) } finally { setBusy(false) }
  }

  // Batalkan pesanan (hanya yang belum dibayar)
  function confirmCancel() {
    Modal.confirm({
      title: 'Batalkan pesanan?',
      content: `Order ${order.order_no} akan dibatalkan dan stok dilepas kembali.`,
      okText: 'Ya, batalkan',
      okButtonProps: { danger: true },
      cancelText: 'Tidak',
      onOk: async () => {
        setBusy(true)
        try {
          const o = await api.post<Order>(`/orders/status/${token}/cancel`, { reason: 'dibatalkan customer' })
          setOrder(o)
          message.success('Pesanan dibatalkan')
        } catch (e: any) { message.error(e.message) } finally { setBusy(false) }
      },
    })
  }

  return (
    <div style={{ maxWidth: 800, margin: '24px auto', padding: '0 16px' }}>
      <Card>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>Order {order.order_no}</Typography.Title>
              <Tag color={order.status === 'completed' ? 'green' : order.status === 'cancelled' ? 'red' : 'blue'}>{STATUS_LABEL[order.status] || order.status}</Tag>
            </div>
            {(order.pickup_no != null) && (
              <Alert type="success" showIcon style={{ fontSize: 18 }}
                message={<span>Nomor Ambil: <b style={{ fontSize: 24 }}>#{String(order.pickup_no).padStart(3, '0')}</b></span>} />
            )}
          </div>

          <Steps
            current={step}
            size="small"
            items={[
              { title: 'Bayar' },
              { title: 'Dipick' },
              { title: 'Dikemas' },
              { title: 'Siap Diambil' },
              { title: 'Selesai' },
            ]}
          />

          {order.status === 'pending_payment' && (
            <Space direction="vertical" style={{ width: '100%' }}>
              {order.payment?.payment_link_url ? (
                <Alert type="info" showIcon message="Menunggu pembayaran. Lanjutkan pembayaran via SumoPay."
                  action={<a href={order.payment.payment_link_url} target="_blank" rel="noreferrer"><Button size="small">Bayar Sekarang</Button></a>} />
              ) : order.payment?.provider_ref?.startsWith('MOCK-') ? (
                <Alert type="warning" showIcon message="Menunggu pembayaran QRIS. (Mode demo: klik tombol di bawah.)"
                  action={<Button size="small" loading={paying} onClick={simulatePay}>Simulasi Bayar</Button>} />
              ) : null}
              <Space wrap>
                <Button size="small" loading={busy} onClick={refreshStatus}>Periksa Status Bayar</Button>
                <Button size="small" danger loading={busy} onClick={confirmCancel}>Batalkan Pesanan</Button>
              </Space>
            </Space>
          )}

          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Nama">{order.customer_name}</Descriptions.Item>
            <Descriptions.Item label="WhatsApp">{order.customer_phone}</Descriptions.Item>
            <Descriptions.Item label="Event">{order.event_name}</Descriptions.Item>
            <Descriptions.Item label="Total">{fmtRp(order.total)}</Descriptions.Item>
            {order.pickup_no != null && <Descriptions.Item label="Nomor Ambil">#{String(order.pickup_no).padStart(3, '0')}</Descriptions.Item>}
          </Descriptions>

          {showQR && (
            <div style={{ textAlign: 'center' }}>
              <Typography.Paragraph type="secondary">Tunjukkan QR ini ke petugas saat mengambil barang</Typography.Paragraph>
              <QRCodeSVG value={order.qr_code} size={200} style={{ margin: '0 auto' }} />
            </div>
          )}

          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={order.items.filter((i) => i.item_type !== 'component')}
            columns={[
              { title: 'Produk', dataIndex: 'name' },
              { title: 'SKU', dataIndex: 'sku' },
              { title: 'Qty', dataIndex: 'qty' },
              { title: 'Harga', dataIndex: 'price', render: (v: number) => fmtRp(v) },
            ]}
          />
          <Button type="link"><Link to="/">Kembali belanja</Link></Button>
        </Space>
      </Card>
    </div>
  )
}
