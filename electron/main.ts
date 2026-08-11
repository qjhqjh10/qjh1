import { app, BrowserWindow, ipcMain, safeStorage, shell, Menu } from 'electron'
import { join, dirname, resolve } from 'path'
import { mkdir, appendFile, cp } from 'fs/promises'
import { registerFileHandlers, setupFileWatcher } from './ipc/fileHandlers'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerExportHandlers } from './ipc/exportHandlers'
import { registerAiHandlers } from './ipc/aiHandlers'
import { registerAnthropicHandlers } from './ipc/anthropicHandlers'
import { registerKbHandlers } from './ipc/kbHandlers'
import { registerStatsHandlers } from './ipc/statsHandlers'
import { registerStyleHandlers } from './ipc/styleHandlers'
import { registerStyleTemplateHandlers } from './ipc/styleTemplateHandlers'
import { registerTemplateHandlers } from './ipc/templateHandlers'
import { registerExtractionHandlers } from './ipc/extractionHandlers'
import { registerContinuationHandlers } from './ipc/continuationHandlers'
import { registerRewriteHandlers } from './ipc/rewriteHandlers'
import { registerStoryHandlers } from './ipc/storyHandlers'

import { registerHttpHandlers } from './ipc/httpHandlers'
import { registerBrowserHandlers } from './ipc/browserHandlers'

import { registerMCPHandlers } from './ipc/mcpHandlers'
import { logError } from './ipc/logger'
import { loadWindowBounds, saveWindowBounds } from './ipc/utils'

// v14.9.x: 数据目录跟随软件位置（dev 与打包版一致，绿色便携）——
// 所有运行产生的目录（projects/notes/knowledge_base/uploads/.appdata/IndexedDB 等）
// 生成在软件文件夹下的 userdata/ 子目录（dev: 源码文件夹；portable: exe 旁；
// nsis 安装版: 安装目录）。必须在任何 app.getPath() 调用前设置。
// 例外：用户通过 AI 写作助手明确下达指令指向的路径（全自由模式工具操作）
// 不受影响，仍可读写软件文件夹之外的任意非系统目录。
const _isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL
if (_isDev) {
  app.setPath('userData', join(app.getAppPath(), 'userdata'))
} else {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  app.setPath('userData', join(exeDir, 'userdata'))
}

let mainWindow: BrowserWindow | null = null
let watcher: ReturnType<typeof setupFileWatcher> | null = null
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null

function getProjectsBasePath(): string {
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return join(app.getAppPath(), 'projects')
  }
  return join(app.getPath('userData'), 'projects')
}

function getImitationProjectsPath(): string {
  const parentDir = dirname(getProjectsBasePath())
  return join(parentDir, 'imitation_projects')
}

function getContinuationProjectDirsPath(): string {
  const parentDir = dirname(getProjectsBasePath())
  return join(parentDir, 'continuation_project_dirs')
}

function getRewriteProjectsPath(): string {
  const parentDir = dirname(getProjectsBasePath())
  return join(parentDir, 'rewrite_projects')
}

/** Ensure all runtime directories exist before handlers start */
async function ensureRuntimeDirectories(parentDir: string) {
  // All global dirs now unified at parentDir level (userData in prod)
  // AI accesses via ../ prefix (from projects/ up to app root)
  const globalDirs = [
    join(parentDir, 'rewrite_projects'),
    join(parentDir, 'notes'),
    join(parentDir, 'style_templates'),
    join(parentDir, 'scene_templates'),
    join(parentDir, 'knowledge_base'),
    join(parentDir, 'uploads', 'files'),
    join(parentDir, 'uploads', 'images'),
  ]
  // fileHandlers root-level dirs
  const fileHandlerDirs = [
    join(parentDir, '.appdata'),
    join(parentDir, '.aiharness'),
    join(parentDir, '.ai_backups'),
  ]

  for (const d of [...globalDirs, ...fileHandlerDirs]) {
    await mkdir(d, { recursive: true }).catch(() => {})
  }
}

/**
 * Sync .aiharness/ resources (templates, rules, config) from app package
 * to the runtime locations. In dev, copies from project root to projectsPath.
 * In production, copies from extraResources (process.resourcesPath) to parentDir.
 * Only copies static resources — never audit/ or learnings.json (runtime data).
 */
