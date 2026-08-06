# Uji kompresi gambar saat upload (perlu stack up)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$base = 'http://localhost:8080'
$tmp = "$env:TEMP\iipe-upload-test"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$src = "$tmp\big.png"

# buat gambar besar 2500x2500 dengan noise
$bmp = New-Object System.Drawing.Bitmap(2500, 2500)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::SkyBlue)
$rand = New-Object System.Random
for ($i = 0; $i -lt 8000; $i++) {
  $x = $rand.Next(0, 2500); $y = $rand.Next(0, 2500)
  $c = [System.Drawing.Color]::FromArgb(255, $rand.Next(0, 256), $rand.Next(0, 256), $rand.Next(0, 256))
  $bmp.SetPixel($x, $y, $c)
}
$g.Dispose()
$bmp.Save($src, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$origSize = (Get-Item $src).Length
Write-Output "ASLI: 2500x2500, $origSize bytes"

# login
$login = Invoke-RestMethod -Uri "$base/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = 'admin@iipe.dev'; password = 'admin123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }

# upload multipart
$boundary = [guid]::NewGuid().ToString()
$fileBytes = [System.IO.File]::ReadAllBytes($src)
$header = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"big.png`"`r`nContent-Type: image/png`r`n`r`n"
$footer = "`r`n--$boundary--`r`n"
$headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
$footerBytes = [System.Text.Encoding]::UTF8.GetBytes($footer)
$body = New-Object byte[] ($headerBytes.Length + $fileBytes.Length + $footerBytes.Length)
[Array]::Copy($headerBytes, 0, $body, 0, $headerBytes.Length)
[Array]::Copy($fileBytes, 0, $body, $headerBytes.Length, $fileBytes.Length)
[Array]::Copy($footerBytes, 0, $body, $headerBytes.Length + $fileBytes.Length, $footerBytes.Length)

$resp = Invoke-RestMethod -Uri "$base/api/v1/admin/uploads" -Method Post -Headers $h -ContentType "multipart/form-data; boundary=$boundary" -Body $body
Write-Output "UPLOAD: $($resp.url)"

# unduh hasil & cek dimensi
$stored = "$tmp\stored.png"
$url = $resp.url
if (-not $url.StartsWith('http')) { $url = "$base$url" }
Invoke-WebRequest -Uri $url -OutFile $stored
$storedSize = (Get-Item $stored).Length
$storedBmp = New-Object System.Drawing.Bitmap($stored)
$w = $storedBmp.Width; $hh = $storedBmp.Height
$storedBmp.Dispose()
Write-Output "HASIL: ${w}x${hh}, $storedSize bytes"
Write-Output "---- KOMPRESI $([math]::Round(100 - (100.0 * $storedSize / $origSize), 1))% lebih kecil"
