import { Card, Form, Input, Button, message } from 'antd'
import { useNavigate, Navigate } from 'react-router-dom'
import { api, setToken, setUser, token, clearToken } from '../api'

export default function AdminLogin() {
  const nav = useNavigate()
  if (token()) return <Navigate to="/admin" replace />
  async function onFinish(v: any) {
    try {
      const res = await api.post<{ token: string; user: { name: string; role: string } }>('/auth/login', v)
      setToken(res.token)
      setUser(res.user)
      message.success('Login berhasil')
      nav('/admin')
    } catch (e: any) {
      message.error(e.message)
    }
  }
  return (
    <Card title="Login Admin / Staff" style={{ maxWidth: 420, margin: '60px auto' }}>
      <Form layout="vertical" onFinish={onFinish}>
        <Form.Item name="email" label="Email" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>Login</Button>
      </Form>
    </Card>
  )
}
