import type { SafeStorage, BrowserWindow } from 'electron'
import * as path from 'path'
import type { ModelConfig } from '../../src/types/settings'
import { logError } from './logger'

// ====================== Encryption ======================
// v13.x 决策：API key 明文存储（safeStorage 加密曾实现后移除）。
// encryptKey/decryptKey 保留为未来能力（decryptKey 被 kb/agent handlers 消费，
// 因 encrypted 恒 false 而原样返回）；saveConfigs 的 MASKED_KEY 保护见 mergeConfigKeys。

export const MASKED_KEY = '••••••••'

/**
 * v16.3.1(审计 D1): OpenAI 兼容 baseURL 归一化——剥离 Anthropic 协议地址形态。
 * 用户配置 apiUrl 为 DeepSeek 官方 Anthropic 端点（https://api.deepseek.com/anthropic 或
 * 完整 /anthropic/v1/messages，如 OpenCode zen/go）时，OpenAI SDK 会拼接成
 * /anthropic/chat/completions → 404。此函数把 Anthropic 路径段剥掉，得到 OpenAI 兼容 base。
 *
 * 规则（路径锚定，只剥 Anthropic 形态，绝不补 /v1）：
 *   trim → 去尾斜杠 → 去 /anthropic 或 /anthropic/xxx 后缀 → 去 /v1/messages 后缀（整体剥离，
 *   与 v15.5 既有 listModels 行为一致）→ 再去尾斜杠
 * 不误伤: api.anthropic.com（主机名非路径段）、/anthropic2、OpenRouter /api/v1、裸 /v1。
 *
 * ⚠️ 消费约定：主进程【所有】OpenAI client 构造点（new OpenAI({baseURL: ...})）必须经本函数
 * 归一化，否则 /anthropic 配置下该通道 404。现有 7 个消费点：ai:chat / ai:chat-stream /
 * ai:chat-with-tools / ai:responses-chat / buildSecondaryClient / ai:listModels /
 * kbHandlers getEmbedding。新增构造点时请沿用（可 grep "new OpenAI(" 核对全量）。
 */
export function normalizeOpenAIBaseURL(apiUrl: string): string {
  return (apiUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/anthropic(\/.*)?$/, '')
    .replace(/\/v1\/messages$/, '')
    .replace(/\/+$/, '')
}

/** 密钥字段清单（与 ModelConfig 的 apiKey/mainApiKey/imageApiKey/secondaryApiKey/embeddingApiKey 一致）。
 * imageApiKey 刻意保留：兼容旧磁盘数据（v16.2.0 迁移后仍可能有旧字段，mergeConfigKeys 需防掩码覆写）。 */
export const KEY_FIELDS = ['apiKey', 'mainApiKey', 'imageApiKey', 'secondaryApiKey', 'embeddingApiKey'] as const

/**
 * H5: 合并密钥字段（三态规则），防止掩码占位符字面量覆写真实密钥：
 * - undefined 或 MASKED_KEY（trim 后）→ 保留旧值（无旧值时为空串）
 * - '' → 清空（用户主动删除）
 * - 其它 → 写入新值
 */
export function mergeConfigKeys(
  oldConfig: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...incoming }
  for (const field of KEY_FIELDS) {
    const v = incoming[field]
    const oldValue = oldConfig && typeof oldConfig[field] === 'string' ? oldConfig[field] : ''
    if (v === undefined) { result[field] = oldValue; continue }
    const trimmed = typeof v === 'string' ? v.trim() : v
    if (trimmed === MASKED_KEY) { result[field] = oldValue; continue }
    result[field] = v
  }
  return result
}

export function decryptKey(apiKey: string, encrypted: boolean, safeStorage: SafeStorage): string {
  if (!apiKey) return ''
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(apiKey, 'base64'))
    } catch {
      // If decryption fails, fall back to raw key (may have been stored plaintext before)
      return apiKey
    }
  }
  return apiKey
}

export function encryptKey(apiKey: string, safeStorage: SafeStorage): { key: string; encrypted: boolean } {
  if (!apiKey) return { key: '', encrypted: false }
  if (apiKey === MASKED_KEY) return { key: apiKey, encrypted: false } // Placeholder, will be handled by caller
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return {
        key: safeStorage.encryptString(apiKey).toString('base64'),
        encrypted: true,
      }
    } catch {
      return { key: apiKey, encrypted: false }
    }
  }
  console.warn('[Security] safeStorage 不可用，API Key 将以明文存储。请确保系统密钥链服务正在运行。')
  return { key: apiKey, encrypted: false }
}

// ====================== Path Safety ======================

export function isSafePath(inputPath: string, basePath: string): boolean {
  if (!inputPath || typeof inputPath !== 'string') return false
  if (!basePath) return false
  const normalized = path.normalize(inputPath).toLowerCase()
  const base = path.normalize(basePath).toLowerCase()
  return normalized.startsWith(base + path.sep) || normalized === base
}

