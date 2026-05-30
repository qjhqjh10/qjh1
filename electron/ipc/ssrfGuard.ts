// ── SSRF Guard ──
// Shared Server-Side Request Forgery protection module.
// Used by both httpHandlers and browserHandlers to prevent
// internal network access from agent tools.
//
// Two-layer defense:
//   Layer 1: URL string regex matching (fast, catches most cases)
//   Layer 2: DNS resolution + IP range check (catches DNS rebinding)

import { promises as dns } from 'dns'

// RFC 1918 + loopback + link-local — URL-level regex patterns
const BLOCKED_IP_PATTERNS = [
  /^https?:\/\/127\.0\.0\./,
  /^https?:\/\/localhost/,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./, // 172.16-31.x.x
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
]

// RFC 1918 + loopback — IP-level regex patterns (for resolved addresses)
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/,   // IPv6 Unique Local Address
  /^fe80:/,   // IPv6 Link-local
]

/** Layer 1: Fast URL string check for private IPs */
export function isPrivateIP(url: string): boolean {
  return BLOCKED_IP_PATTERNS.some(p => p.test(url))
}

/** Layer 2: DNS-resolve the hostname, then check resolved IPs */
export async function resolvesToPrivateIP(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname
    // Skip DNS for IP literals (already caught by Layer 1)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return isPrivateIP(url)
    if (hostname === 'localhost' || hostname.startsWith('[')) return isPrivateIP(url)
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[])
    return addresses.some(ip => PRIVATE_IP_RANGES.some(r => r.test(ip)))
  } catch {
    // DNS failure — fall back to regex-only check
    return isPrivateIP(url)
  }
}

/** Normalize URL: ensure https:// prefix if missing */
export function sanitizeUrl(url: string): string {
  let u = url.trim()
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u
  }
  return u
}