async function syncAiharnessResources(parentDir: string, projectsPath: string) {
  const isDev = !app.isPackaged
  const srcBase = isDev
    ? join(app.getAppPath(), '.aiharness')
    : join(process.resourcesPath, '.aiharness')

  // Single destination: app root (parentDir). AI accesses via ../../.aiharness/
  const destBases = [parentDir]

  // Static resources to sync (NOT audit/, learnings.json, design/, hooks/)
  // v14.0.1: prompts 已移除——系统提示词以代码内 CORE_SYSTEM_PROMPT 为唯一来源
  const toCopy = [
    { src: 'templates', dest: 'templates' },
    { src: 'rules', dest: 'rules' },
    { src: 'aiharness.json', dest: 'aiharness.json' },
    { src: 'AGENTS.md', dest: 'AGENTS.md' },
  ]

  for (const destBase of destBases) {
    for (const { src, dest } of toCopy) {
      try {
        const srcPath = join(srcBase, src)
        const destPath = join(destBase, '.aiharness', dest)
        // Skip if source and destination are the same (dev mode: root .aiharness → root .aiharness)
        if (resolve(srcPath) === resolve(destPath)) continue
        await mkdir(dirname(destPath), { recursive: true }).catch(() => {})
        await cp(srcPath, destPath, { recursive: true, force: true })
      } catch (e: any) {
        if (e?.code !== 'ENOENT') {
          console.warn('[syncAiharness] 同步失败:', src, '→', destBase, e?.message || e)
        }
      }
    }
  }
}

async function createWindow() {
  const saved = await loadWindowBounds()
  mainWindow = new BrowserWindow({
    x: saved.x, y: saved.y,
    width: saved.width || 1400,
    height: saved.height || 900,
    minWidth: 1280,
    minHeight: 780,
    title: 'AI写作软件—青剑',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Verified: preload.ts uses only contextBridge + ipcRenderer (no Node APIs)
    },
    frame: true,
    show: false,
  })

  if (saved.isMaximized) mainWindow.maximize()

  // Save bounds on resize/move (debounced)
  const scheduleSaveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow) return
      const bounds = mainWindow.getBounds()
      saveWindowBounds({
        x: bounds.x, y: bounds.y,
        width: bounds.width, height: bounds.height,
        isMaximized: mainWindow.isMaximized(),
      })
    }, 500)
  }
  mainWindow.on('resize', scheduleSaveBounds)
  mainWindow.on('move', scheduleSaveBounds)
  mainWindow.on('maximize', scheduleSaveBounds)
  mainWindow.on('unmaximize', scheduleSaveBounds)

  // Open external links in system browser — strict URL validation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch { /* invalid URL — deny */ }
    return { action: 'deny' }
  })

  // Prevent navigation to external URLs (defense-in-depth)
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowedOrigins = [process.env.ELECTRON_RENDERER_URL, 'file://'].filter(Boolean) as string[]
    const isAllowed = allowedOrigins.some(origin => navigationUrl.startsWith(origin))
    if (!isAllowed) {
      event.preventDefault()
    }
  })

  // Deny all renderer permission requests (camera, mic, notifications, etc.)
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => { callback(false) }
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    mainWindow = null
  })

  return mainWindow
}

