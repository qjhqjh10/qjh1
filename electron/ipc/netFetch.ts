// ── netFetch: 主进程统一网络栈（v14.6.1）──
// 原实现全部用 Node 全局 fetch（undici）——不读 Windows 系统代理、不用 Windows 证书存储。
// 软件打包分享给他人后：
//   1. 公司/校园网（HTTP/SOCKS 代理环境）→ API 连接失败（undici 忽略系统代理设置）
//   2. MITM 代理证书（企业监控/抓包工具）→ TLS 证书校验失败（undici 用 Node CA，非系统证书库）
// Electron net.fetch 走 Chromium 网络栈：自动使用系统代理 + 系统证书存储，与浏览器行为一致。
// 测试/非 Electron 环境回退全局 fetch（vitest mock 路径不受影响）。

import { net } from 'electron'

let resolvedFetch: typeof fetch | null = null

function resolveFetch(): typeof fetch {
  if (resolvedFetch) return resolvedFetch
  try {
    if (net && typeof net.fetch === 'function') {
      resolvedFetch = net.fetch.bind(net) as typeof fetch
      return resolvedFetch
    }
  } catch { /* 非 Electron 环境（测试） */ }
  resolvedFetch = globalThis.fetch
  return resolvedFetch
}

export function netFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return resolveFetch()(input as never, init as never)
}
