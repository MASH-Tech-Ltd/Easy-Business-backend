# Nginx Real Client IP Setup & Rollback Guide

## 1. Install on VPS (with backup)
```bash
# Backup current Nginx config
sudo tar -czf /root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx

# Copy the two http-level configs
sudo cp deploy/nginx/cloudflare-realip.conf /etc/nginx/conf.d/cloudflare-realip.conf
sudo cp deploy/nginx/mash-edge-geo.conf /etc/nginx/conf.d/mash-edge-geo.conf
sudo cp deploy/nginx/mash-realip-proxy.inc /etc/nginx/snippets/mash-realip-proxy.inc

# Set your actual VPS public IP in /etc/nginx/conf.d/mash-edge-geo.conf
curl -s https://api.ipify.org
sudo nano /etc/nginx/conf.d/mash-edge-geo.conf
```

## 2. Include in your `server {}` blocks (backend API & Next.js apps)
Inside each `location / { ... proxy_pass ...; }` add:
```nginx
include /etc/nginx/snippets/mash-realip-proxy.inc;
```

## 3. Avoid the 2nd Cloudflare hop (recommended)
In production `.env` for Next.js apps (`electronics-tenant-app`, `electronics-merchant-dashboard`, `electronics-affiliate-dashboard`) running on the same VPS:
```env
API_URL=http://127.0.0.1:8000/api/v1
BACKEND_INTERNAL_URL=http://127.0.0.1:8000
```
And in `electronics-backend/.env`:
```env
HOST=127.0.0.1
```

## 4. Validate & reload
```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Rollback
```bash
sudo rm -f /etc/nginx/conf.d/cloudflare-realip.conf /etc/nginx/conf.d/mash-edge-geo.conf /etc/nginx/snippets/mash-realip-proxy.inc
# Remove `include /etc/nginx/snippets/mash-realip-proxy.inc;` from your site configs
sudo nginx -t && sudo systemctl reload nginx
```

