const base = '/api/v1'

// ---------- types ----------
export interface Event { id: number; code: string; name: string; location: string; is_active: boolean }
export interface Component { product_id: number; sku: string; name: string; qty: number }
export interface Product {
  id: number; sku: string; name: string; category: string; description: string
  barcode_pcs: string; barcode_carton: string; qty_per_carton: number
  marketplace_link: string; affiliate_link: string; is_bundle: boolean; images: string[]
  components?: Component[]
}
export interface EventProduct {
  event_id: number; product_id: number; price: number; stock_total: number
  available: number; reserved: number; sold: number; is_active: boolean; product?: Product
}
export interface OrderItem { id: number; item_type: string; parent_id?: number; product_id: number; sku: string; name: string; qty: number; price: number; state: string }
export interface Payment { id: number; order_id: number; method: string; amount: number; status: string; provider_ref: string; payment_link_url?: string; expires_at?: string }
export interface Order {
  id: number; order_no: string; event_id: number; event_name: string; channel: string; status: string
  customer_name: string; customer_phone: string; total: number; qr_code: string; pickup_no?: number
  payment_method: string; provider_ref: string; reserved_until?: string; created_at: string
  items: OrderItem[]; payment?: Payment
}
export interface PosProduct {
  product_id: number; sku: string; name: string; barcode_pcs: string; barcode_carton: string
  qty_per_carton: number; is_bundle: boolean; price: number; available: number; images: string[]
}

// ---------- auth ----------
export function token() { return localStorage.getItem('iipe_token') || '' }
export function setToken(t: string) { localStorage.setItem('iipe_token', t) }
export function clearToken() { localStorage.removeItem('iipe_token') }
export function currentUser(): { name: string; role: string } | null {
  const raw = localStorage.getItem('iipe_user')
  return raw ? JSON.parse(raw) : null
}
export function setUser(u: { name: string; role: string }) { localStorage.setItem('iipe_user', JSON.stringify(u)) }

// ---------- http ----------
async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = token()
  if (t) headers['Authorization'] = 'Bearer ' + t
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error || res.statusText)
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: any) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: any) => request<T>('PATCH', p, b),
}

// ---------- helpers ----------
export function fmtRp(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
}

export interface CartLine { product_id: number; name: string; price: number; qty: number; item_type: string; available: number }
export interface Cart { event_id: number; lines: CartLine[] }

const CART_KEY = 'iipe_cart'
export function loadCart(): Cart | null {
  const raw = localStorage.getItem(CART_KEY)
  return raw ? JSON.parse(raw) : null
}
export function saveCart(c: Cart) { localStorage.setItem(CART_KEY, JSON.stringify(c)) }
export function clearCart() { localStorage.removeItem(CART_KEY) }

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Menunggu Pembayaran',
  paid: 'Dibayar (menunggu di-pick)',
  picking: 'Sedang di-pick',
  picked: 'Ter-pick',
  packing: 'Sedang di-pack',
  packed: 'Ter-pack',
  ready: 'Siap Diambil',
  handed_over: 'Diserahkan',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}
