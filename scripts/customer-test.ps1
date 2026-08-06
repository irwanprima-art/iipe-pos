# Uji fitur customer & WA (perlu stack up)
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8080/api/v1'

Write-Output '=== 1. VALIDASI WA (nomor salah "abc") ==='
try {
  Invoke-RestMethod -Uri "$base/checkout" -Method Post -ContentType 'application/json' -Body (@{ event_id = 1; items = @(@{ product_id = 3; qty = 1; item_type = 'product' }); customer_name = 'Budi'; customer_phone = 'abc' } | ConvertTo-Json -Depth 5) | Out-Null
  Write-Output 'UNEXPECTED: diterima'
} catch {
  Write-Output "OK ditolak: $($_.ErrorDetails.Message)"
}

Write-Output '=== 2. CHECKOUT valid (auto-login customer) ==='
$o = Invoke-RestMethod -Uri "$base/checkout" -Method Post -ContentType 'application/json' -Body (@{ event_id = 1; items = @(@{ product_id = 3; qty = 1; item_type = 'product' }); customer_name = 'Siti Aminah'; customer_phone = '081234567899' } | ConvertTo-Json -Depth 5)
Write-Output "ORDER: $($o.order_no) | phone=$($o.customer_phone) | cust_token=$([bool]$o.customer_token)"

Write-Output '=== 3. OTP request ==='
$otp = Invoke-RestMethod -Uri "$base/auth/customer/otp" -Method Post -ContentType 'application/json' -Body (@{ phone = '081234567899' } | ConvertTo-Json)
Write-Output "ok=$($otp.ok) | dev_otp=$($otp.dev_otp)"

Write-Output '=== 4. OTP verify ==='
$v = Invoke-RestMethod -Uri "$base/auth/customer/otp/verify" -Method Post -ContentType 'application/json' -Body (@{ phone = '081234567899'; otp = $otp.dev_otp } | ConvertTo-Json)
Write-Output "token=$([bool]$v.token) | name=$($v.name) | phone=$($v.phone)"

Write-Output '=== 5. Pesanan customer ==='
$h = @{ Authorization = "Bearer $($v.token)" }
$my = Invoke-RestMethod -Uri "$base/customer/orders" -Headers $h
Write-Output "orders=$($my.Count) | $($my[0].order_no) status=$($my[0].status)"

Write-Output '=== 6. List customer (admin) ==='
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = 'admin@iipe.dev'; password = 'admin123' } | ConvertTo-Json)
$ah = @{ Authorization = "Bearer $($login.token)" }
$cust = Invoke-RestMethod -Uri "$base/admin/customers" -Headers $ah
$cust | Select-Object name, phone, orders, spent | ConvertTo-Json -Compress

Write-Output '=== SELESAI ==='
