import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import minimatch from 'minimatch'
import { isSafePath, readFileWithEncoding } from './utils'
import { validateFileContent } from './schemaValidation'

export interface ToolCallArgs {
  callId: string
  toolName: string
  args: Record<string, unknown>
  confirmed?: boolean
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
const MAX_SEARCH_RESULTS = 500
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
  // Reject absolute Windows paths (C:\...) and Unix absolute paths
  if (/^[A-Za-z]:[/\\]/.test(clean) || path.isAbsolute(clean)) return null
  // Decode percent-encoded path traversal attempts (%2e%2e%2f = ../)
  clean = clean.replace(/%2e%2e%2f/gi, '').replace(/%2e%2e/gi, '')

  // ── Handle ../ prefix: resolve against appRoot (parent of projects/) instead of projectPath ──
  if (clean.startsWith('../')) {
    const appRoot = path.dirname(projectPath)
    while (clean.startsWith('../')) clean = clean.slice(3)
    const resolved = path.join(appRoot, clean)
    // Block system directories only
    const lowered = resolved.toLowerCase()
    if (lowered.startsWith('c:/windows') || lowered.startsWith('/dev/') || lowered.startsWith('/etc/')) return null
    // Verify with realpath if file exists
    try {
      const real = await fsp.realpath(resolved)
      if (!isSafePath(real, appRoot)) return null
      return real
    } catch {
      return resolved // File doesn't exist yet
    }
  }

  // ── Determine base path (v11.4: global dirs resolve against appRoot) ──
  const GLOBAL_DIRS = new Set(['notes', 'knowledge_base', 'style_templates', 'scene_templates', 'uploads', 'agent-sessions'])
  const appRoot = path.dirname(projectPath)
  const firstSegment = clean.split('/')[0].split('\\')[0]
  const isGlobalPath = GLOBAL_DIRS.has(firstSegment)
  // Global paths → resolve against appRoot; project paths → resolve against projectPath
  const basePath = isGlobalPath ? appRoot : projectPath

