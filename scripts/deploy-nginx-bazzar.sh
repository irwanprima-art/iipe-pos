#!/bin/bash
set -e

# --- Nginx site untuk bazzar.souluze.com -> frontend IIPE (127.0.0.1:8090) ---
cat > /etc/nginx/sites-available/bazzar <<'EOF'
server {
    listen 80;
    server_name bazzar.souluze.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/bazzar /etc/nginx/sites-enabled/bazzar
echo "[OK] sites-enabled/bazzar dibuat"

# --- Validasi & reload ---
if nginx -t 2>&1; then
  systemctl reload nginx
  echo "[OK] nginx reloaded"
else
  echo "[FAIL] nginx config invalid"
  exit 1
fi

echo ""
echo "=== Hasil: ==="
nginx -T 2>/dev/null | grep -A2 "server_name bazzar"