// Register activate handler at top level (before app is ready on macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// v14.6.1: 单实例锁——打包后双击 exe 两次会启动两个实例（双文件监视器、
// 审计/统计并发写、UI 状态互相覆盖）。第二次启动直接退出并聚焦已有窗口。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  // 未获得单实例锁时退出（app.quit() 后 whenReady 仍可能触发，此处短路）
  if (!gotSingleInstanceLock) return
  // v14.6.1: Windows 任务栏分组/通知归属（不设置时 Electron 用 exe 文件名，
  // 通知中心与任务栏可能显示异常）
  if (process.platform === 'win32') app.setAppUserModelId('com.qingjian.ai-writing')
  Menu.setApplicationMenu(null)
  const projectsPath = getProjectsBasePath()
  const parentDir = dirname(projectsPath)
  const imitationProjectsPath = getImitationProjectsPath()
  const continuationProjectDirsPath = getContinuationProjectDirsPath()

  // Ensure all runtime directories exist (notes, uploads, .appdata, .aiharness)
  await ensureRuntimeDirectories(parentDir)

  // Sync .aiharness/ templates & rules from app package → runtime location
  await syncAiharnessResources(parentDir, projectsPath)

  // v16.3.1(审计 F12): onWrite 钩子为预留扩展点（fileHandlers:177 写后回调，当前无订阅方——
  // 渲染层文件变更通知走 files:external-change 事件）；参数已可选，显式传 undefined 保持签名自明
  registerFileHandlers(ipcMain, undefined, projectsPath)
  registerProjectHandlers(ipcMain, projectsPath, imitationProjectsPath, continuationProjectDirsPath)
  registerExportHandlers(ipcMain, () => mainWindow, projectsPath)
  registerAiHandlers(ipcMain, safeStorage, projectsPath)
  registerAnthropicHandlers(ipcMain, safeStorage, projectsPath)  // Anthropic 协议（独立通道）
  registerKbHandlers(ipcMain, projectsPath, () => mainWindow, safeStorage)
  registerStatsHandlers(ipcMain, projectsPath)

  const styleProjectsPath = join(parentDir, 'style_projects')
  registerStyleHandlers(ipcMain, styleProjectsPath)

  registerStyleTemplateHandlers(ipcMain, parentDir)

  const templatesPath = join(parentDir, 'scene_templates')
  registerTemplateHandlers(ipcMain, templatesPath)

  registerExtractionHandlers(ipcMain, parentDir)
  registerContinuationHandlers(ipcMain, parentDir)
  registerRewriteHandlers(ipcMain, parentDir)
  registerStoryHandlers(ipcMain)

  // Load HTTP config from aiharness.json (synced from extraResources at startup)
  let httpConfig = { allowPrivateIPs: false }
  try {
    const configPath = join(parentDir, '.aiharness', 'aiharness.json')
    const configRaw = await import('fs/promises').then(fs => fs.readFile(configPath, 'utf-8'))
    const config = JSON.parse(configRaw)
    if (config.http?.allowPrivateIPs) httpConfig.allowPrivateIPs = true
  } catch { /* use defaults */ }
  registerHttpHandlers(ipcMain, httpConfig)
  registerBrowserHandlers(ipcMain, httpConfig)

  registerMCPHandlers(ipcMain)

  // v14.0.1: app:getSystemPrompt 已移除——系统提示词以代码内 CORE_SYSTEM_PROMPT 为唯一来源
  // （原 MD 文件是 v13.2 瘦身前旧版且打包不含 prompts，造成开发/打包行为不一致）
  // v14.9.x: app:check-update 已移除——GitHub 网络受限，git 更新功能不可用，
  // 版本更新改为腾讯在线文档方式（见 VersionTab.tsx）

  // Diagnostic debug logging for Claude Code analysis
  ipcMain.handle('debug:append-log', async (_e, name: string, line: string) => {
    const dir = join(app.getPath('userData'), 'ai-debug', 'events')
    await mkdir(dir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const fname = `${date}_${name.slice(0, 30)}.jsonl`.replace(/[<>:"/\\|?*]/g, '_')
    const fp = join(dir, fname)
    // 10MB limit per file
    try {
      const stat = await import('fs/promises').then(fs => fs.stat(fp)).catch(() => null)
      if (stat && stat.size > 10 * 1024 * 1024) return
    } catch { /* continue */ }
    await appendFile(fp, String(line).slice(0, 10000), 'utf-8')
  })

  const win = await createWindow()

  // Set up file watcher for bidirectional sync (normalize paths for Windows)
  if (win) {
    watcher = setupFileWatcher(projectsPath, (channel, data) => {
      // Normalize path slashes for Windows compatibility
      if (data && typeof data === 'object' && 'path' in data) {
        const d = data as { path: string; content: string }
        d.path = d.path.replace(/\\/g, '/')
      }
      win.webContents.send(channel, data)
    })
  }
}).catch(err => {
  logError('应用启动失败', err)
  app.quit()
})

app.on('before-quit', () => {
  if (watcher) {
    watcher.close()
    watcher = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
