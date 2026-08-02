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
  /^https?:\/\/169\.254\./,  // v14.9(D1): link-local（云元数据 169.254.169.254）
  /^https?:\/\/\[::1\]/,
]

// RFC 1918 + loopback + link-local + 云元数据段 — IP-level regex patterns (for resolved addresses)
// v14.9(D1): 补 169.254.0.0/16——云元数据 169.254.169.254 可达（此前缺段；IPv6 私网 fd00:: 仅 fe80/fc00 覆盖，
// fd00::/8 ULA 范围过大未拦，个人使用风险低，留待需要时）
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./,  // link-local 含云元数据 169.254.169.254
  /^::1$/,
  /^::$/,     // IPv6 未指定地址 (0.0.0.0 等价)
  /^fc00:/,   // IPv6 Unique Local Address
  /^fe80:/,   // IPv6 Link-local
]

/** Layer 1: Fast URL string check for private IPs */
export function isPrivateIP(url: string): boolean {
  return BLOCKED_IP_PATTERNS.some(p => p.test(url))
}

/** IPv4-mapped IPv6（::ffff:127.0.0.1 / ::ffff:7f00:1）→ 提取内嵌 IPv4 检查私网 */
function isPrivateIPv4Mapped(ipv6: string): boolean {
  const m = ipv6.match(/^::ffff:([0-9a-f.:]+)$/i)
  if (!m) return false
  const inner = m[1]
  // 点分十进制形式（WHATWG URL 部分实现保留）
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(inner)) {
    return PRIVATE_IP_RANGES.some(r => r.test(inner))
  }
  // hex 形式（Node URL 归一化输出，如 ::ffff:7f00:1）→ 各段补 4 位零后取后 8 位 hex 还原 IPv4
  const hex = inner.split(':').map(s => s.padStart(4, '0')).join('').slice(-8)
  const n = parseInt(hex, 16)
  if (isNaN(n)) return false
  const v4 = `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`
  return PRIVATE_IP_RANGES.some(r => r.test(v4))
}

/** Layer 2: DNS-resolve the hostname, then check resolved IPs */
export async function resolvesToPrivateIP(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname
    // Skip DNS for IP literals (already caught by Layer 1)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return isPrivateIP(url)
    if (hostname === 'localhost') return isPrivateIP(url)
    if (hostname.startsWith('[')) {
      // IPv6 字面量：Layer 1 只覆盖 [::1]，这里剥括号后完整检查
      const ipv6 = hostname.replace(/^\[|\]$/g, '')
      if (isPrivateIPv4Mapped(ipv6)) return true
      return PRIVATE_IP_RANGES.some(r => r.test(ipv6))
    }
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
