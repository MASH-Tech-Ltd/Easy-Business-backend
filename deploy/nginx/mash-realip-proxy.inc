# Include inside every `location /` block that proxies to Node.js (Express or Next.js).
# Requires cloudflare-realip.conf and mash-edge-geo.conf in /etc/nginx/conf.d/.

# Drop direct-to-origin requests that bypassed Cloudflare (except self/loopback).
# Uncomment the next 3 lines once you verify YOUR_VPS_PUBLIC_IP is set in mash-edge-geo.conf:
# if ($mash_edge = "direct") {
#     return 444;
# }

# Overwrite forwarding headers with the Nginx-verified values (prevents client spoofing)
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Mash-Edge $mash_edge;

# Only allow x-tenant-client-ip when the TCP peer is this server itself ("self")
set $mash_tenant_ip "";
if ($mash_edge = "self") {
    set $mash_tenant_ip $http_x_tenant_client_ip;
}
proxy_set_header x-tenant-client-ip $mash_tenant_ip;

