# Uji end-to-end IIPE (jalankan saat stack sudah up: docker compose up -d)
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8080/api/v1'

Write-Output '=== 1. CHECKOUT ONLINE (kaos x2 + bundle x1) ==='
$coBody = @{
  event_id = 1
  items = @(
    @{ product_id = 1; qty = 2; item_type = 'product' },
    @{ product_id = 4; qty = 1; item_type = 'bundle' }
  )
  customer_name = 'Budi'
  customer_phone = '081234567890'
} | ConvertTo-Json -Depth 5
$order = Invoke-RestMethod -Uri "$base/checkout" -Method Post -ContentType 'application/json' -Body $coBody
Write-Output "ORDER: $($order.order_no) | status=$($order.status) | total=$($order.total)"
Write-Output "PAYMENT: $($order.payment.provider_ref) | status=$($order.payment.status)"

Write-Output '=== 2. KONFIRMASI BAYAR (webhook) ==='
$wbBody = @{ provider_ref = $order.payment.provider_ref; status = 'paid' } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/webhooks/payment" -Method Post -ContentType 'application/json' -Body $wbBody | Out-Null
$o2 = Invoke-RestMethod -Uri "$base/orders/status/$($order.qr_code)"
Write-Output "AFTER PAY: $($o2.status)"

Write-Output '=== 3. LOGIN ADMIN ==='
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = 'admin@iipe.dev'; password = 'admin123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
Write-Output "user=$($login.user.name) role=$($login.user.role)"

Write-Output '=== 4. PICK ==='
$p = Invoke-RestMethod -Uri "$base/orders/$($o2.id)/pick" -Method Post -Headers $h
Write-Output "PICK: $($p.status)"

Write-Output '=== 5. PACK (nomor pickup) ==='
$pk = Invoke-RestMethod -Uri "$base/orders/$($o2.id)/pack" -Method Post -Headers $h
Write-Output "PACK: pickup_no=$($pk.pickup_no) | status=$($pk.order.status)"

Write-Output '=== 6. READY (notifikasi n8n) ==='
$rd = Invoke-RestMethod -Uri "$base/orders/$($o2.id)/ready" -Method Post -Headers $h
Write-Output "READY: $($rd.status)"

Write-Output '=== 7. SCAN QR CUSTOMER (handover) ==='
$sc = Invoke-RestMethod -Uri "$base/orders/scan" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ token = $order.qr_code } | ConvertTo-Json)
Write-Output "SCAN: order=$($sc.order_no) | pickup=$($sc.pickup_no) | status=$($sc.status)"
$hv = Invoke-RestMethod -Uri "$base/orders/$($o2.id)/handover" -Method Post -Headers $h
Write-Output "HANDOVER: $($hv.status)"

Write-Output '=== 8. POS (tumbler x3 via EDC) ==='
$pos = Invoke-RestMethod -Uri "$base/pos/checkout" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ event_id = 1; method = 'edc'; items = @(@{ product_id = 2; qty = 3; item_type = 'product' }) } | ConvertTo-Json -Depth 5)
Write-Output "POS: $($pos.order_no) | status=$($pos.status) | method=$($pos.payment_method)"

Write-Output '=== 9. STOK AKHIR (event 1) ==='
$st = Invoke-RestMethod -Uri "$base/admin/stock?event_id=1" -Headers $h
$st | Select-Object product_id, stock_total, reserved, sold, available | ConvertTo-Json -Compress

Write-Output '=== 10. NOTIFIKASI (n8n log) ==='
docker exec iipe-db psql -U iipe -d iipe -t -A -c "SELECT status || ' | ' || COALESCE(payload->>'event','') FROM notification_logs ORDER BY id;"

Write-Output '=== SELESAI — SEMUA LANGKAH DIJALANKAN ==='
