#!/usr/bin/env bash
set -euo pipefail

# Fetches official Cloudflare IPv4/IPv6 ranges, updates Nginx configs with backup,
# validates via `nginx -t`, and reloads Nginx only on success.

NGINX_REALIP="/etc/nginx/conf.d/cloudflare-realip.conf"
BACKUP_DIR="/etc/nginx/backups"
TS="$(date +%Y%m%d-%H%M%S)"

V4="$(curl -fsSL https://www.cloudflare.com/ips-v4)"
V6="$(curl -fsSL https://www.cloudflare.com/ips-v6)"

if [ -z "$V4" ] || [ -z "$V6" ]; then
  echo "Failed to fetch Cloudflare IP lists" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
if [ -f "$NGINX_REALIP" ]; then
  cp "$NGINX_REALIP" "$BACKUP_DIR/cloudflare-realip.conf.$TS"
fi

{
  echo "# Official Cloudflare IP ranges (auto-generated $TS)"
  echo "# IPv4"
  for cidr in $V4; do
    echo "set_real_ip_from $cidr;"
  done
  echo ""
  echo "# IPv6"
  for cidr in $V6; do
    echo "set_real_ip_from $cidr;"
  done
  echo ""
  echo "real_ip_header CF-Connecting-IP;"
  echo "real_ip_recursive on;"
} > "$NGINX_REALIP"

if nginx -t; then
  systemctl reload nginx
  echo "Nginx reloaded successfully with updated Cloudflare IP ranges."
else
  echo "nginx -t failed! Restoring backup..." >&2
  if [ -f "$BACKUP_DIR/cloudflare-realip.conf.$TS" ]; then
    cp "$BACKUP_DIR/cloudflare-realip.conf.$TS" "$NGINX_REALIP"
  fi
  exit 1
fi

