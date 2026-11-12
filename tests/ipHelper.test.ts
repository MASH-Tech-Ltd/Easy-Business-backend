import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  resolveClientIp,
  getClientIp,
  getRateLimitKey,
  canAutoBlockIp,
  normalizeIp,
  isCloudflareProxyIp,
  isInternalOrWhitelistedIp,
} from "../src/utils/ipHelper";

function mockReq(
  remoteAddress: string,
  headers: Record<string, string | string[] | undefined> = {},
): Request {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  return {
    headers: normalized,
    socket: { remoteAddress } as any,
  } as unknown as Request;
}

test("Test 1: Cloudflare Proxy ON (direct CF IPv4 peer -> CF-Connecting-IP)", () => {
  const req = mockReq("103.21.244.10", {
    "cf-connecting-ip": "45.125.220.15",
  });
  const res = resolveClientIp(req);
  assert.equal(res.verified, true);
  assert.equal(res.source, "cloudflare");
  assert.equal(res.ip, "45.125.220.15");
  assert.equal(getClientIp(req), "45.125.220.15");
});

test("Test 2: Cloudflare Proxy ON with Hardened Nginx (X-Mash-Edge: cf)", () => {
  const req = mockReq("::ffff:127.0.0.1", {
    "x-mash-edge": "cf",
    "x-real-ip": "45.125.220.15",
    "cf-connecting-ip": "45.125.220.15",
    // Even if an attacker tried to smuggle x-tenant-client-ip, cf edge ignores it
    "x-tenant-client-ip": "8.8.8.8",
  });
  const res = resolveClientIp(req);
  assert.equal(res.verified, true);
  assert.equal(res.source, "cloudflare");
  assert.equal(res.ip, "45.125.220.15");
});

test("Test 3: Direct origin access cannot spoof CF-Connecting-IP or x-tenant-client-ip", () => {
  const req = mockReq("91.198.174.192", {
    "cf-connecting-ip": "8.8.8.8",
    "x-tenant-client-ip": "10.0.0.1",
    "x-forwarded-for": "1.1.1.1",
    "x-real-ip": "1.1.1.1",
  });
  const res = resolveClientIp(req);
  assert.equal(res.verified, true);
  assert.equal(res.source, "direct-peer");
  assert.equal(res.ip, "91.198.174.192");
  assert.equal(getClientIp(req), "91.198.174.192");
});

test("Test 4 & 5: IPv4-mapped normalization & IPv6 visitor + Cloudflare IPv6 detection", () => {
  assert.equal(normalizeIp("::ffff:45.125.220.15"), "45.125.220.15");
  assert.equal(isCloudflareProxyIp("2606:4700:4700::1111"), true);
  assert.equal(isCloudflareProxyIp("104.16.132.229"), true);
  assert.equal(isCloudflareProxyIp("45.125.220.15"), false);

  const v6Req = mockReq("2606:4700:4700::1111", {
    "cf-connecting-ip": "2001:4860:4860::8888",
  });
  const res = resolveClientIp(v6Req);
  assert.equal(res.verified, true);
  assert.equal(res.source, "cloudflare");
  assert.equal(res.ip, "2001:4860:4860::8888");
});

test("Test 6: Multi-proxy BFF via hardened Nginx (X-Mash-Edge: self) and direct loopback BFF", () => {
  const viaNginx = mockReq("127.0.0.1", {
    "x-mash-edge": "self",
    "x-real-ip": "45.125.220.10",
    "x-tenant-client-ip": "103.108.140.5",
  });
  const r1 = resolveClientIp(viaNginx);
  assert.equal(r1.verified, true);
  assert.equal(r1.source, "bff");
  assert.equal(r1.ip, "103.108.140.5");

  const directLoopback = mockReq("127.0.0.1", {
    "x-tenant-client-ip": "103.108.140.5",
  });
  const r2 = resolveClientIp(directLoopback);
  assert.equal(r2.verified, true);
  assert.equal(r2.source, "bff");
  assert.equal(r2.ip, "103.108.140.5");

  const internalNoVisitor = mockReq("127.0.0.1", {});
  const r3 = resolveClientIp(internalNoVisitor);
  assert.equal(r3.source, "internal");
  assert.equal(getClientIp(internalNoVisitor), "127.0.0.1");
  assert.equal(canAutoBlockIp(internalNoVisitor), false);
});

test("Test 7: Malformed, private, or Cloudflare forwarding headers are rejected", () => {
  const badValues = [
    "1.2.3.4, 5.6.7.8",
    "999.1.1.1",
    "<script>alert(1)</script>",
    "",
    "::ffff:",
    "10.0.0.1",
    "192.168.1.50",
    "172.64.10.5", // Cloudflare IP cannot be a visitor IP
    "fe80::1%eth0",
  ];

  for (const bad of badValues) {
    const req = mockReq("127.0.0.1", {
      "x-mash-edge": "cf",
      "x-real-ip": bad,
      "cf-connecting-ip": bad,
    });
    const res = resolveClientIp(req);
    assert.equal(res.verified, false, `Expected rejected for: ${bad}`);
    assert.equal(res.ip, null, `Expected null ip for: ${bad}`);
    assert.equal(getClientIp(req), "unknown");
    assert.equal(canAutoBlockIp(req), false);
    assert.equal(getRateLimitKey(req), "peer:127.0.0.1");
  }

  // RFC1918 and CF IPs are whitelisted from auto-blocking
  assert.equal(isInternalOrWhitelistedIp("10.0.0.1"), true);
  assert.equal(isInternalOrWhitelistedIp("2606:4700:4700::1111"), true);
});

