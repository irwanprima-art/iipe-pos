#!/bin/bash
set -e
cd ~/iipe-pos

# 1. Salin template .env (tidak menimpa nilai yang sudah diisi user di run berikutnya)
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[OK] .env dibuat dari .env.example"
else
  echo "[SKIP] .env sudah ada"
fi

# 2. JWT_SECRET acak (hanya jika masih default 'change-me')
if grep -q '^JWT_SECRET=change-me$' .env; then
  SECRET=$(openssl rand -hex 32)
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$SECRET/" .env
  echo "[OK] JWT_SECRET digenerate acak"
else
  echo "[SKIP] JWT_SECRET sudah diisi"
fi

# 3. Backend port -> 18080 (hindari bentrok dengan kforce-api di 8080)
if grep -q '^BACKEND_PORT=8080$' .env; then
  sed -i "s/^BACKEND_PORT=.*/BACKEND_PORT=18080/" .env
  echo "[OK] BACKEND_PORT -> 18080"
fi

echo ""
echo "=== Variable di .env (nilai disembunyikan) ==="
grep -oE '^[A-Z_]+' .env
