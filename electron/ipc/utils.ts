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
  return { key: apiKey, encrypted: false }
}

// ====================== Path Safety ======================

export function isSafePath(inputPath: string, basePath: string): boolean {
  if (!inputPath || typeof inputPath !== 'string') return false
  if (!basePath) return false
  const normalized = path.normalize(inputPath)
  const base = path.normalize(basePath)
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

// ====================== Dialog Helpers ======================

export async function showOpenDialog(win: BrowserWindow | null, opts: Electron.OpenDialogOptions) {
  const { dialog } = await import('electron')
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
}

export async function showSaveDialog(win: BrowserWindow | null, opts: Electron.SaveDialogOptions) {
  const { dialog } = await import('electron')
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
}
