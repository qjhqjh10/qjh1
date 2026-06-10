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
import { registerStoryHandlers } from './ipc/storyHandlers'
import { registerRewriteHandlers } from './ipc/rewriteHandlers'
import { registerAgentHandlers } from './ipc/agentHandlers'
import { registerHttpHandlers } from './ipc/httpHandlers'
import { registerBrowserHandlers } from './ipc/browserHandlers'
import { registerShellHandlers } from './ipc/shellHandlers'
import { registerMCPHandlers } from './ipc/mcpHandlers'
import { registerLSPHandlers } from './ipc/lspHandlers'
import { logError } from './ipc/logger'
import { loadWindowBounds, saveWindowBounds } from './ipc/utils'

let mainWindow: BrowserWindow | null = null
let watcher: ReturnType<typeof setupFileWatcher> | null = null
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null

function getProjectsBasePath(): string {
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return join(app.getAppPath(), 'projects')
  }
  return join(app.getPath('userData'), 'projects')
}

/** Ensure all runtime directories exist before handlers start */
async function ensureRuntimeDirectories(parentDir: string, projectsPath: string) {
  // All global dirs now unified at parentDir level (userData in prod)
  // AI accesses via ../ prefix (from projects/ up to app root)
  const globalDirs = [
    join(parentDir, 'notes'),
    join(parentDir, 'style_templates'),
    join(parentDir, 'scene_templates'),
    join(parentDir, 'knowledge_base'),
    join(parentDir, 'agent-sessions'),
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
  const toCopy = [
    { src: 'templates', dest: 'templates' },
    { src: 'rules', dest: 'rules' },
    { src: 'scripts', dest: 'scripts' },
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const projectsPath = getProjectsBasePath()
  const parentDir = dirname(projectsPath)

  // Ensure all runtime directories exist (notes, uploads, .appdata, .aiharness)
  await ensureRuntimeDirectories(parentDir, projectsPath)

  // Sync .aiharness/ templates & rules from app package → runtime location
  await syncAiharnessResources(parentDir, projectsPath)

  registerFileHandlers(ipcMain, undefined, projectsPath)
  registerProjectHandlers(ipcMain, projectsPath)
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
  registerStoryHandlers(ipcMain)
  registerRewriteHandlers(ipcMain)
  registerAgentHandlers(ipcMain, projectsPath)
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
  registerShellHandlers(ipcMain, projectsPath, parentDir)
  registerMCPHandlers(ipcMain)
  registerLSPHandlers(ipcMain)

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
