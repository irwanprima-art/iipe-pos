import { type ReactNode } from 'react'
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, Space, Button, Tag } from 'antd'
import { currentUser, clearToken, token } from './api'
import StoreHome from './pages/StoreHome'
import ProductDetail from './pages/ProductDetail'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import OrderStatusPage from './pages/OrderStatusPage'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminProducts from './pages/AdminProducts'
import AdminBundles from './pages/AdminBundles'
import AdminEvents from './pages/AdminEvents'
import AdminOrders from './pages/AdminOrders'
import AdminStock from './pages/AdminStock'
import AdminShopee from './pages/AdminShopee'
import PosPage from './pages/PosPage'
import FulfillPage from './pages/FulfillPage'

const { Header, Content } = Layout

function TopBar() {
  const nav = useNavigate()
  const user = currentUser()
  const loggedIn = !!token()
  return (
    <Header style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#001529' }}>
      <Link to="/" style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>IIPE Bazaar</Link>
      <Space style={{ marginLeft: 'auto' }}>
        {loggedIn ? (
          <>
            <Button type="text" style={{ color: '#fff' }} onClick={() => nav('/admin')}>Admin</Button>
            <Button type="text" style={{ color: '#fff' }} onClick={() => nav('/pos')}>POS</Button>
            <Button type="text" style={{ color: '#fff' }} onClick={() => nav('/fulfill')}>Fulfillment</Button>
            <Tag color="blue">{user?.name} ({user?.role})</Tag>
            <Button size="small" onClick={() => { clearToken(); nav('/') }}>Logout</Button>
          </>
        ) : (
          <Button type="link" style={{ color: '#fff', padding: 0 }} onClick={() => nav('/admin/login')}>Login</Button>
        )}
      </Space>
    </Header>
  )
}

// Guard halaman internal (POS / Fulfillment): hanya staf yang login.
function StaffGuard({ children }: { children: ReactNode }) {
  if (!token()) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

function AdminLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  if (!token()) return <Navigate to="/admin/login" replace />
  const items = [
    { key: '/admin', label: <Link to="/admin">Dashboard</Link> },
    { key: '/admin/products', label: <Link to="/admin/products">Produk</Link> },
    { key: '/admin/bundles', label: <Link to="/admin/bundles">Bundle</Link> },
    { key: '/admin/events', label: <Link to="/admin/events">Event & Katalog</Link> },
    { key: '/admin/orders', label: <Link to="/admin/orders">Order</Link> },
    { key: '/admin/stock', label: <Link to="/admin/stock">Stok</Link> },
    { key: '/admin/shopee', label: <Link to="/admin/shopee">Shopee Link</Link> },
  ]
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Menu
        mode="horizontal"
        selectedKeys={[loc.pathname]}
        onClick={(e) => nav(e.key)}
        items={items}
        style={{ borderBottom: 0 }}
      />
      <Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/products" element={<AdminProducts />} />
          <Route path="/bundles" element={<AdminBundles />} />
          <Route path="/events" element={<AdminEvents />} />
          <Route path="/orders" element={<AdminOrders />} />
          <Route path="/stock" element={<AdminStock />} />
          <Route path="/shopee" element={<AdminShopee />} />
        </Routes>
      </Content>
    </Layout>
  )
}

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <TopBar />
      <Content>
        <Routes>
          <Route path="/" element={<StoreHome />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/status/:token" element={<OrderStatusPage />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="/pos" element={<StaffGuard><PosPage /></StaffGuard>} />
          <Route path="/fulfill" element={<StaffGuard><FulfillPage /></StaffGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Content>
    </Layout>
  )
}