  // Strip ../ for safety and join with basePath
  let prev = ''
  while (prev !== clean) {
    prev = clean
    clean = clean.replace(/\.\.\//g, '')
  }
  clean = clean.replace(/\/\.\.$/, '').replace(/^\.\.$/, '')
  const joined = path.join(basePath, clean)
  // Safety: must be within basePath (appRoot for global, projectPath for project)
  const realBasePath = (await fsp.realpath(basePath).catch(() => basePath))
  if (!isSafePath(joined, realBasePath)) return null
  // Resolve symlinks to get real path, then re-check (Issue #5)
  try {
    const real = await fsp.realpath(joined)
    if (!isSafePath(real, realBasePath)) return null
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
  // If path starts with ../ → resolve against app root (global dirs)
  if (clean.startsWith('../')) {
    const appRoot = path.dirname(projectPath)
    while (clean.startsWith('../')) clean = clean.slice(3)
    const resolved = path.join(appRoot, clean)
    // Block system dirs only
    const lowered = resolved.toLowerCase()
    if (lowered.startsWith('c:/windows') || lowered.startsWith('/dev/') || lowered.startsWith('/etc/')) return null
    return resolved
  }
  // For project-relative paths, strip any remaining ../ for safety
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

const backupLocks = new Map<string, Promise<string>>()

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
 * Creates a timestamped backup of the given file in .ai_backups/ directory.
 * Returns the backup's relative path, or '' if backup is skipped/failed.
 */
async function backupFile(filePath: string, projectPath: string): Promise<string> {
  try {
    // Check if source file exists
    await fsp.access(filePath)
  } catch {
    return '' // Source doesn't exist, nothing to back up
  }

  // File-level lock to prevent concurrent backup of the same file
  const lockKey = filePath
  const existingLock = backupLocks.get(lockKey)
  if (existingLock) {
    try { await existingLock } catch { /* previous backup failed, proceed */ }
  }

  const backupPromise = (async () => {
    try {
      const backupDir = path.join(projectPath, BACKUP_DIR)
      await fsp.mkdir(backupDir, { recursive: true })

      const originalName = path.basename(filePath)
      const backupName = makeBackupName(originalName)
      const backupPath = path.join(backupDir, backupName)

      // Read source and write backup
      const content = await fsp.readFile(filePath)
      await fsp.writeFile(backupPath, content)

      // Retention: keep only the most recent MAX_BACKUPS_PER_FILE backups per file
      const existingBackups = await listBackupsForFile(filePath, projectPath)
      if (existingBackups.length > MAX_BACKUPS_PER_FILE) {
        const toDelete = existingBackups.slice(0, existingBackups.length - MAX_BACKUPS_PER_FILE)
        for (const b of toDelete) {
          try { await fsp.unlink(b.fullPath) } catch { /* skip if can't delete */ }
        }
      }

      return `${BACKUP_DIR}/${backupName}`
    } catch (err) {
      console.error('[fileToolHandlers] backupFile failed:', filePath, err)
      return ''
    }
  })()

  backupLocks.set(lockKey, backupPromise)
  try {
    const result = await backupPromise
    return result
  } finally {
    if (backupLocks.get(lockKey) === backupPromise) {
      backupLocks.delete(lockKey)
    }
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
        const rawPath = String(args.dir_path || '')
        const pattern = args.pattern as string | undefined
        const broad = args.broad === true
        const isGlobal = rawPath.startsWith('..') || rawPath.includes('/../')

        const MAX_RESULTS = 500
        const appRoot = path.dirname(projectPath)

        // ── Scan one directory ──
        const scanDir = async (scanPath: string, label: string): Promise<string[]> => {
          let e: fs.Dirent[]
          try { e = await fsp.readdir(scanPath, { withFileTypes: true }) } catch { return [] }
          const result: string[] = []
          for (const entry of e) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
            if (entry.isSymbolicLink()) continue
            const pfx = entry.isDirectory() ? '[DIR] ' : '[FILE]'
            if (!pattern) {
              result.push(`[${label}] ${pfx} ${entry.name}${entry.isDirectory() ? '/' : ''}`)
            } else if (entry.isFile() && minimatch(entry.name, pattern)) {
              result.push(`[${label}] [FILE] ${entry.name}`)
            } else if (entry.isDirectory() && pattern.includes('**')) {
              try {
                const subs = await fsp.readdir(path.join(scanPath, entry.name), { withFileTypes: true })
                for (const se of subs) {
                  if (se.isFile() && minimatch(`${entry.name}/${se.name}`, pattern)) {
                    result.push(`[${label}] [FILE] ${entry.name}/${se.name}`)
                    if (result.length >= MAX_RESULTS) break
                  }
                }
              } catch {}
            }
            if (result.length >= MAX_RESULTS) break
          }
          return result
        }

        // ── Fast path: dir_path specified → scan that directory directly ──
        if (rawPath && !isGlobal) {
          // Resolve: project-relative path like "1/" or "1/outline"
          const resolved = path.join(projectPath, rawPath)
          try {
            await fsp.access(resolved)
            const items = await scanDir(resolved, rawPath)
            const detail = items.length > 0
              ? items.join('\n')
              : `(目录 "${rawPath}" 为空。使用 list_directory 不填参数可查看全部文件)`
            return { callId, toolName, status: 'success', summary: `${items.length} 个匹配`, detail }
          } catch {
            return { callId, toolName, status: 'success', summary: '0 个匹配', detail: `目录 "${rawPath}" 不存在。使用 list_directory 不填参数可查看全部项目。` }
          }
        }

        // ── Build scan targets: always scan the entire software folder in parallel ──
        const targets: Array<{ path: string; label: string }> = []

        // All global resource dirs
        const globalDirs = ['style_templates', 'scene_templates', 'knowledge_base/files', 'uploads/files', 'uploads/images', 'notes', '.aiharness/templates']
        for (const d of globalDirs) {
          const p = path.join(appRoot, d)
          try { await fsp.access(p); targets.push({ path: p, label: d.replace('knowledge_base/', 'KB:').replace('uploads/', '上传:') }) } catch {}
        }

        // Project directories — handles both test env and production env
        try {
          const projRootEntries = await fsp.readdir(projectPath, { withFileTypes: true })
          // If projectPath's subdirs contain known project subdirs, it IS a project dir (test env)
          const isProjectItself = projRootEntries.some(e => ['characters', 'chapters', 'outline'].includes(e.name))
          if (isProjectItself) {
            for (const sd of ['characters', 'chapters', 'detailed_outline', 'outline', 'summaries']) {
              const p = path.join(projectPath, sd)
              try { await fsp.access(p); targets.push({ path: p, label: sd }) } catch {}
            }
          } else {
            // Prod: projectPath = projects/ → scan each project subdir
            for (const pe of projRootEntries) {
              if (pe.isDirectory() && !pe.name.startsWith('.')) {
                for (const sd of ['characters', 'chapters', 'detailed_outline', 'outline', 'summaries']) {
                  const p = path.join(projectPath, pe.name, sd)
                  try { await fsp.access(p); targets.push({ path: p, label: `${pe.name}/${sd}` }) } catch {}
                }
              }
            }
          }
        } catch {}

        // If broad scan: add desktop/documents/downloads + common writing dirs
        if (broad) {
          const broadDirs = [
            'Desktop', 'Documents', 'Downloads',
            'OneDrive',
            '小说', 'novels', 'writing', '写作', '文稿', '创作',
          ]
          for (const d of broadDirs) {
            const p = path.join(os.homedir(), d)
            try { await fsp.access(p); targets.push({ path: p, label: `电脑:${d}` }) } catch {}
          }
        }

        // ── Scan all targets in parallel ──
        const allResults = await Promise.all(targets.map(t =>
          scanDir(t.path, t.label).then(items => ({ label: t.label, items }))
        ))

        // ── Aggregate ──
        const allItems: string[] = []
        let total = 0
        for (const r of allResults) {
          if (total >= MAX_RESULTS) break
          for (const item of r.items) {
            if (total >= MAX_RESULTS) break
            allItems.push(item)
            total++
          }
        }
        if (total >= MAX_RESULTS) allItems.push(`... (已截断，仅显示前 ${MAX_RESULTS} 条)`)

        const detail = allItems.length > 0 ? allItems.join('\n') : `(未找到匹配${pattern ? ` "${pattern}"` : ''}的文件。设置 broad=true 可搜索电脑桌面/文档/下载)`
        return { callId, toolName, status: 'success', summary: `${total} 个匹配`, detail }
      }

      case 'read_file': {
        const fp = await safeResolve('file_path', args, projectPath)
        if (!fp) {
          return { callId, toolName, status: 'error', summary: `路径解析失败: ${args.file_path}`, detail: pathHint(String(args.file_path || '')) }
        }
        let content: string
        try { content = await readFileWithEncoding(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}`, detail: pathHint(String(args.file_path || '')) }
        }
        const truncated = content.length > MAX_READ_CHARS
          ? content.slice(0, MAX_READ_CHARS) + `\n\n... (内容过长，已截断至 ${MAX_READ_CHARS} 字符)`
          : content
        return { callId, toolName, status: 'success', summary: `${content.length} 字符`, detail: truncated }
      }

      case 'search_content': {
        const rawPath = String(args.dir_path || '')
        const dir = args.dir_path ? (resolvePath('dir_path') || projectPath) : projectPath
        const isGlobal = rawPath.startsWith('..') || rawPath.includes('/../')
        if (!isGlobal && !isSafePath(dir, projectPath)) return deny(callId, toolName, '路径不在项目目录内')
        const pattern = args.pattern as string
        if (!pattern) return deny(callId, toolName, '缺少搜索内容')

        // ── Build match function (compiled once, reused across all files) ──
        const useRegex = args.regex === true
        const caseSensitive = args.case_sensitive === true
        let matchFn: (line: string) => boolean
        let matchStrategy = '子串'
        if (useRegex) {
          try {
            const re = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
            matchFn = (line) => { re.lastIndex = 0; return re.test(line) }
            matchStrategy = '正则'
          } catch {
            const search = caseSensitive ? pattern : pattern.toLowerCase()
            matchFn = caseSensitive
              ? (line) => line.includes(search)
              : (line) => line.toLowerCase().includes(search)
            matchStrategy = '子串(正则降级)'
          }
        } else {
          const search = caseSensitive ? pattern : pattern.toLowerCase()
          matchFn = caseSensitive
            ? (line) => line.includes(search)
            : (line) => line.toLowerCase().includes(search)
        }

        // ── Parameters ──
        const ctxBefore = (typeof args.context_before === 'number' ? args.context_before : 0)
                       || (typeof args.context_around === 'number' ? args.context_around : 0)
        const ctxAfter  = (typeof args.context_after === 'number' ? args.context_after : 0)
                       || (typeof args.context_around === 'number' ? args.context_around : 0)
        const filePattern = (args.file_pattern as string) || '**'
        const maxColumns = (typeof args.max_columns === 'number' ? args.max_columns : 200)
        const maxResults = Math.min(args.max_results as number || MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS)
        const multiline = args.multiline === true && pattern.includes('\n')

        // ── Phase 1: Collect matching file paths (fast, no reading yet) ──
        const matchedFiles: { fullPath: string; relPath: string }[] = []
        await safeWalk(dir, projectPath, async (fullPath, entry) => {
          if (entry.isDirectory()) return
          const rel = path.relative(dir, fullPath).replace(/\\/g, '/')
          if (filePattern !== '**' && !minimatch(rel, filePattern, { matchBase: true })) return
          matchedFiles.push({ fullPath, relPath: rel })
        })

        // ── Phase 2: Read and search all files in parallel (like ripgrep) ──
        const BINARY_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.gif','.bmp','.ico','.webp','.pdf','.exe','.dll','.zip','.gz','.tar'])
        const isTextFile = (fp: string) => {
          const ext = path.extname(fp).toLowerCase()
          return !BINARY_EXTENSIONS.has(ext)
        }

        interface FileResult { absRel: string; matches: string[] }
        const fileResults: FileResult[] = []

        // Process files in batches of 20 for parallelism
        const BATCH_SIZE = 20
        for (let batchStart = 0; batchStart < matchedFiles.length && fileResults.reduce((s, r) => s + r.matches.length, 0) < maxResults; batchStart += BATCH_SIZE) {
          const batch = matchedFiles.slice(batchStart, batchStart + BATCH_SIZE)
          const batchResults = await Promise.all(batch.map(async ({ fullPath, relPath }) => {
            const absRel = path.relative(projectPath, fullPath).replace(/\\/g, '/')
            if (!isTextFile(fullPath)) return { absRel, matches: [] as string[] }
            try {
              const buf = await fsp.readFile(fullPath)
              // Try UTF-8 first, fallback to latin1
              let content: string
              try { content = buf.toString('utf-8') } catch { content = buf.toString('latin1') }
              const matches: string[] = []

              if (multiline) {
                let searchIdx = 0
                while (searchIdx < content.length) {
                  const foundIdx = content.indexOf(pattern, searchIdx)
                  if (foundIdx === -1) break
                  const lineNum = content.slice(0, foundIdx).split('\n').length
                  const matchText = content.slice(
                    Math.max(0, foundIdx - 20),
                    Math.min(content.length, foundIdx + pattern.length + 20)
                  ).replace(/\n/g, '\\n').slice(0, maxColumns)
                  matches.push(`${absRel}:${lineNum}: ${matchText}`)
                  searchIdx = foundIdx + 1
                }
              } else {
                const lines = buf.toString('utf-8').split('\n')
                for (let i = 0; i < lines.length; i++) {
                  if (matchFn(lines[i])) {
                    const startCtx = Math.max(0, i - ctxBefore)
                    const endCtx = Math.min(lines.length - 1, i + ctxAfter)
                    const ctxLines = endCtx - startCtx + 1
                    const colLimit = ctxLines <= 3 ? Math.min(maxColumns * 2, 800) : maxColumns
                    if (matches.length > 0 && !matches[matches.length - 1].startsWith('---')) {
                      matches.push('---')
                    }
                    for (let ctx = startCtx; ctx <= endCtx; ctx++) {
                      const marker = ctx === i ? '>>>' : '   '
                      matches.push(`${marker} ${absRel}:${ctx + 1}: ${(lines[ctx] || '').trim().slice(0, colLimit)}`)
                    }
                  }
                }
              }
              return { absRel, matches }
            } catch { return { absRel, matches: [] as string[] } }
          }))
          for (const r of batchResults) {
            fileResults.push(r)
            if (fileResults.reduce((s, r2) => s + r2.matches.length, 0) >= maxResults) break
          }
        }

        // ── Phase 3: Aggregate results ──
        let totalMatches = 0
        const allResults: string[] = []
        for (const fr of fileResults) {
          if (totalMatches >= maxResults) break
          for (const m of fr.matches) {
            if (totalMatches >= maxResults) break
            allResults.push(m)
            totalMatches++
          }
        }
        if (totalMatches >= maxResults) {
          allResults.push(`... (结果已截断，仅显示前 ${maxResults} 条)`)
        }
        const detail = allResults.length > 0 ? allResults.join('\n') : '未找到匹配内容'
        const summary = `${totalMatches} 处匹配` + (matchStrategy !== '子串' ? ` (${matchStrategy})` : '')
        return { callId, toolName, status: 'success', summary, detail }
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
        // ../ paths resolve against appRoot (parent of projects/) — check against appRoot, not projectPath
        const rawPath = String(args.file_path || '')
        const isGlobalPath = rawPath.startsWith('../')
        const safetyBase = isGlobalPath ? path.dirname(projectPath) : projectPath
        if (!fp || !isSafePath(fp, safetyBase)) return { callId, toolName, status: 'error', summary: '路径不在项目目录内', detail: pathHint(rawPath) }
        const content = args.content as string
        // Issue #12: Size limit for writes
        if (content.length > MAX_WRITE_CHARS) {
          return { callId, toolName, status: 'error', summary: `内容过大 (${content.length} 字符，上限 ${MAX_WRITE_CHARS} 字符)` }
        }
        try { await fsp.access(fp); return { callId, toolName, status: 'error', summary: `文件已存在: ${args.file_path}` } } catch { /* ok */ }

        // Validate structured JSON files before writing (characters, detailed_outline, etc.)
        const relPath = path.relative(projectPath, fp).replace(/\\/g, '/')
        if (relPath.endsWith('.json') || relPath.endsWith('.yaml') || relPath.endsWith('.yml')) {
          const validation = validateFileContent(relPath, content)
          if (!validation.valid) {
            const errorDetail = validation.errors.map(e => `${e.field}: ${e.message}${e.fix ? `\n  → 修复: ${e.fix}` : ''}`).join('\n')
            return {
              callId, toolName, status: 'error',
              summary: `格式校验不通过 — 文件未创建，请修正后重试`,
              detail: `文件: ${args.file_path}\n\n${errorDetail}\n\n请按照系统提示词中的 schema 格式重写 content。`,
            }
          }
        }

        await fsp.mkdir(path.dirname(fp), { recursive: true })
        await fsp.writeFile(fp, content, 'utf-8')
        // v11.5.1: 返回前500字让模型验证写入内容
        const preview = content.length > 500 ? content.slice(0, 500) + '…' : content
        return { callId, toolName, status: 'success', summary: `已创建 (${content.length} 字符)`, detail: preview }
      }

      case 'edit_file': {
        const resolveNotePath = async (): Promise<string | null> => {
          const notesPath = (args.file_path as string || '').replace(/\\/g, '/')
          if (!notesPath.startsWith('notes/')) return null
          const globalNotesDir = path.join(path.dirname(projectPath), 'notes')
          // Strip 'notes/' prefix since globalNotesDir already is the notes root
          const cleanPath = notesPath.replace(/^notes\//, '')
          return await safeResolve('file_path', { ...args, file_path: cleanPath }, globalNotesDir)
        }
        let fp = await safeResolve('file_path', args, projectPath)
        // Fallback: try global notes dir for notes/* paths
        if (!fp) fp = await resolveNotePath()
        // Also try if resolved path doesn't exist on disk
        if (fp) {
          try { await fsp.stat(fp) } catch { fp = null }
        }
        if (!fp) fp = await resolveNotePath()
        if (!fp) return deny(callId, toolName, '路径不在项目目录内')
        const stat = await fsp.stat(fp).catch(() => null as fs.Stats | null)
        if (!stat) return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}`, detail: pathHint(String(args.file_path || '')) }
        if (stat.size > MAX_FILE_SIZE) {
          return { callId, toolName, status: 'error', summary: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB，上限 10MB)，无法编辑` }
        }
        let content: string
        try { content = await readFileWithEncoding(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件读取失败: ${args.file_path}` }
        }
        let oldStr = args.old_string as string
        const newStr = args.new_string as string
        const replaceAll = !!args.replace_all

        // ── __FULL_REPLACE__ sentinel: skip matching, replace entire file ──
        if (oldStr === '__FULL_REPLACE__') {
          // Size check for full replacement
          if (newStr.length > MAX_WRITE_CHARS) {
            return { callId, toolName, status: 'error', summary: `内容过大 (${newStr.length} 字符，上限 ${MAX_WRITE_CHARS} 字符)` }
          }
          // Validate JSON before writing
          const relPathFull = path.relative(projectPath, fp).replace(/\\/g, '/')
          if (relPathFull.endsWith('.json')) {
            const validation = validateFileContent(relPathFull, newStr)
            if (!validation.valid) {
              const errorDetail = validation.errors.map(e => `${e.field}: ${e.message}${e.fix ? `\n  → 修复: ${e.fix}` : ''}`).join('\n')
              return { callId, toolName, status: 'error', summary: '全量替换后的格式不正确', detail: `文件: ${args.file_path}\n\n${errorDetail}` }
            }
          }
          const globalNotesDir2 = path.join(path.dirname(projectPath), 'notes')
          const backupBase2 = fp.startsWith(globalNotesDir2) ? globalNotesDir2 : projectPath
          await backupFile(fp, backupBase2)
          await fsp.writeFile(fp, newStr, 'utf-8')
          return { callId, toolName, status: 'success', summary: `已全量替换 (${newStr.length} 字符)`, detail: `文件: ${args.file_path}` }
        }

        // ── Strategy 1: exact match ──
        let matched = content.includes(oldStr)

        // ── Strategy 2: trimmed match (AI often adds trailing whitespace) ──
        if (!matched) {
          const trimmed = oldStr.trim()
          if (trimmed && trimmed !== oldStr && content.includes(trimmed)) {
            oldStr = trimmed; matched = true
          }
        }

        // ── Strategy 3: line ending normalization (Windows CRLF vs Unix LF) ──
        if (!matched) {
          const normContent = content.replace(/\r\n/g, '\n')
          const normOld = oldStr.replace(/\r\n/g, '\n')
          if (normContent.includes(normOld)) {
            // Find original text in content corresponding to normalized match
            const idx = normContent.indexOf(normOld)
            // Map back: find the actual slice in original content
            let origIdx = 0, normIdx = 0
            while (normIdx < idx && origIdx < content.length) {
              if (content[origIdx] === '\r' && content[origIdx + 1] === '\n') { origIdx += 2; normIdx++ }
              else { origIdx++; normIdx++ }
            }
            // Count how many original chars correspond to normOld length
            let origLen = 0; normIdx = 0
            while (normIdx < normOld.length && (origIdx + origLen) < content.length) {
              if (content[origIdx + origLen] === '\r' && content[origIdx + origLen + 1] === '\n') { origLen += 2; normIdx++ }
              else { origLen++; normIdx++ }
            }
            oldStr = content.slice(origIdx, origIdx + origLen); matched = true
          }
        }

        // ── Strategy 4: line-by-line fuzzy matching (works for 1+ lines) ──
        if (!matched) {
          const oldLines = oldStr.split('\n').map(l => l.trim())
          const contentLines = content.split('\n')
          let startLine = -1
          for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            let allMatch = true
            for (let j = 0; j < oldLines.length; j++) {
              if (contentLines[i + j].trim() !== oldLines[j]) { allMatch = false; break }
            }
            if (allMatch) { startLine = i; break }
          }
          if (startLine >= 0) {
            const endLine = startLine + oldLines.length
            oldStr = contentLines.slice(startLine, endLine).join('\n')
            if (content.includes(oldStr)) matched = true
          }
        }

        // ── Strategy 5: HTML entity normalization ──
        if (!matched) {
          const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
          const decodedContent = decodeEntities(content)
          const decodedOld = decodeEntities(oldStr)
          if (decodedContent.includes(decodedOld)) {
            const idx = decodedContent.indexOf(decodedOld)
            oldStr = content.slice(idx, idx + decodedOld.length); matched = true
          }
        }

        // ── Strategy 6: Fullwidth→Halfwidth normalization (AI often outputs fullwidth ASCII) ──
        if (!matched) {
          const buildWidthMap = () => {
            const m: Record<number, number> = {}
            for (let i = 0; i < 26; i++) { m[0xFF21 + i] = 0x41 + i; m[0xFF41 + i] = 0x61 + i } // Ａ-Ｚ, ａ-ｚ
            for (let i = 0; i < 10; i++) m[0xFF10 + i] = 0x30 + i                          // ０-９
            m[0x3000] = 0x20  // Fullwidth space → halfwidth
            return m
          }
          const widthMap = buildWidthMap()
          const normalizeWidth = (s: string): string => {
            const out: string[] = []
            for (const ch of s) {
              const cp = ch.codePointAt(0)!
              out.push(cp in widthMap ? String.fromCodePoint(widthMap[cp]) : ch)
            }
            return out.join('')
          }
          const normContent = normalizeWidth(content)
          const normOld = normalizeWidth(oldStr)
          if (normContent.includes(normOld)) {
            const idx = normContent.indexOf(normOld)
            oldStr = content.slice(idx, idx + normOld.length) // 1:1 length, offset preserved
            matched = true
          }
        }

        // ── Strategy 7: Chinese/English punctuation normalization ──
        if (!matched) {
          const punctMap: Record<string, string> = {
            '，': ',',  // ，→,
            '、': ',',  // 、→,
            '：': ':',  // ：→:
            '；': ';',  // ；→;
            '？': '?',  // ？→?
            '！': '!',  // ！→!
            '（': '(',  // （→(
            '）': ')',  // ）→)
          }
          const punctRegex = /[，、：；？！（）]/g
          const normalizePunct = (s: string) => s.replace(punctRegex, m => punctMap[m] || m)
          const normContent = normalizePunct(content)
          const normOld = normalizePunct(oldStr)
          if (normContent.includes(normOld)) {
            const idx = normContent.indexOf(normOld)
            oldStr = content.slice(idx, idx + normOld.length) // 1:1 length
            matched = true
          }
        }

        // ── All strategies exhausted → return full file for AI to do full replace ──
        if (!matched) {
          const tail = content.length > 2000
            ? `...(省略前${content.length - 2000}字)\n${content.slice(-2000)}`
            : content
          return {
            callId, toolName, status: 'error',
            summary: '未找到要替换的文本 — 请用 __FULL_REPLACE__ 进行全量替换',
            detail: `old_string 在文件中未匹配（已尝试精确/trim/行尾归一化/逐行模糊/实体归一化/全角半角/中标点共7种策略）。\n\n完整文件内容:\n${tail}\n\n下一步: 基于上述完整内容构造修改后的全量版本，调用 edit_file(old_string="__FULL_REPLACE__", new_string="完整的新文件内容")。`,
          }
        }
        const occurrenceCount = content.split(oldStr).length - 1
        if (occurrenceCount > 1 && !replaceAll) {
          return { callId, toolName, status: 'error', summary: `old_string 出现 ${occurrenceCount} 次`, detail: `匹配文本在文件中出现了 ${occurrenceCount} 次。请提供更多上下文以精确定位，或设置 replace_all: true 替换全部。` }
        }
        const newContent = replaceAll ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)

