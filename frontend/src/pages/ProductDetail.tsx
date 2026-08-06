import { useEffect, useState } from 'react'
import { Card, Row, Col, Space, Button, Tag, InputNumber, message, Typography, Image, Skeleton } from 'antd'
import { ShoppingCartOutlined, ShoppingOutlined } from '@ant-design/icons'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { api, EventProduct, fmtRp, loadCart, saveCart } from '../api'

const imgFallback = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#f0f0f0"/><text x="150" y="155" font-size="16" fill="#aaa" text-anchor="middle">No Image</text></svg>')

export default function ProductDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [eventId, setEventId] = useState<number>(Number(params.get('event_id')) || 0)
  const [ep, setEp] = useState<EventProduct | null>(null)
  const [sugg, setSugg] = useState<EventProduct[]>([])
  const [qty, setQty] = useState(1)
  const [imgIdx, setImgIdx] = useState(0)

  useEffect(() => {
    if (!id) return
    api.get<EventProduct>(`/store/products/${id}?event_id=${eventId || ''}`)
      .then((d) => { setEp(d); if (!eventId && d.event_id) setEventId(d.event_id) })
      .catch((e) => message.error(e.message))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id || !eventId) return
    api.get<EventProduct[]>(`/store/products/${id}/suggestions?event_id=${eventId}&limit=4`)
      .then(setSugg).catch(() => {})
  }, [id, eventId])

  if (!ep) return <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}><Skeleton active /></div>

  const prod = ep.product!
  const images = prod.images && prod.images.length ? prod.images : [imgFallback]

  function addToCart() {
    const cur = loadCart() || { event_id: eventId || ep.event_id, lines: [] }
    if (cur.event_id !== (eventId || ep.event_id)) { cur.event_id = eventId || ep.event_id; cur.lines = [] }
    const found = cur.lines.find((l) => l.product_id === ep.product_id)
    if (found) {
      if (found.qty + qty > ep.available) { message.warning('Melebihi stok'); return }
      found.qty += qty
    } else {
      if (qty > ep.available) { message.warning('Melebihi stok'); return }
      cur.lines.push({ product_id: ep.product_id, name: prod.name, price: ep.price, qty, item_type: prod.is_bundle ? 'bundle' : 'product', available: ep.available })
    }
    saveCart(cur)
    message.success('Ditambahkan ke keranjang')
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
      <Row gutter={[24, 24]}>
        <Col xs={24} md={10}>
          <Image src={images[imgIdx]} style={{ width: '100%', borderRadius: 8 }} fallback={imgFallback} />
          {images.length > 1 && (
            <Space style={{ marginTop: 8 }} wrap>
              {images.map((im, i) => (
                <img
                  key={i} src={im} onClick={() => setImgIdx(i)}
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: i === imgIdx ? '2px solid #1677ff' : '1px solid #eee' }}
                />
              ))}
            </Space>
          )}
        </Col>
        <Col xs={24} md={14}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Title level={3} style={{ margin: 0 }}>{prod.name}</Typography.Title>
            <Space wrap>
              <Tag color="blue">{prod.sku}</Tag>
              {prod.is_bundle && <Tag color="gold">Bundle</Tag>}
            </Space>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtRp(ep.price)}</div>
            <div style={{ color: ep.available > 0 ? '#52c41a' : '#ff4d4f' }}>Stok tersedia: {ep.available}</div>
            {prod.description && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{prod.description}</Typography.Paragraph>
            )}
            <Space wrap>
              <InputNumber min={1} max={ep.available || 1} value={qty} onChange={(n) => setQty(n || 1)} />
              <Button type="primary" size="large" icon={<ShoppingCartOutlined />} disabled={ep.available < 1} onClick={addToCart}>
                + Keranjang
              </Button>
              {prod.affiliate_link && (
                <a href={prod.affiliate_link} target="_blank" rel="noreferrer">
                  <Button size="large" icon={<ShoppingOutlined />}>Beli di Shopee (kirim ke rumah)</Button>
                </a>
              )}
            </Space>
            <Button type="link" onClick={() => nav('/cart')}>Lihat keranjang →</Button>
          </Space>
        </Col>
      </Row>

      {sugg.length > 0 && (
        <Card title="Saran beli bersama" style={{ marginTop: 24 }}>
          <Row gutter={[16, 16]}>
            {sugg.map((s) => (
              <Col key={s.product_id} xs={12} sm={6}>
                <Card
                  size="small" hoverable
                  onClick={() => { setEp(null); setImgIdx(0); nav(`/product/${s.product_id}?event_id=${eventId || ep.event_id}`) }}
                  styles={{ body: { padding: 12 } }}
                >
                  <div style={{ fontWeight: 600, minHeight: 40 }}>{s.product!.name}</div>
                  <div style={{ color: '#888', fontSize: 13 }}>{fmtRp(s.price)} · stok {s.available}</div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <Button type="link"><Link to="/">← Kembali ke katalog</Link></Button>
      </div>
    </div>
  )
}
