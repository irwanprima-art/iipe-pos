#!/bin/bash
set -e
cd ~/iipe-pos

# --- Patch: PORT internal backend selalu 8080 (hanya mapping host yang memakai BACKEND_PORT) ---
if grep -q 'PORT: "${BACKEND_PORT:-8080}"' docker-compose.yml; then
  sed -i 's|PORT: "${BACKEND_PORT:-8080}"|PORT: "8080"|' docker-compose.yml
  echo "[OK] docker-compose.yml di-patch: PORT internal -> 8080"
else
  echo "[SKIP] patch sudah diterapkan"
fi

# --- Recreate backend dengan config baru ---
docker compose up -d --no-build 2>&1 | tail -5

sleep 3

echo ""
echo "=== Container ==="
docker ps --filter name=iipe --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo ""
echo "=== Test API via frontend container (localhost:8090) ==="
curl -s -o /dev/null -w 'GET /api/v1/events -> %{http_code}\n' http://localhost:8090/api/v1/events

echo ""
echo "=== Test API via backend langsung (localhost:18080) ==="
curl -s -o /dev/null -w 'GET /api/v1/events -> %{http_code}\n' http://localhost:18080/api/v1/events