        // Validate structured JSON files after edit
        // User confirmation is handled by the batch approval gate in AIChatWindow before tools execute
        const relPathEdit = path.relative(projectPath, fp).replace(/\\/g, '/')
        if (relPathEdit.endsWith('.json')) {
          const validation = validateFileContent(relPathEdit, newContent)
          if (!validation.valid) {
            const errorDetail = validation.errors.map(e => `${e.field}: ${e.message}${e.fix ? `\n  → 修复: ${e.fix}` : ''}`).join('\n')
            return {
              callId, toolName, status: 'error',
              summary: `编辑后的格式不正确 — 修改未保存，请修正后重试`,
              detail: `文件: ${args.file_path}\n\n${errorDetail}\n\n请确保编辑后的文件仍符合系统提示词中的 schema 格式。`,
            }
          }
        }

        const globalNotesDir = path.join(path.dirname(projectPath), 'notes')
        const backupBase = fp.startsWith(globalNotesDir) ? globalNotesDir : projectPath
        await backupFile(fp, backupBase)
        await fsp.writeFile(fp, newContent, 'utf-8')
        const replaced = replaceAll ? occurrenceCount : 1
        return {
          callId, toolName, status: 'success',
          summary: `已替换 ${replaced} 处`,
          detail: `文件: ${args.file_path}`,
        }
      }

      case 'delete_file': {
        const fp = await safeResolve('file_path', args, projectPath)
        if (!fp) return deny(callId, toolName, '路径不在项目目录内')
        // Issue #16: Final backup (disabled)
        try { await backupFile(fp, projectPath) } catch { /* ignore */ }
        try { await fsp.unlink(fp) } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}` }
        }
        return {
          callId, toolName, status: 'success',
          summary: '已删除',
          detail: `文件: ${args.file_path}`,
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
        for (const dir of ['characters', 'outline', 'detailed_outline', 'chapters', 'notes', 'covers', 'images', 'summaries']) {
          await fsp.mkdir(path.join(pp, dir), { recursive: true })
        }
        // 初始模板文件（YAML，匹配当前系统提示词）
        await fsp.writeFile(path.join(pp, 'outline', 'plot.md'), '# 故事剧情\n\n> 一句话梗概\n\n## 第1章\n\n（待填写）', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'worldbuilding.md'), '# 世界观设定\n\n> 类型·基调\n\n## 一、核心规则\n\n（待填写）', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'items.yaml'), 'items: []', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'locations.yaml'), 'locations: []', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'factions.yaml'), 'factions: []', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'power_system.yaml'), "name: ''\nlevels: []\ndescription: ''", 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'outline_meta.yaml'), 'foreshadowing: []\nplotThreads: []\nupdatedAt: ""', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'emotion.yaml'), 'segments: []', 'utf-8')
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
          // 优先读环境变量，其次读应用设置
          const accessKey = process.env.PEXELS_API_KEY || await (async () => {
            try { const { getConfigStore } = await import('./utils'); const s = await getConfigStore(); return (s as any).get('pexelsApiKey', '') } catch { return '' }
          })()
          if (!accessKey) {
            return { callId, toolName, status: 'error',
              summary: '图片搜索未配置 Pexels API 密钥。\n请在 设置 → AI写作助手 → 图片搜索 中填写密钥。\n免费注册: https://www.pexels.com/api/（200次/时，2万次/月）' }
          }
          const orientation = String(args.orientation || '')
          const size = String(args.size || '')
          const locale = String(args.locale || 'zh-CN')
          let searchUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&locale=${locale}`
          if (orientation) searchUrl += `&orientation=${orientation}`
          if (size) searchUrl += `&size=${size}`
          const res = await fetch(searchUrl, { headers: { Authorization: accessKey } })
          if (res.status === 401 || res.status === 403) {
            return { callId, toolName, status: 'error',
              summary: `Pexels API 密钥无效(${res.status})。请检查 PEXELS_API_KEY 环境变量是否正确。` }
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json() as { photos?: { id: number; photographer: string; alt: string; src: { original: string; large: string; medium: string; small: string } }[] }
          const appRoot = path.dirname(projectPath)
          const imagesDir = path.join(appRoot, 'images')
          await fsp.mkdir(imagesDir, { recursive: true })
          const saved: { path: string; description: string; photographer?: string }[] = []
          for (const p of (data.photos || [])) {
            const imgUrl = p.src?.large || p.src?.original || ''
            if (!imgUrl) continue
            try {
              const imgRes = await fetch(imgUrl)
              if (!imgRes.ok) continue
              const buf = Buffer.from(await imgRes.arrayBuffer())
              if (buf.length > MAX_FILE_SIZE) continue
              const ext = imgUrl.split('.').pop()?.split('?')[0] || 'jpg'
              const fileName = `img_${p.id}.${ext}`
              await fsp.writeFile(path.join(imagesDir, fileName), buf)
              saved.push({ path: `images/${fileName}`, description: p.alt || query, photographer: p.photographer })
            } catch { /* skip failed downloads */ }
          }
          if (saved.length === 0) {
            return { callId, toolName, status: 'success', summary: `未找到 "${query}" 相关图片`, detail: '[]' }
          }
          return { callId, toolName, status: 'success', summary: `已保存 ${saved.length} 张 "${query}" 图片到 images/ 目录`, detail: JSON.stringify(saved) }
        } catch {
          return { callId, toolName, status: 'error', summary: '图片搜索请求失败，请检查网络连接。' }
        }
      }

      // ── find_files: recursive file search by name pattern ──
      case 'find_files': {
        const pattern = String(args.pattern || '')
        const scope = String(args.scope || 'project')
        const maxDepth = Math.min(Number(args.max_depth) || 5, 10)
        const appRoot = path.dirname(projectPath)

        const skipDirs = new Set(['node_modules', '.git', '.svn', 'AppData', 'Library', '.cache', '__pycache__', 'dist', '.next'])
        const results: string[] = []
        const MAX_RESULTS = 200

        const searchDirs: Array<{ root: string; label: string }> = []
        if (scope === 'computer') {
          const home = os.homedir()
          const broadDirs = ['Desktop', 'Documents', 'Downloads', 'OneDrive', '小说', 'novels', 'writing', '写作']
          for (const d of broadDirs) {
            const p = path.join(home, d)
            try { await fsp.access(p); searchDirs.push({ root: p, label: `电脑:${d}` }) } catch {}
          }
          if (args.dir_path) searchDirs.push({ root: String(args.dir_path), label: String(args.dir_path) })
        } else {
          searchDirs.push({ root: appRoot, label: '软件内' })
          if (args.dir_path) searchDirs.push({ root: String(args.dir_path), label: String(args.dir_path) })
        }

        async function walk(dir: string, depth: number): Promise<void> {
          if (depth > maxDepth || results.length >= MAX_RESULTS) return
          let entries: fs.Dirent[]
          try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
          for (const e of entries) {
            if (results.length >= MAX_RESULTS) break
            if (e.name.startsWith('.') || skipDirs.has(e.name)) continue
            const full = path.join(dir, e.name)
            if (e.isDirectory()) { await walk(full, depth + 1) }
            else if (e.isFile() && minimatch(e.name, pattern, { nocase: true })) {
              results.push(full)
            }
          }
        }

        for (const sd of searchDirs) {
          await walk(sd.root, 0)
        }

        const summary = results.length >= MAX_RESULTS
          ? `找到 ${results.length}+ 个匹配 "${pattern}" 的文件（已达上限）`
          : `找到 ${results.length} 个匹配 "${pattern}" 的文件`
        const detail = results.slice(0, 200).map(r => r.replace(appRoot + path.sep, '')).join('\n') || '无匹配'
        return { callId, toolName, status: 'success', summary, detail }
      }

      // ── batch_replace: 单文件批量精确替换 ──
      case 'batch_replace': {
        const replacements = args.replacements as Array<{ old_string: string; new_string: string }> | undefined
        if (!replacements || !Array.isArray(replacements) || replacements.length === 0) {
          return { callId, toolName, status: 'error', summary: 'replacements 必须是非空数组' }
        }
        const fp = resolvePath('file_path')
        if (!fp) return { callId, toolName, status: 'error', summary: `路径无效` }

        let content: string
        try { content = await fsp.readFile(fp, 'utf-8') } catch {
          return { callId, toolName, status: 'error', summary: `文件不存在: ${args.file_path}` }
        }
        if (content.length > 10_000_000) {
          return { callId, toolName, status: 'error', summary: '文件过大（>10MB），请手动编辑' }
        }

        let modified = content
        let applied = 0
        for (let i = 0; i < replacements.length; i++) {
          const { old_string, new_string } = replacements[i]
          if (old_string === '__FULL_REPLACE__') {
            modified = new_string
            applied++
            break // 全量替换后忽略后续替换
          }
          if (!modified.includes(old_string)) {
            return {
              callId, toolName, status: 'error',
              summary: `第 ${i + 1}/${replacements.length} 个替换失败: 未找到匹配文本`,
              detail: `old_string 前80字: ${old_string.slice(0, 80)}\n文件前200字: ${modified.slice(0, 200)}`,
            }
          }
          modified = modified.replace(old_string, new_string)
          applied++
        }
        await fsp.writeFile(fp, modified, 'utf-8')
        return { callId, toolName, status: 'success', summary: `已执行 ${applied}/${replacements.length} 个替换` }
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

/** Generate a helpful path hint showing the project's expected directory structure */
function pathHint(requestedPath: string): string {
  const dirs = [
    'outline/         — plot.md, worldbuilding.md（大纲和世界观为 .md 格式）',
    'characters/      — {中文名}.yaml (每个角色一个文件，如 林语晴.yaml)',
    'detailed_outline/— {章节id}.yaml (每章一个细纲)',
    'chapters/        — {章节id}.txt (章节正文)',
    'summaries/       — {章节id}.md (每章摘要，Markdown 格式)',
    'notes/           — 草稿笔记 (.md)',
  ]
  return `请求路径: ${requestedPath}\n\n项目标准目录结构:\n${dirs.map(d => '  ' + d).join('\n')}\n\n提示: 世界观文件是 outline/worldbuilding.md，不是 worldview/。故事剧情是 outline/plot.md。`
}
