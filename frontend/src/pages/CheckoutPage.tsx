import { useState } from 'react'
import { Card, Form, Input, Button, Space, Typography, message, Descriptions, Divider, Alert } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { loadCart, clearCart, fmtRp, api, Order, setCustomerToken, isValidWaPhone } from '../api'

export default function CheckoutPage() {
  const nav = useNavigate()
  const cart = loadCart()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(false)

  if (!order && (!cart || cart.lines.length === 0)) {
    return <Card style={{ maxWidth: 600, margin: '40px auto' }}><Typography.Paragraph>Keranjang kosong.</Typography.Paragraph><Button type="primary" onClick={() => nav('/')}>Belanja</Button></Card>
  }

  async function onFinish(v: any) {
    setLoading(true)
    try {
      const items = cart.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, item_type: l.item_type }))
      const o = await api.post<Order & { customer_token?: string }>('/checkout', {
        event_id: cart.event_id, items,
        customer_name: v.name, customer_phone: v.phone,
      })
      if (o.customer_token) setCustomerToken(o.customer_token)
      setOrder(o)
      clearCart()
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!order) {
    return (
      <Card title="Checkout" style={{ maxWidth: 600, margin: '24px auto' }}>
        <Typography.Paragraph>Total: <b>{fmtRp(cart.lines.reduce((s, l) => s + l.price * l.qty, 0))}</b></Typography.Paragraph>
        <Divider />
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="name" label="Nama Lengkap" rules={[{ required: true, message: 'Nama wajib diisi' }]}>
            <Input placeholder="Nama sesuai KTP" />
          </Form.Item>
          <Form.Item name="phone" label="Nomor WhatsApp (untuk notifikasi & login)" rules={[{ required: true, message: 'Nomor WA wajib diisi' }, {
            validator: (_, val) => (!val || isValidWaPhone(val) ? Promise.resolve() : Promise.reject(new Error('Nomor WhatsApp tidak valid (08xx / 62xx, 10-15 digit)'))),
          }]}>
            <Input placeholder="08xxxxxxxxxx" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>Bayar dengan QRIS</Button>
        </Form>
      </Card>
    )
  }

  return <PaymentStep order={order} onDone={() => nav(`/status/${order.qr_code}`)} />
}

function PaymentStep({ order, onDone }: { order: Order; onDone: () => void }) {
  const pay = order.payment
  const isMock = !!(pay?.provider_ref && pay.provider_ref.startsWith('MOCK-'))
  const [paying, setPaying] = useState(false)
  async function simulatePay() {
    setPaying(true)
    try {
      await api.post('/webhooks/payment', { provider_ref: pay?.provider_ref, status: 'paid' })
      message.success('Pembayaran berhasil (simulasi)')
      onDone()
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setPaying(false)
    }
  }
  return (
    <Card title="Pembayaran" style={{ maxWidth: 600, margin: '24px auto', textAlign: 'center' }}>
      {!order.online_payment ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert type="success" showIcon message="Pesanan Diterima!"
            description="Pembayaran online dimatikan untuk event ini. Silakan lakukan pembayaran di kasir — tunjukkan QR di bawah ini." />
          <QRCodeSVG value={order.qr_code} size={220} style={{ margin: '0 auto' }} />
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="No. Order">{order.order_no}</Descriptions.Item>
            <Descriptions.Item label="Total">{fmtRp(order.total)}</Descriptions.Item>
          </Descriptions>
          <Space style={{ justifyContent: 'center' }}>
            <Button type="primary" onClick={onDone}>Cek Status</Button>
          </Space>
        </Space>
      ) : pay?.payment_link_url ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert type="info" showIcon message="Pembayaran via SumoPay (QRIS)"
            description="Klik tombol di bawah untuk membuka halaman pembayaran. Status order ter-update otomatis." />
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="No. Order">{order.order_no}</Descriptions.Item>
            <Descriptions.Item label="Total">{fmtRp(order.total)}</Descriptions.Item>
          </Descriptions>
          <Space style={{ justifyContent: 'center' }}>
            <a href={pay.payment_link_url} target="_blank" rel="noreferrer">
              <Button type="primary" size="large">Bayar Sekarang</Button>
            </a>
            <Button onClick={onDone}>Cek Status</Button>
          </Space>
        </Space>
      ) : (
        <>
          <Typography.Paragraph type="secondary">
            Scan QR di bawah ini dengan aplikasi pembayaran (QRIS).
            {isMock && <b> Mode demo: gunakan tombol Simulasi Bayar.</b>}
          </Typography.Paragraph>
          <QRCodeSVG value={pay?.provider_ref || order.order_no} size={220} style={{ margin: '0 auto' }} />
          <Descriptions column={1} style={{ marginTop: 16 }} bordered size="small">
            <Descriptions.Item label="No. Order">{order.order_no}</Descriptions.Item>
            <Descriptions.Item label="Total">{fmtRp(order.total)}</Descriptions.Item>
            <Descriptions.Item label="Referensi">{pay?.provider_ref}</Descriptions.Item>
          </Descriptions>
          <Space style={{ marginTop: 16 }}>
            {isMock && <Button type="primary" loading={paying} onClick={simulatePay}>Simulasi Bayar (QRIS)</Button>}
            <Button onClick={onDone}>Cek Status</Button>
          </Space>
        </>
      )}
    </Card>
  )
}