// ====================== OpenAI Lazy Load ======================

let cachedOpenAI: typeof import('openai').default | null = null
export async function getOpenAI(): Promise<typeof import('openai').default> {
  if (!cachedOpenAI) {
    cachedOpenAI = (await import('openai')).default
  }
  return cachedOpenAI
}

// ====================== Config Store ======================

export interface StoredConfig extends Omit<ModelConfig, 'apiKey'> {
  apiKey: string
  encrypted: boolean
}

export type ConfigStore = { get(key: string, defaultValue: StoredConfig[]): StoredConfig[]; set(key: string, value: StoredConfig[]): void }

let sharedStore: ConfigStore | null = null

export async function getConfigStore(): Promise<ConfigStore> {
  if (sharedStore) return sharedStore
  try {
    const { default: Store } = await import('electron-store')
    sharedStore = new Store<{ configs: StoredConfig[] }>({ defaults: { configs: [] } })
  } catch (err) {
    logError('配置存储初始化失败', err)
    let fallbackConfigs: StoredConfig[] = []
    sharedStore = {
      get: (_key: string, defaultValue: StoredConfig[]) => fallbackConfigs.length > 0 ? fallbackConfigs : defaultValue,
      set: (_key: string, value: StoredConfig[]) => { fallbackConfigs = value },
    }
  }
  return sharedStore
}

// ====================== Window Bounds ======================

export interface WindowBounds { x?: number; y?: number; width: number; height: number; isMaximized: boolean }
const DEFAULT_BOUNDS: WindowBounds = { width: 1400, height: 900, isMaximized: false }

export async function loadWindowBounds(): Promise<WindowBounds> {
  try {
    const store = await getConfigStore()
    return (store as any).get('windowBounds', DEFAULT_BOUNDS) as WindowBounds
  } catch { return DEFAULT_BOUNDS }
}

export async function saveWindowBounds(bounds: WindowBounds): Promise<void> {
  try {
    const store = await getConfigStore()
    ;(store as any).set('windowBounds', bounds)
  } catch { /* ignore */ }
}

// ====================== Encoding Detection ======================

function detectEncoding(buf: Buffer): string {
  try {
    const jschardet = require('jschardet')
    const result = jschardet.detect(buf)
    if (result && result.encoding && result.confidence > 0.7) {
      const enc = result.encoding.toLowerCase()
      if (enc === 'gb2312' || enc === 'gbk' || enc === 'gb18030') return 'gbk'
      if (enc === 'utf-8' || enc === 'ascii') return 'utf-8'
      if (enc === 'big5') return 'big5'
      return enc
    }
  } catch { /* jschardet unavailable */ }
  return 'utf-8'
}

export async function readFileWithEncoding(filePath: string): Promise<string> {
  const fs = await import('fs/promises')
  const buf = await fs.readFile(filePath)
  if (buf.length === 0) return ''

  // Check for UTF-8 BOM
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf-8', 3)
  }
  // Check for UTF-16 LE BOM
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf-16le', 2)
  }

  const encoding = detectEncoding(buf)
  if (encoding === 'utf-8') {
    return buf.toString('utf-8')
  }

  try {
    const iconv = require('iconv-lite')
    return iconv.decode(buf, encoding)
  } catch {
    return buf.toString('utf-8')
  }
}

// ====================== Dialog Helpers ======================

export async function showOpenDialog(win: BrowserWindow | null, opts: Electron.OpenDialogOptions) {
  const { dialog } = await import('electron')
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
}

export async function showSaveDialog(win: BrowserWindow | null, opts: Electron.SaveDialogOptions) {
  const { dialog } = await import('electron')
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
}

// ── 共享工具（v13.x: 从 aiHandlers/anthropicHandlers 抽取，消除重复）──

/** ISO timestamp with local timezone offset (e.g. 2026-05-31T10:34:09+08:00) */
export function localISOString(): string {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + 'T' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds()) + sign +
    pad(Math.floor(off / 60)) + ':' +
    pad(off % 60)
}

/** 费用计算（OpenAI/Anthropic 双协议共用） */
export function calculateCost(inputTokens: number, outputTokens: number, cacheHitTokens: number, config: StoredConfig): number {
  const effectiveInput = Math.max(0, inputTokens - cacheHitTokens)
  const inputPrice = config.inputPricePerM ?? 0
  const cachePrice = config.cacheHitPricePerM ?? 0
  const outputPrice = config.outputPricePerM ?? 0
  // #17: If all prices are zero, return -0.001 to signal "unset" (won't affect display much but flags it)
  const inputCost = (effectiveInput * inputPrice) / 1_000_000
  const cacheCost = (cacheHitTokens * cachePrice) / 1_000_000
  const outputCost = (outputTokens * outputPrice) / 1_000_000
  return inputCost + cacheCost + outputCost
}
