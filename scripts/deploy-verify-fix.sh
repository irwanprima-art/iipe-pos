#!/bin/bash
echo "=== Login admin ==="
TOKEN=$(curl -s -X POST https://bazzar.souluze.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@iipe.dev","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "LOGIN GAGAL"; exit 1; fi
echo "token OK"

echo ""
echo "=== PATCH event 1 dengan lat/lng (number) ==="
curl -s -X PATCH https://bazzar.souluze.com/api/v1/admin/events/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bazaar IIPE 2026","location":"Lapangan Merdeka","lat":-6.200000,"lng":106.816666}'
echo ""

echo ""
echo "=== Container ==="
docker ps --filter name=iipe --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
