import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { isSafePath, readFileWithEncoding } from './utils'

export interface ToolCallArgs {
  callId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolCallResult {
  callId: string
  toolName: string
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
  confirmArgs?: Record<string, unknown>
}

const MAX_READ_CHARS = 500_000
const MAX_WRITE_CHARS = 500_000
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB for edit/backup
const MAX_SEARCH_RESULTS = 200
const BACKUP_DIR = '.ai_backups'
const MAX_BACKUPS_PER_FILE = 10
const BACKUP_SEPARATOR = '___'

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// ── Safe path resolution (Issue #1 #5 #19) ──

/** Resolve a tool argument to an absolute path, with ../ stripping and realpath verification */
async function safeResolve(
  key: string,
  args: Record<string, unknown>,
  projectPath: string,
): Promise<string | null> {
  const raw = args[key]
  if (typeof raw !== 'string' || raw.length === 0) {
    return projectPath // For dir_path, default to project root
  }
  // Normalize slashes and strip leading slash
  let clean = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  // Loop until no more ../ patterns remain (Issue #1: multi-pass defense against ....// bypass)
  let prev = ''
  while (prev !== clean) {
    prev = clean
    clean = clean.replace(/\.\.\//g, '')
  }
  // Strip bare ".." at boundaries
  clean = clean.replace(/\/\.\.$/, '').replace(/^\.\.$/, '')
  const joined = path.join(projectPath, clean)
  if (!isSafePath(joined, projectPath)) return null
  // Resolve symlinks to get real path, then re-check (Issue #5)
  try {
    const real = await fsp.realpath(joined)
    if (!isSafePath(real, projectPath)) return null
    return real
  } catch {
    // File doesn't exist yet (e.g., create_file) — return joined path as-is
    return joined
  }
}

/** Non-async path resolution without realpath (for create_file where target doesn't exist yet) */
function resolveArgNoRealpath(
  key: string,
  args: Record<string, unknown>,
  projectPath: string,
): string | null {
  const raw = args[key]
  if (typeof raw !== 'string' || raw.length === 0) return null
  let clean = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  let prev = ''
  while (prev !== clean) {
    prev = clean
    clean = clean.replace(/\.\.\//g, '')
  }
  clean = clean.replace(/\/\.\.$/, '').replace(/^\.\.$/, '')
  const joined = path.join(projectPath, clean)
  if (!isSafePath(joined, projectPath)) return null
  return joined
}

// ── Backup helpers (Issue #7: file-level lock) ──

interface BackupEntry {
  fullPath: string
  relativePath: string
  timestamp: string
  originalName: string
}

function parseBackupName(backupFileName: string): { timestamp: string; originalName: string } | null {
  const idx = backupFileName.indexOf(BACKUP_SEPARATOR)
  if (idx === -1) return null
  return {
    timestamp: backupFileName.slice(0, idx),
    originalName: backupFileName.slice(idx + BACKUP_SEPARATOR.length),
  }
}

function makeBackupName(originalName: string): string {
  return `${timestamp()}${BACKUP_SEPARATOR}${originalName}`
}

const backupLocks = new Map<string, Promise<void>>()

async function listBackupsForFile(
  originalFilePath: string,
  projectPath: string,
): Promise<BackupEntry[]> {
  const backupDir = path.join(projectPath, BACKUP_DIR)
  const originalName = path.basename(originalFilePath)
  const results: BackupEntry[] = []

  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(backupDir, { withFileTypes: true }) } catch { return results }

  for (const e of entries) {
    if (!e.isFile()) continue
    const parsed = parseBackupName(e.name)
    if (parsed && parsed.originalName === originalName) {
      results.push({
        fullPath: path.join(backupDir, e.name),
        relativePath: `${BACKUP_DIR}/${e.name}`,
        timestamp: parsed.timestamp,
        originalName: parsed.originalName,
      })
    }
  }

  results.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return results
}

/**
 * Smart backup with dedup, retention, and file-level locking (Issues #7 #12).
 */
async function backupFile(filePath: string, projectPath: string): Promise<string> {
  // File-level lock to prevent race conditions (Issue #7)
  const lockKey = path.resolve(filePath)
  const prevLock = backupLocks.get(lockKey)
  if (prevLock) await prevLock.catch(() => {})

  let releaseLock: () => void
  const lock = new Promise<void>(resolve => { releaseLock = resolve })
  backupLocks.set(lockKey, lock)

  try {
    const backupDir = path.join(projectPath, BACKUP_DIR)
    await fsp.mkdir(backupDir, { recursive: true })

    // Size check (Issue #12)
    const stat = await fsp.stat(filePath)
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB，上限 10MB)，无法创建备份`)
    }

    const currentContent = await readFileWithEncoding(filePath)

    // Dedup: skip if identical to latest backup
    const existing = await listBackupsForFile(filePath, projectPath)
    if (existing.length > 0) {
      const latest = existing[existing.length - 1]
      try {
        const latestContent = await readFileWithEncoding(latest.fullPath)
        if (latestContent === currentContent) {
          return latest.relativePath
        }
      } catch { /* unreadable, create new */ }
    }

    const backupName = makeBackupName(path.basename(filePath))
    const backupPath = path.join(backupDir, backupName)
    await fsp.copyFile(filePath, backupPath)

    const relPath = `${BACKUP_DIR}/${backupName}`

    // Prune old backups beyond limit
    const afterPrune = [...existing, {
      fullPath: backupPath, relativePath: relPath,
      timestamp: timestamp(), originalName: path.basename(filePath),
    }]
    afterPrune.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    if (afterPrune.length > MAX_BACKUPS_PER_FILE) {
      const toDelete = afterPrune.slice(0, afterPrune.length - MAX_BACKUPS_PER_FILE)
      for (const old of toDelete) {
        await fsp.unlink(old.fullPath).catch(() => {})
      }
    }

    return relPath
  } finally {
    releaseLock!()
    backupLocks.delete(lockKey)
  }
}

// ── Safe recursive walk (Issue #5: symlink + safe-path checks) ──

type WalkVisitor = (fullPath: string, entry: fs.Dirent) => Promise<boolean | void> // return true to stop

async function safeWalk(
  dirPath: string,
  projectPath: string,
  visitor: WalkVisitor,
): Promise<void> {
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }) } catch { return }

  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dirPath, e.name)

    // Issue #5: Skip symbolic links
    if (e.isSymbolicLink()) continue

    // Issue #5: Recursive isSafePath check
    if (!isSafePath(full, projectPath)) continue

    const shouldStop = await visitor(full, e)
    if (shouldStop) return

    if (e.isDirectory()) {
      await safeWalk(full, projectPath, visitor)
    }
  }
}

// ── Core executor ──

export async function executeFileTool(
  call: ToolCallArgs,
  projectPath: string,
): Promise<ToolCallResult> {
  const { callId, toolName, args } = call

  // Quick path-resolution helper (used for cases that don't need realpath)
  const resolvePath = (key: string): string | null =>
    resolveArgNoRealpath(key, args, projectPath)

  try {
    switch (toolName) {

      // ── Read-only ──

      case 'list_directory': {
        const dir = resolvePath('dir_path') || projectPath
        if (!isSafePath(dir, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
        let entries: fs.Dirent[]
        try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch {
          return { callId, toolName, status: 'success', summary: '0 个项目', detail: '(目录不存在或为空)' }
        }
        const items = entries.map(e => {
          const prefix = e.isSymbolicLink() ? '[LINK]' : e.isDirectory() ? '[DIR] ' : '[FILE]'
          return `${prefix} ${e.name}${e.isDirectory() && !e.isSymbolicLink() ? '/' : ''}`
        })
        const detail = items.length > 0 ? items.join('\n') : '(空目录)'
        return { callId, toolName, status: 'success', summary: `${entries.length} 个项目`, detail }
      }

      case 'read_file': {
        const fp = await safeResolve('file_path', args, projectPath)
        if (!fp) return deny(callId, toolName, '路径不在项目目录内')
        let content: string
        try { content = await readFileWithEncoding(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}` }
        }
        const truncated = content.length > MAX_READ_CHARS
          ? content.slice(0, MAX_READ_CHARS) + `\n\n... (内容过长，已截断至 ${MAX_READ_CHARS} 字符)`
          : content
        return { callId, toolName, status: 'success', summary: `${content.length} 字符`, detail: truncated }
      }

      case 'search_files': {
        const dir = args.dir_path ? (resolvePath('dir_path') || projectPath) : projectPath
        if (!isSafePath(dir, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
        const keyword = (args.keyword as string || '').toLowerCase()
        if (!keyword) return deny(callId, toolName, '缺少搜索关键词')
        const results: string[] = []
        await safeWalk(dir, projectPath, async (fullPath, entry) => {
          if (!entry.isDirectory() && entry.name.toLowerCase().includes(keyword)) {
            results.push(path.relative(projectPath, fullPath).replace(/\\/g, '/'))
            if (results.length >= MAX_SEARCH_RESULTS) return true // stop
          }
        })
        const detail = results.length > 0 ? results.join('\n') : '未找到匹配文件'
        return { callId, toolName, status: 'success', summary: `${results.length} 个匹配文件`, detail }
      }

      case 'search_content': {
        // Issue #13: Use dir_path parameter (align with search_files)
        const dir = args.dir_path ? (resolvePath('dir_path') || projectPath) : projectPath
        if (!isSafePath(dir, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
        const pattern = args.pattern as string
        if (!pattern) return deny(callId, toolName, '缺少搜索内容')
        const filePattern = (args.file_pattern as string) || '*'
        const ext = filePattern.replace('*', '')
        const results: string[] = []
        await safeWalk(dir, projectPath, async (fullPath, entry) => {
          if (entry.isDirectory()) return
          if (!ext || entry.name.endsWith(ext)) {
            try {
              const content = await readFileWithEncoding(fullPath)
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(pattern)) {
                  const rel = path.relative(projectPath, fullPath).replace(/\\/g, '/')
                  results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
                  if (results.length >= MAX_SEARCH_RESULTS) return true // stop
                }
              }
            } catch { /* skip binary */ }
          }
        })
        const detail = results.length > 0 ? results.join('\n') : '未找到匹配内容'
        return { callId, toolName, status: 'success', summary: `${results.length} 处匹配`, detail }
      }

      // ── Backup listing ──

      case 'list_backups': {
        const targetFile = args.file_path as string | undefined
        const backupDir = path.join(projectPath, BACKUP_DIR)

        if (targetFile) {
          const fp = resolvePath('file_path')
          if (!fp || !isSafePath(fp, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
          const backups = await listBackupsForFile(fp, projectPath)
          if (backups.length === 0) {
            return { callId, toolName, status: 'success', summary: `无备份: ${targetFile}`, detail: '该文件没有备份记录' }
          }
          const detail = backups.map((b, i) =>
            `[${i + 1}] ${b.timestamp} — 备份路径: ${b.relativePath}`,
          ).join('\n')
          return { callId, toolName, status: 'success', summary: `${backups.length} 份备份 (上限${MAX_BACKUPS_PER_FILE})`, detail }
        }

        // List all backups grouped by original file
        const groups = new Map<string, BackupEntry[]>()
        let allEntries: fs.Dirent[]
        try { allEntries = await fsp.readdir(backupDir, { withFileTypes: true }) } catch {
          return { callId, toolName, status: 'success', summary: '无备份', detail: '备份目录为空或不存在' }
        }
        for (const e of allEntries) {
          if (!e.isFile()) continue
          const parsed = parseBackupName(e.name)
          if (!parsed) continue
          const entry: BackupEntry = {
            fullPath: path.join(backupDir, e.name),
            relativePath: `${BACKUP_DIR}/${e.name}`,
            timestamp: parsed.timestamp,
            originalName: parsed.originalName,
          }
          const group = groups.get(parsed.originalName) || []
          group.push(entry)
          groups.set(parsed.originalName, group)
        }

        if (groups.size === 0) {
          return { callId, toolName, status: 'success', summary: '无备份', detail: '备份目录为空' }
        }

        const lines: string[] = []
        for (const [origName, entries] of groups) {
          entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          lines.push(`📄 ${origName} (${entries.length} 份):`)
          for (const e of entries) {
            lines.push(`    ${e.timestamp} — ${e.relativePath}`)
          }
        }
        return { callId, toolName, status: 'success', summary: `${groups.size} 个文件共 ${lines.length - groups.size} 份备份`, detail: lines.join('\n') }
      }

      // ── Write operations ──

      case 'create_file': {
        const fp = resolvePath('file_path')
        if (!fp || !isSafePath(fp, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
        const content = args.content as string
        // Issue #12: Size limit for writes
        if (content.length > MAX_WRITE_CHARS) {
          return { callId, toolName, status: 'error', summary: `内容过大 (${content.length} 字符，上限 ${MAX_WRITE_CHARS} 字符)` }
        }
        try { await fsp.access(fp); return { callId, toolName, status: 'error', summary: `文件已存在: ${args.file_path}` } } catch { /* ok */ }
        await fsp.mkdir(path.dirname(fp), { recursive: true })
        await fsp.writeFile(fp, content, 'utf-8')
        return { callId, toolName, status: 'success', summary: `已创建 (${content.length} 字符)`, detail: `文件路径: ${args.file_path}` }
      }

      case 'edit_file': {
        const fp = await safeResolve('file_path', args, projectPath)
        if (!fp) return deny(callId, toolName, '路径不在项目目录内')
        let stat: fs.Stats
        try { stat = await fsp.stat(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}` }
        }
        if (stat.size > MAX_FILE_SIZE) {
          return { callId, toolName, status: 'error', summary: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB，上限 10MB)，无法编辑` }
        }
        let content: string
        try { content = await readFileWithEncoding(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件读取失败: ${args.file_path}` }
        }
        const oldStr = args.old_string as string
        const newStr = args.new_string as string
        const replaceAll = !!args.replace_all
        if (!content.includes(oldStr)) {
          return { callId, toolName, status: 'error', summary: '未找到要替换的文本', detail: 'old_string 在文件中未匹配到任何内容，请检查文本是否精确。' }
        }
        const occurrenceCount = content.split(oldStr).length - 1
        if (occurrenceCount > 1 && !replaceAll) {
          return { callId, toolName, status: 'error', summary: `old_string 出现 ${occurrenceCount} 次`, detail: `匹配文本在文件中出现了 ${occurrenceCount} 次。请提供更多上下文以精确定位，或设置 replace_all: true 替换全部。` }
        }
        const newContent = replaceAll ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)

        // Preview mode: return diff data for user confirmation (功能一)
        if (!args._confirmed) {
          return {
            callId, toolName, status: 'success', // 'needs_preview' handled in frontend
            summary: `待确认编辑: ${args.file_path}`,
            detail: `文件: ${args.file_path}\n替换 ${occurrenceCount} 处`,
            confirmArgs: { ...args, _confirmed: true },
          }
        }

        // Confirmed: execute with backup
        const backupRelPath = await backupFile(fp, projectPath)
        await fsp.writeFile(fp, newContent, 'utf-8')
        const replaced = replaceAll ? occurrenceCount : 1
        return {
          callId, toolName, status: 'success',
          summary: `已替换 ${replaced} 处 (备份: ${backupRelPath})`,
          detail: `文件: ${args.file_path}\n备份: ${backupRelPath}\n提示: 可在对话中说"查看备份"来列出所有备份`,
        }
      }

      case 'delete_file': {
        const fp = await safeResolve('file_path', args, projectPath)
        if (!fp) return deny(callId, toolName, '路径不在项目目录内')
        // Issue #16: Create final backup before deletion
        let backupInfo = ''
        try { backupInfo = await backupFile(fp, projectPath) } catch { /* proceed even if backup fails */ }
        try { await fsp.unlink(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}` }
        }
        return {
          callId, toolName, status: 'success',
          summary: '已删除',
          detail: `文件: ${args.file_path}${backupInfo ? `\n最终备份: ${backupInfo}` : ''}`,
        }
      }

      // ── Rename (功能三) ──

      case 'rename_file': {
        const fp = await safeResolve('file_path', args, projectPath)
        if (!fp) return deny(callId, toolName, '原路径不在项目目录内')
        const np = resolvePath('new_path')
        if (!np) return deny(callId, toolName, '新路径不在项目目录内')
        try { await fsp.access(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}` }
        }
        try { await fsp.access(np); return { callId, toolName, status: 'error', summary: `目标已存在: ${args.new_path}` } } catch { /* ok */ }
        await fsp.mkdir(path.dirname(np), { recursive: true })
        await fsp.rename(fp, np)
        const srcRel = path.relative(projectPath, fp).replace(/\\/g, '/')
        const dstRel = path.relative(projectPath, np).replace(/\\/g, '/')
        return { callId, toolName, status: 'success', summary: `已重命名: ${srcRel} → ${dstRel}`, detail: `原路径: ${args.file_path}\n新路径: ${args.new_path}` }
      }

      // ── Restore ──

      case 'restore_backup': {
        const backupRelPath = args.backup_path as string
        const targetFilePath = args.target_path as string
        if (!backupRelPath) return deny(callId, toolName, '未指定备份文件路径')

        const backupFullPath = path.join(projectPath, backupRelPath.replace(/\\/g, '/'))
        if (!isSafePath(backupFullPath, projectPath)) return deny(callId, toolName, '备份路径不在项目目录内')

        // Determine target file path
        let restoreTarget: string
        if (targetFilePath) {
          const resolved = resolvePath('target_path')
          if (!resolved) return deny(callId, toolName, '目标路径不在项目目录内')
          restoreTarget = resolved
        } else {
          const parsed = parseBackupName(path.basename(backupRelPath))
          if (!parsed) return deny(callId, toolName, '无法解析备份文件名')
          restoreTarget = path.join(projectPath, parsed.originalName)
        }
        if (!isSafePath(restoreTarget, projectPath)) return deny(callId, toolName, '恢复目标路径不在项目目录内')

        // Verify backup exists
        let backupContent: string
        try { backupContent = await readFileWithEncoding(backupFullPath) } catch {
          return { callId, toolName, status: 'error', summary: `备份文件不存在: ${backupRelPath}` }
        }

        // Issue #6: Backup current file before overwriting with restore
        let preRestoreBackup = ''
        try { preRestoreBackup = await backupFile(restoreTarget, projectPath) } catch { /* proceed even if no current file */ }

        await fsp.mkdir(path.dirname(restoreTarget), { recursive: true })
        await fsp.writeFile(restoreTarget, backupContent, 'utf-8')
        const targetRel = path.relative(projectPath, restoreTarget).replace(/\\/g, '/')
        return {
          callId, toolName, status: 'success',
          summary: `已从备份恢复: ${targetRel}`,
          detail: `备份: ${backupRelPath}\n恢复到: ${targetRel}\n内容长度: ${backupContent.length} 字符${preRestoreBackup ? `\n恢复前备份: ${preRestoreBackup}` : ''}`,
        }
      }

      // ── 项目管理 ──
      case 'create_project': {
        const name = (args.name as string || '').trim()
        if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return deny(callId, toolName, '无效的项目名称')
        const pp = path.join(projectPath, name)
        try { await fsp.access(pp); return { callId, toolName, status: 'error', summary: `项目已存在: ${name}` } } catch { /* ok */ }
        for (const dir of ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images']) {
          await fsp.mkdir(path.join(pp, dir), { recursive: true })
        }
        await fsp.writeFile(path.join(pp, 'outline', 'plot.json'), '', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'worldbuilding.json'), '', 'utf-8')
        const novelCat = (args.novelCategory as string) || 'general'
        const projType = (args.type as string) === 'imitation' ? 'imitation' : (args.type as string) === 'continuation' ? 'continuation' : 'writing'
        await fsp.writeFile(path.join(pp, 'project.json'), JSON.stringify({ type: projType, novelCategory: novelCat }), 'utf-8')
        // Notify HomePage to refresh project list
        return { callId, toolName, status: 'success', summary: `已创建项目: ${name}`, detail: `类型: ${projType}\n小说类型: ${novelCat}\n可在首页项目列表中查看` }
      }

      case 'delete_project': {
        const name = (args.project_name as string || '').trim()
        if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return deny(callId, toolName, '无效的项目名称')
        const pp = path.join(projectPath, name)
        if (!isSafePath(pp, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
        try { await fsp.access(pp) } catch { return { callId, toolName, status: 'error', summary: `项目不存在: ${name}` } }
        await fsp.rm(pp, { recursive: true, force: true })
        return { callId, toolName, status: 'success', summary: `已删除项目: ${name}` }
      }

      // 草稿笔记工具已迁移至前端 Route D（AIChatWindow.tsx 路由 D），
      // 直接操作全局 notes/ 目录。此处不再处理 note 工具。

      case 'search_images': {
        const query = String(args.query || '').slice(0, 200)
        const count = Math.min(Number(args.count) || 3, 5)
        if (!query) return { callId, toolName, status: 'error', summary: '搜索关键词不能为空' }
        try {
          const accessKey = process.env.UNSPLASH_ACCESS_KEY || 'demo'
          if (accessKey === 'demo') {
            console.warn('[fileTool] 图片搜索使用 Unsplash Demo 密钥（50次/小时限制）。设置环境变量 UNSPLASH_ACCESS_KEY 以解除限制。')
          }
          const searchUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&client_id=${accessKey}`
          const res = await fetch(searchUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json() as { results?: { id: string; description: string; alt_description: string; urls: { regular: string; small: string }; user: { name: string } }[] }
          const imagesDir = path.join(projectPath, 'images')
          await fsp.mkdir(imagesDir, { recursive: true })
          const saved: { path: string; description: string }[] = []
          for (const r of (data.results || [])) {
            const imgUrl = r.urls?.regular || r.urls?.small || ''
            if (!imgUrl) continue
            try {
              const imgRes = await fetch(imgUrl)
              if (!imgRes.ok) continue
              const buf = Buffer.from(await imgRes.arrayBuffer())
              if (buf.length > MAX_FILE_SIZE) continue
              const fileName = `img_${r.id || Date.now().toString(36)}.jpg`
              await fsp.writeFile(path.join(imagesDir, fileName), buf)
              saved.push({ path: `images/${fileName}`, description: r.alt_description || r.description || query })
            } catch { /* skip failed downloads */ }
          }
          if (saved.length === 0) return { callId, toolName, status: 'success', summary: `未找到 "${query}" 相关图片`, detail: '[]' }
          return { callId, toolName, status: 'success', summary: `已保存 ${saved.length} 张 "${query}" 图片到项目 images/ 目录`, detail: JSON.stringify(saved) }
        } catch {
          return { callId, toolName, status: 'error', summary: `图片搜索暂时不可用（Unsplash Demo Key 可能已限流，设置 UNSPLASH_ACCESS_KEY 环境变量可解除）` }
        }
      }

      default:
        return { callId, toolName, status: 'error', summary: `未知操作: ${toolName}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { callId, toolName, status: 'error', summary: message }
  }
}

function deny(callId: string, toolName: string, reason: string): ToolCallResult {
  return { callId, toolName, status: 'error', summary: reason }
}
