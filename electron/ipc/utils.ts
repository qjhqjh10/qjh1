import type { SafeStorage, BrowserWindow } from 'electron'
import * as path from 'path'
import type { ModelConfig } from '../../src/types/settings'
import { logError } from './logger'

// ====================== Encryption ======================

export const MASKED_KEY = '••••••••'

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
