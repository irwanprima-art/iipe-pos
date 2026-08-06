import { useEffect, useMemo, useState } from 'react'
import { Row, Col, Card, Button, Select, Input, Tooltip, Tag, Empty, Space, message, Skeleton } from 'antd'
import { ShoppingCartOutlined, ShoppingOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { api, Event, EventProduct, fmtRp, loadCart, saveCart, Cart } from '../api'

const imgFallback = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#f0f0f0"/><text x="100" y="105" font-size="14" fill="#aaa" text-anchor="middle">No Image</text></svg>')

export default function StoreHome() {
  const nav = useNavigate()
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<number>(0)
  const [products, setProducts] = useState<EventProduct[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Event[]>('/store/events').then((evs) => {
      setEvents(evs)
      if (evs.length) { setEventId(evs[0].id); }
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!eventId) return
    setLoading(true)
    api.get<EventProduct[]>(`/store/products?event_id=${eventId}`)
      .then(setProducts)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false))
  }, [eventId])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter((p) => !q || p.product!.name.toLowerCase().includes(q) || p.product!.sku.toLowerCase().includes(q))
  }, [products, search])

  function addToCart(ep: EventProduct) {
    const prod = ep.product!
    const cur = loadCart() || { event_id: eventId, lines: [] }
    if (cur.event_id !== eventId) { cur.event_id = eventId; cur.lines = [] }
    const found = cur.lines.find((l) => l.product_id === ep.product_id)
    if (found) {
      if (found.qty + 1 > ep.available) { message.warning('Stok tidak mencukupi'); return }
      found.qty += 1
    } else {
      if (ep.available < 1) { message.warning('Stok habis'); return }
      cur.lines.push({ product_id: ep.product_id, name: prod.name, price: ep.price, qty: 1, item_type: prod.is_bundle ? 'bundle' : 'product', available: ep.available })
    }
    saveCart(cur)
    message.success(`${prod.name} ditambahkan ke keranjang`)
  }

  const cart = loadCart()

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 280 }}
          value={eventId || undefined}
          placeholder="Pilih event"
          onChange={setEventId}
          options={events.map((e) => ({ value: e.id, label: `${e.name} (${e.location || '-'})` }))}
        />
        <Input.Search placeholder="Cari produk / SKU" allowClear style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        <Button type="primary" icon={<ShoppingCartOutlined />} onClick={() => nav('/cart')}>
          Keranjang ({cart?.lines.reduce((s, l) => s + l.qty, 0) || 0})
        </Button>
      </Space>

      {loading ? <Skeleton active /> : filtered.length === 0 ? <Empty description="Belum ada produk" /> : (
        <Row gutter={[16, 16]}>
          {filtered.map((ep) => {
            const prod = ep.product!
            return (
              <Col key={ep.product_id} xs={12} sm={8} md={6}>
                <Card
                  hoverable
                  cover={<Link to={`/product/${ep.product_id}?event_id=${eventId}`}><img src={prod.images?.[0] || imgFallback} style={{ height: 160, objectFit: 'cover', width: '100%' }} /></Link>}
                  styles={{ body: { padding: 12 } }}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Link to={`/product/${ep.product_id}?event_id=${eventId}`} style={{ fontWeight: 600 }}>{prod.name}</Link>
                    <Tag color="blue">{prod.sku}</Tag>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtRp(ep.price)}</div>
                    <div style={{ color: ep.available > 0 ? '#52c41a' : '#ff4d4f' }}>
                      {prod.is_bundle ? 'Bundle' : `Stok: ${ep.available}`}
                    </div>
                    <Space wrap>
                      <Button
                        type="primary" size="small" disabled={ep.available < 1}
                        onClick={() => addToCart(ep)}
                      >+ Keranjang</Button>
                      {prod.affiliate_link && (
                        <Tooltip title="Beli di Shopee / kirim ke rumah">
                          <a href={prod.affiliate_link} target="_blank" rel="noreferrer">
                            <Button size="small" icon={<ShoppingOutlined />}>Shopee</Button>
                          </a>
                        </Tooltip>
                      )}
                    </Space>
                  </Space>
                </Card>
              </Col>
            )
          })}
        </Row>
      )}
      <div style={{ marginTop: 24 }}>
        <Button type="link" onClick={() => nav('/cart')}>Lihat keranjang & checkout →</Button>
      </div>
    </div>
  )
}

