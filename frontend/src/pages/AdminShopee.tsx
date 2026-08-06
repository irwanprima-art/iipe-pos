import { useEffect, useState } from 'react'
import { Card, Table, Button, Input, Space, Tag, message } from 'antd'
import { api } from '../api'

interface ShopeeRow {
  id: number
  sku: string
  name: string
  marketplace_link: string
  custom_affiliate_link: string
  auto_affiliate_link: string
  affiliate_link: string
}

// Portal hidden (Super Admin) untuk kelola link Shopee → affiliate pribadi.
export default function AdminShopee() {
  const [rows, setRows] = useState<ShopeeRow[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<number | null>(null)

  function load() {
    api.get<ShopeeRow[]>('/admin/shopee').then((rs) => {
      setRows(rs)
      const d: Record<number, string> = {}
      rs.forEach((r) => { d[r.id] = r.custom_affiliate_link || '' })
      setDrafts(d)
    }).catch((e) => message.error(e.message))
  }
  useEffect(load, [])

  async function save(row: ShopeeRow) {
    setSaving(row.id)
    try {
      await api.post(`/admin/products/${row.id}/affiliate`, { custom_affiliate_link: (drafts[row.id] || '').trim() })
      message.success(`${row.sku} disimpan`)
      load()
    } catch (e: any) { message.error(e.message) } finally { setSaving(null) }
  }

  return (
    <Card title="Portal Link Shopee (Super Admin)">
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: 'SKU', dataIndex: 'sku' },
          { title: 'Nama', dataIndex: 'name' },
          {
            title: 'Link Shopee', dataIndex: 'marketplace_link',
            render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">buka</a> : <Tag>—</Tag>,
          },
          {
            title: 'Affiliate Otomatis', dataIndex: 'auto_affiliate_link',
            render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>lihat</a> : <Tag>—</Tag>,
          },
          {
            title: 'Link Affiliate Saya (kosongkan = otomatis)',
            render: (_: any, row: ShopeeRow) => (
              <Input
                value={drafts[row.id] || ''}
                onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: e.target.value }))}
                placeholder="Paste link affiliate pribadi"
                style={{ width: 320 }}
              />
            ),
          },
          {
            title: '', render: (_: any, row: ShopeeRow) => (
              <Button type="primary" size="small" loading={saving === row.id} onClick={() => save(row)}>Simpan</Button>
            ),
          },
        ]}
      />
      <Space style={{ marginTop: 12 }} wrap>
        <Tag color="blue">Isi link affiliate pribadi lalu Simpan. Kosongkan lalu Simpan = pakai affiliate otomatis backend.</Tag>
      </Space>
    </Card>
  )
}
