import { app, BrowserWindow, ipcMain, safeStorage, shell, Menu } from 'electron'
import { join, dirname } from 'path'
import { mkdir, appendFile } from 'fs/promises'
import { registerFileHandlers, setupFileWatcher } from './ipc/fileHandlers'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerExportHandlers } from './ipc/exportHandlers'
import { registerAiHandlers } from './ipc/aiHandlers'
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

async function createWindow() {
  const saved = await loadWindowBounds()
  mainWindow = new BrowserWindow({
    x: saved.x, y: saved.y,
    width: saved.width || 1400,
    height: saved.height || 900,
    minWidth: 1100,
    minHeight: 700,
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

  // CSP header injection (defense-in-depth layer on top of meta tag)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.deepseek.com https://api.openai.com https://*.openai.com; font-src 'self' data:; object-src 'none'"
        ],
      },
    })
  })

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

  registerFileHandlers(ipcMain, undefined, projectsPath)
  registerProjectHandlers(ipcMain, projectsPath)
  registerExportHandlers(ipcMain, () => mainWindow, projectsPath)
  registerAiHandlers(ipcMain, safeStorage, projectsPath)
  registerKbHandlers(ipcMain, projectsPath, () => mainWindow, safeStorage)
  registerStatsHandlers(ipcMain)

  const parentDir = dirname(projectsPath)
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
  // Load HTTP config from aiharness.json (if present)
  let httpConfig = { allowPrivateIPs: false }
  try {
    const configPath = join(app.getAppPath(), '.aiharness', 'aiharness.json')
    const configRaw = await import('fs/promises').then(fs => fs.readFile(configPath, 'utf-8'))
    const config = JSON.parse(configRaw)
    if (config.http?.allowPrivateIPs) httpConfig.allowPrivateIPs = true
  } catch { /* use defaults */ }
  registerHttpHandlers(ipcMain, httpConfig)
  registerBrowserHandlers(ipcMain, httpConfig)
  registerShellHandlers(ipcMain, projectsPath)
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
