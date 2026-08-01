// H8: files:saveImageUrl 防护 — URL 校验 / data URL 解析 / MIME 映射
// 说明: 公网 URL 的 DNS 校验（resolvesToPrivateIP）依赖真实网络，测试只覆盖
// 私网正则层与协议白名单（不走 DNS 的路径）。
import { describe, it, expect } from 'vitest'
import { parseDataImageUrl, mimeToExt, validateRemoteImageUrl } from '../fileHandlers'

describe('parseDataImageUrl (H8)', () => {
  it('解析合法 data:image URL', () => {
    const parsed = parseDataImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA')
    expect(parsed).toEqual({ mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAA' })
  })

  it('拒绝非 base64 data URL（无 ;base64, 段）', () => {
    expect(parseDataImageUrl('data:image/png,rawdata')).toBeNull()
  })

  it('拒绝空 base64', () => {
    expect(parseDataImageUrl('data:image/png;base64,')).toBeNull()
  })

  it('拒绝非 image/* MIME', () => {
    expect(parseDataImageUrl('data:text/html;base64,aGk=')).toBeNull()
  })

  it('拒绝含非法字符的 base64（如换行/空格）', () => {
    expect(parseDataImageUrl('data:image/png;base64,aGk=\nabc')).toBeNull()
  })
})

describe('mimeToExt (H8)', () => {
  it('svg+xml 映射为 svg（不再产出 .svg+xml 文件名）', () => {
    expect(mimeToExt('image/svg+xml')).toBe('svg')
  })

  it('jpeg 映射为 jpg', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg')
  })

  it('常见格式直通', () => {
    expect(mimeToExt('image/png')).toBe('png')
    expect(mimeToExt('image/webp')).toBe('webp')
    expect(mimeToExt('image/gif')).toBe('gif')
  })

  it('未知格式回退 png', () => {
    expect(mimeToExt('image/x-unknown')).toBe('png')
  })
})

describe('validateRemoteImageUrl (H8)', () => {
  it('拒绝内网/本地地址（Layer 1 正则层）', async () => {
    expect(await validateRemoteImageUrl('http://127.0.0.1/x.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://localhost/img.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://192.168.1.1/a.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://10.0.0.5/a.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://[::1]/a.png')).toBe(false)
  })

  it('拒绝 IPv6 私网地址（IPv4-mapped/未指定/ULA/链路本地）', async () => {
    // 审查发现: hostname.startsWith('[') 短路 + Layer 1 只覆盖 [::1] → 全部可绕过
    expect(await validateRemoteImageUrl('http://[::ffff:127.0.0.1]:8080/x.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://[::ffff:7f00:1]:8080/x.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://[::]:8080/')).toBe(false)
    expect(await validateRemoteImageUrl('http://[fe80::1]/a.png')).toBe(false)
    expect(await validateRemoteImageUrl('http://[fc00::1]/a.png')).toBe(false)
  })

  it('拒绝非 http(s) 协议', async () => {
    expect(await validateRemoteImageUrl('ftp://example.com/a.png')).toBe(false)
    expect(await validateRemoteImageUrl('file:///etc/passwd')).toBe(false)
    expect(await validateRemoteImageUrl('data:image/png;base64,aGk=')).toBe(false)
  })

  it('拒绝非 URL 输入', async () => {
    expect(await validateRemoteImageUrl('not a url')).toBe(false)
    expect(await validateRemoteImageUrl('')).toBe(false)
  })

  it('允许公网 https URL（不验证 DNS 解析结果，仅结构）', async () => {
    // 仅当 hostname 不是 IP 字面量且未被 Layer 1 命中时才走到 DNS ——
    // 这里用假的公网域名验证返回布尔而非抛异常
    const result = await validateRemoteImageUrl('https://cdn.invalid-domain-for-test-xyz.example/a.png')
    expect(typeof result).toBe('boolean')
  })
})
