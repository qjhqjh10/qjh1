// ── Chat Storage Service ──
// IndexedDB-based conversation persistence with localStorage migration and file fallback.
// Replaces the localStorage-only approach in AIChatWindow.

import type { Conversation } from '@/components/ai/chat/types'

const DB_NAME = 'qingjian-chat'
const DB_VERSION = 1
const STORE_NAME = 'conversations'
const CONV_KEY = 'all-conversations'
const MIGRATED_KEY = 'chat-storage-migrated'

// localStorage keys (for migration)
const LS_STORAGE_KEY = 'ai-chat-conversations'
const LS_LAST_ACTIVE = 'ai-chat-last-active'

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/** Save conversations to IndexedDB + always mirror to file for inspection */
export async function saveConversations(conversations: Conversation[]): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(conversations, CONV_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('[ChatStorage] IndexedDB save failed:', e)
  }
  // Always mirror to file — enables terminal inspection via `cat .appdata/chat-conversations.json`
  saveToFile(conversations).catch(() => {})
}

/** Load conversations: IndexedDB → file fallback → localStorage migration */
export async function loadConversations(): Promise<Conversation[]> {
  // 1. Try IndexedDB
  try {
    const db = await getDb()
    const result = await new Promise<Conversation[] | undefined>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CONV_KEY)
      req.onsuccess = () => resolve(req.result as Conversation[] | undefined)
      req.onerror = () => reject(req.error)
    })
    if (result && result.length > 0) return result
  } catch { /* fall through to next strategy */ }

  // 2. Try file fallback
  try {
    const fileData = await loadFromFile()
    if (fileData && fileData.length > 0) {
      // Restore to IndexedDB
      saveConversations(fileData).catch(() => {})
      return fileData
    }
  } catch { /* fall through to migration */ }

  // 3. Migrate from localStorage (one-time)
  return migrateFromLocalStorage()
}

/** Save last active conversation ID */
export async function saveLastActiveId(id: string): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(id, 'last-active')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* non-critical */ }
}

/** Load last active conversation ID */
export async function loadLastActiveId(): Promise<string | null> {
  try {
    const db = await getDb()
    const result = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('last-active')
      req.onsuccess = () => resolve(req.result as string | undefined)
      req.onerror = () => reject(req.error)
    })
    return result || null
  } catch { return null }
}

// ── Migration ──

async function migrateFromLocalStorage(): Promise<Conversation[]> {
  try {
    const raw = localStorage.getItem(LS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return []

    // Save to IndexedDB
    await saveConversations(parsed)
    // Save last active
    const lastActive = localStorage.getItem(LS_LAST_ACTIVE)
    if (lastActive) await saveLastActiveId(lastActive)

    // Mark migration complete, then clear localStorage (delayed)
    localStorage.setItem(MIGRATED_KEY, '1')
    return parsed
  } catch { return [] }
}

/** Check if migration has been done and clear old localStorage data */
export function finalizeMigration(): void {
  if (localStorage.getItem(MIGRATED_KEY) === '1') {
    localStorage.removeItem(LS_STORAGE_KEY)
    localStorage.removeItem(LS_LAST_ACTIVE)
  }
}

// ── File Fallback ──

async function getAppDataPath(): Promise<string | null> {
  try {
    const { useStore } = await import('@/store')
    const base = useStore.getState().projectsBasePath || ''
    if (!base) return null // No project loaded yet — skip file save
    const appDir = base.replace(/[/\\]projects[/\\]?$/, '')
    if (!appDir || appDir === base) return null // Can't resolve parent dir
    return `${appDir}/.appdata`
  } catch { return null }
}

/** Get the file path where conversations are mirrored — useful for terminal inspection */
export async function getConversationFilePath(): Promise<string> {
  const dir = await getAppDataPath()
  return dir ? `${dir}/chat-conversations.json` : ''
}

async function saveToFile(conversations: Conversation[]): Promise<void> {
  try {
    const dir = await getAppDataPath()
    if (!dir) return
    const { fileService } = await import('@/services/fileService')
    await fileService.ensureDir(dir)
    await fileService.write(`${dir}/chat-conversations.json`, JSON.stringify(conversations))
  } catch (e) { /* non-critical — IndexedDB is primary store */ }
}

async function loadFromFile(): Promise<Conversation[] | null> {
  try {
    const { fileService } = await import('@/services/fileService')
    const dir = await getAppDataPath()
    const raw = await fileService.read(`${dir}/chat-conversations.json`)
    if (raw) return JSON.parse(raw) as Conversation[]
  } catch { /* not found */ }
  return null
}
