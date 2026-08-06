import { useEffect, useState } from 'react'
import { Card, Table, InputNumber, Button, Space, Typography, message, Empty, Row, Col } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { loadCart, saveCart, fmtRp, Cart, EventProduct, api } from '../api'

export default function CartPage() {
  const nav = useNavigate()
  const [cart, setCart] = useState<Cart | null>(loadCart())

  function update(line: any, qty: number) {
    if (!cart) return
    if (qty < 1) return
    if (qty > line.available) { message.warning('Melebihi stok tersedia'); return }
    line.qty = qty
    saveCart(cart)
    setCart({ ...cart })
  }

  function remove(line: any) {
    if (!cart) return
    cart.lines = cart.lines.filter((l) => l !== line)
    saveCart(cart)
    setCart({ ...cart })
  }

  const total = cart?.lines.reduce((s, l) => s + l.price * l.qty, 0) || 0

  const [sugg, setSugg] = useState<EventProduct[]>([])
  useEffect(() => {
    if (!cart || cart.lines.length === 0) { setSugg([]); return }
    const first = cart.lines[0]
    api.get<EventProduct[]>(`/store/products/${first.product_id}/suggestions?event_id=${cart.event_id}&limit=3`)
      .then(setSugg).catch(() => {})
  }, [cart])

  function addSugg(s: EventProduct) {
    if (!cart) return
    const found = cart.lines.find((l) => l.product_id === s.product_id)
    if (found) {
      if (found.qty + 1 > s.available) { message.warning('Melebihi stok'); return }
      found.qty += 1
    } else {
      if (s.available < 1) { message.warning('Stok habis'); return }
      cart.lines.push({ product_id: s.product_id, name: s.product!.name, price: s.price, qty: 1, item_type: s.product!.is_bundle ? 'bundle' : 'product', available: s.available })
    }
    saveCart(cart)
    setCart({ ...cart })
    message.success('Ditambahkan ke keranjang')
  }

  if (!cart || cart.lines.length === 0) {
    return <Card style={{ maxWidth: 800, margin: '40px auto' }}><Empty description="Keranjang kosong"><Button type="primary" onClick={() => nav('/')}>Belanja</Button></Empty></Card>
  }

  return (
    <Card title="Keranjang Belanja" style={{ maxWidth: 800, margin: '24px auto' }}>
      <Table
        rowKey="product_id"
        pagination={false}
        dataSource={cart.lines}
        columns={[
          { title: 'Produk', dataIndex: 'name' },
          { title: 'Harga', dataIndex: 'price', render: (v: number) => fmtRp(v) },
          {
            title: 'Qty', dataIndex: 'qty',
            render: (v: number, line: any) => <InputNumber min={1} max={line.available} value={v} onChange={(n) => update(line, n || 1)} />,
          },
          { title: 'Subtotal', render: (_: any, l: any) => fmtRp(l.price * l.qty) },
          {
            title: '', render: (_: any, l: any) => (
              <Button danger icon={<DeleteOutlined />} onClick={() => remove(l)} />
            ),
          },
        ]}
      />
      <Space style={{ marginTop: 16, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Text strong style={{ fontSize: 18 }}>Total: {fmtRp(total)}</Typography.Text>
        <Space>
          <Button onClick={() => nav('/')}>Lanjut belanja</Button>
          <Button type="primary" onClick={() => nav('/checkout')}>Checkout</Button>
        </Space>
      </Space>
      {sugg.length > 0 && (
        <Card size="small" title="Saran checkout bersama" style={{ marginTop: 16 }}>
          <Row gutter={[12, 12]}>
            {sugg.map((s) => (
              <Col key={s.product_id} xs={12} md={8}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.product!.name}</div>
                    <div style={{ color: '#888' }}>{fmtRp(s.price)} · stok {s.available}</div>
                  </div>
                  <Button size="small" onClick={() => addSugg(s)}>+ Tambah</Button>
                </Space>
              </Col>
            ))}
          </Row>
        </Card>
      )}
    </Card>
  )
}
