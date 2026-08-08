import { useEffect, useState } from 'react'

const base = '/api/v1'

// ---------- helpers ----------
/** Konversi nilai form (string dari <Input type="number" />) ke number; undefined jika kosong/tidak valid */
export function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// ---------- types ----------
export interface Event { id: number; code: string; name: string; location: string; is_active: boolean; online_payment: boolean; lat?: number; lng?: number }
export interface Component { product_id: number; sku: string; name: string; qty: number }
export interface Product {
  id: number; sku: string; name: string; category: string; description: string
  barcode_pcs: string; barcode_carton: string; qty_per_carton: number
  marketplace_link: string; custom_affiliate_link: string; affiliate_link: string; is_bundle: boolean; images: string[]
  components?: Component[]
}
export interface EventProduct {
  event_id: number; product_id: number; price: number; stock_total: number
  available: number; reserved: number; sold: number; is_active: boolean; product?: Product
}
export interface StockMovement {
  id: number; event_id: number; event_name: string; product_id: number
  sku: string; product: string; type: string; qty: number
  ref_type: string; ref_id: number; reason: string; created_at: string
}
export interface OrderItem { id: number; item_type: string; parent_id?: number; product_id: number; sku: string; name: string; qty: number; price: number; state: string }
export interface Payment { id: number; order_id: number; method: string; amount: number; status: string; provider_ref: string; ref_no?: string; payment_link_url?: string; expires_at?: string }
export interface StatusHistory { status: string; actor: string; created_at: string }
export interface Order {
  id: number; order_no: string; event_id: number; event_name: string; channel: string; status: string
  customer_name: string; customer_phone: string; total: number; qr_code: string; pickup_no?: number
  payment_method: string; provider_ref: string; online_payment: boolean; reserved_until?: string; created_at: string
  items: OrderItem[]; payment?: Payment; history?: StatusHistory[]
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
async function request<T>(method: string, path: string, body: any, getTok: () => string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = getTok()
  if (t) headers['Authorization'] = 'Bearer ' + t
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error || res.statusText)
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p, undefined, token),
  post: <T>(p: string, b?: any) => request<T>('POST', p, b, token),
  patch: <T>(p: string, b?: any) => request<T>('PATCH', p, b, token),
  del: <T>(p: string) => request<T>('DELETE', p, undefined, token),
}

// API memakai token customer (untuk "Pesanan Saya")
export const apiCust = {
  get: <T>(p: string) => request<T>('GET', p, undefined, customerToken),
}

// ---- customer auth (login via WA + OTP) ----
export function customerToken() { return localStorage.getItem('iipe_customer_token') || '' }
export function setCustomerToken(t: string) { localStorage.setItem('iipe_customer_token', t) }
export function clearCustomerToken() { localStorage.removeItem('iipe_customer_token') }

export function normalizePhone(raw: string) {
  let s = (raw || '').replace(/\D/g, '')
  if (s.startsWith('0')) s = '62' + s.slice(1)
  return s
}
export function isValidWaPhone(raw: string) {
  const n = normalizePhone(raw)
  return n.length >= 10 && n.length <= 15
}

export interface Customer { id: number; name: string; phone: string; orders: number; spent: number; created_at: string }

// ---------- helpers ----------
export function fmtRp(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
}

export interface CartLine { product_id: number; name: string; price: number; qty: number; item_type: string; available: number }
export interface Cart { event_id: number; lines: CartLine[] }

const CART_KEY = 'iipe_cart'
const CART_EVENT = 'iipe:cart-changed'

export function loadCart(): Cart | null {
  const raw = localStorage.getItem(CART_KEY)
  return raw ? JSON.parse(raw) : null
}
export function saveCart(c: Cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(c))
  window.dispatchEvent(new Event(CART_EVENT))
}
export function clearCart() {
  localStorage.removeItem(CART_KEY)
  window.dispatchEvent(new Event(CART_EVENT))
}

/** Jumlah item di keranjang, reaktif terhadap perubahan dari halaman mana pun. */
export function useCartCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const calc = () => {
      const c = loadCart()
      setCount(c ? c.lines.reduce((s, l) => s + l.qty, 0) : 0)
    }
    calc()
    window.addEventListener(CART_EVENT, calc)
    window.addEventListener('storage', calc)
    return () => {
      window.removeEventListener(CART_EVENT, calc)
      window.removeEventListener('storage', calc)
    }
  }, [])
  return count
}

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
