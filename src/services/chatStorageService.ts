// ── Chat Storage Service (V9.5.2 hardened) ──
// IndexedDB primary + file mirror + file backup + localStorage fallback.
//
// 三层防护：
// 1. 写前备份 — save 前先把旧数据存为 .bak
// 2. 空数据拒绝 — 如果新数据只有 1 个默认对话且备份有更多数据，拒绝覆盖
// 3. 恢复链 — IndexedDB → file → file.bak → localStorage migration

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

// ── File path helpers (use Electron userData, not projectsBasePath) ──

// Cache storage dir after first successful lookup
let _cachedStorageDir: string | null | undefined

async function getStorageDir(): Promise<string | null> {
  // Return cached value if already resolved
  if (_cachedStorageDir !== undefined) return _cachedStorageDir

  // Path 1: projectsBasePath → strip /projects → append /.appdata
  // This path must match globalAppDataPath in fileHandlers.ts resolvePath whitelist
  try {
    const { useStore } = await import('@/store')
    const base = useStore.getState().projectsBasePath
    if (base) {
      const appDir = base.replace(/[/\\]projects[/\\]?$/, '')
      if (appDir && appDir !== base) {
        _cachedStorageDir = appDir + '/.appdata'
        return _cachedStorageDir
      }
    }
  } catch {}

  // Path 2: fallback via Electron IPC (works when store not yet initialized)
  try {
    const { appService } = await import('@/services/fileService')
    const base = await appService?.getProjectsBasePath?.()
    if (base) {
      const appDir = base.replace(/[/\\]projects[/\\]?$/, '')
      if (appDir && appDir !== base) {
        _cachedStorageDir = appDir + '/.appdata'
        return _cachedStorageDir
      }
    }
  } catch {}

  return null
}

async function writeFile(filePath: string, content: string): Promise<void> {
  try {
    const { fileService } = await import('@/services/fileService')
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    await fileService.ensureDir(dir)
    await fileService.write(filePath, content)
  } catch {}
}

async function readFile(filePath: string): Promise<string | null> {
  try {
    const { fileService } = await import('@/services/fileService')
    return await fileService.read(filePath)
  } catch {
    return null
  }
}

// ── Primary Save/Load ──

/** Save conversations with write-ahead backup */
export async function saveConversations(conversations: Conversation[]): Promise<void> {
  const dir = await getStorageDir()
  const filePath = dir ? dir + '/chat-conversations.json' : null

  // ── 防护 1: 写前备份 — 先把现有数据复制到 .bak ──
  if (filePath) {
    const existing = await readFile(filePath)
    if (existing && existing.length > 500) {
      // Only back up if existing data is substantial (>500 bytes, i.e. more than just default)
      await writeFile(filePath + '.bak', existing)
    }
  }

  // ── 防护 2: 空数据拒绝 — 如果新数据太小而备份很大，拒绝覆盖 ──
  const newDataSize = JSON.stringify(conversations).length
  const hasOnlyDefault = conversations.length === 1
    && conversations[0].messages.length <= 1
    && conversations[0].id === 'default'

  if (hasOnlyDefault && filePath) {
    const bakContent = await readFile(filePath + '.bak')
    if (bakContent && bakContent.length > newDataSize * 2) {
      console.warn('[ChatStorage] 拒绝覆盖：新数据仅有默认对话，备份有', bakContent.length, '字节')
      return // Do NOT overwrite real data with empty default
    }
  }

  // Save to IndexedDB
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

  // Mirror to file
  if (filePath) {
    await writeFile(filePath, JSON.stringify(conversations))
    // Human-readable mirror — for CLI debugging
    let log = ''
    for (const conv of conversations) {
      log += `\n══════ ${conv.title} (${conv.id}) ══════\n`
      for (const m of conv.messages) {
        if (m.displayOnly || m.compressedSummary) continue
        const time = m.timestamp ? new Date(m.timestamp).toLocaleString('zh-CN') : '未知时间'
        const role = m.role === 'user' ? '👤 用户' : m.role === 'assistant' ? '🤖 AI' : `🔧 ${m.role}`
        log += `\n[${time}] ${role}\n${(m.content || '').slice(0, 500)}\n`
      }
    }
    await writeFile(filePath.replace('.json', '.txt'), log)
  }
}

/** Load conversations: IndexedDB → file → file.bak → localStorage */
export async function loadConversations(): Promise<Conversation[]> {
  // 1. IndexedDB
  try {
    const db = await getDb()
    const result = await new Promise<Conversation[] | undefined>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CONV_KEY)
      req.onsuccess = () => resolve(req.result as Conversation[] | undefined)
      req.onerror = () => reject(req.error)
    })
    if (result && result.length > 0) return result
  } catch { /* fall through */ }

  // 2. File mirror
  const dir = await getStorageDir()
  if (dir) {
    const content = await readFile(dir + '/chat-conversations.json')
    if (content) {
      try {
        const parsed = JSON.parse(content) as Conversation[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          saveConversations(parsed).catch(() => {}) // restore to IndexedDB
          return parsed
        }
      } catch {}
    }
  }

  // ── 恢复链: 3. .bak 备份 ──
  if (dir) {
    const bakContent = await readFile(dir + '/chat-conversations.json.bak')
    if (bakContent) {
      try {
        const parsed = JSON.parse(bakContent) as Conversation[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.warn('[ChatStorage] 从 .bak 备份恢复对话，原数据可能已损坏')
          saveConversations(parsed).catch(() => {})
          return parsed
        }
      } catch {}
    }
  }

  // 4. localStorage migration (one-time)
  return migrateFromLocalStorage()
}

// ── Last Active ID ──

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

    await saveConversations(parsed)
    const lastActive = localStorage.getItem(LS_LAST_ACTIVE)
    if (lastActive) await saveLastActiveId(lastActive)

    localStorage.setItem(MIGRATED_KEY, '1')
    return parsed
  } catch { return [] }
}

export function finalizeMigration(): void {
  if (localStorage.getItem(MIGRATED_KEY) === '1') {
    localStorage.removeItem(LS_STORAGE_KEY)
    localStorage.removeItem(LS_LAST_ACTIVE)
  }
}

/** Get the file path where conversations are mirrored */
export async function getConversationFilePath(): Promise<string> {
  const dir = await getStorageDir()
  return dir ? dir + '/chat-conversations.json' : ''
}
