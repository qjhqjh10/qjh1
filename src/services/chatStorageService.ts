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

// v14.5.0: 防抖保存状态（尾随 800ms + 合并 + 串行化）。
// 原实现每次 conversations 变化都做 5 次全量 IO（写前备份→IDB put→json 镜像→txt 镜像），
// 每追加一条消息就全量写一遍；防抖后高频更新合并为一次。
const SAVE_DEBOUNCE_MS = 800
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Conversation[] | null = null
let inFlight: Promise<void> | null = null
let saveWaiters: Array<(ok: { idbOk: boolean }) => void> = []

/** 底层保存（原 saveConversations 函数体）——写前备份→IDB→文件镜像 */
async function doSave(conversations: Conversation[]): Promise<{ idbOk: boolean }> {
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
      return { idbOk: true } // 拒绝覆盖（数据未变），非写入失败
    }
  }

  // Save to IndexedDB
  let idbOk = true
  try {
    const db = await getDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(conversations, CONV_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    idbOk = false  // v14.5.0: 上报 IDB 失败（文件镜像仍在写，数据不丢）
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
  return { idbOk }
}

/**
 * v14.5.0: 防抖保存 — 尾随 800ms 合并高频更新，串行化避免并发全量写。
 * 返回的 promise 在本次（合并后的）保存完成后 resolve，调用方 await 语义不变。
 */
export async function saveConversations(conversations: Conversation[]): Promise<{ idbOk: boolean }> {
  pendingSave = conversations
  const result = new Promise<{ idbOk: boolean }>(resolve => saveWaiters.push(resolve))
  if (!saveTimer && !inFlight) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      const data = pendingSave!
      pendingSave = null
      inFlight = doSave(data).then(ok => {
        // 通知所有等待者（合并语义：等待者拿到的是本次合并保存的结果）
        const ws = saveWaiters
        saveWaiters = []
        for (const w of ws) w(ok)
      }).catch(e => {
        // v14.5.0: doSave 内部已 try/catch 大部分路径，但 JSON.stringify/镜像循环等仍可 reject——
        // 吞掉 rejection 并通知等待者（否则该批次 await saveConversations 的调用方永久挂起）
        console.warn('[ChatStorage] save failed:', e)
        const ws = saveWaiters
        saveWaiters = []
        for (const w of ws) w({ idbOk: false })
      }).finally(() => {
        inFlight = null
        // 保存期间又有新更新 → 调度下一轮
        if (pendingSave) saveConversations(pendingSave)
      })
    }, SAVE_DEBOUNCE_MS)
  }
  return result
}

/**
 * v14.9(A7): 退出前冲刷挂起保存——尾随防抖期间关窗/刷新会丢最后 800ms 内的消息。
 * pagehide/beforeunload 无法 await IndexedDB，此处 fire-and-forget 尽力落盘（文件镜像同步执行）。
 */
export function flushPendingSave(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (pendingSave && !inFlight) {
    const data = pendingSave
    pendingSave = null
    inFlight = doSave(data).then(ok => {
      const ws = saveWaiters
      saveWaiters = []
      for (const w of ws) w(ok)
    }).catch(e => {
      console.warn('[ChatStorage] flush save failed:', e)
      const ws = saveWaiters
      saveWaiters = []
      for (const w of ws) w({ idbOk: false })
    }).finally(() => {
      inFlight = null
      if (pendingSave) saveConversations(pendingSave)
    })
  }
}

/**
 * v14.5.0: 合并加载结果与本地状态 — IndexedDB 异步加载完成时无条件覆盖会丢掉
 * 加载完成前用户已发送的消息；此函数保留本地新建/更新的对话。
 */
export function mergeConversations(stored: Conversation[], local: Conversation[]): Conversation[] {
  const merged = [...stored]
  for (const c of local) {
    const i = merged.findIndex(x => x.id === c.id)
    if (i === -1) {
      merged.push(c)  // 本地新建的对话保留
    } else if (c.messages.length > merged[i].messages.length) {
      merged[i] = c   // 本地更新的消息保留
    }
  }
  return merged
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
