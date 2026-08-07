#!/bin/bash
echo "=== Login admin ==="
curl -s -X POST https://bazzar.souluze.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@iipe.dev","password":"admin123"}' | head -c 300
echo ""
echo ""
echo "=== Store products ==="
curl -s https://bazzar.souluze.com/api/v1/store/products | head -c 400
echo ""
