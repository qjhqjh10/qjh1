import { app, BrowserWindow, ipcMain, safeStorage, shell, Menu } from 'electron'
import { join, dirname } from 'path'
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
import { logError } from './ipc/logger'
import { loadWindowBounds, saveWindowBounds, type WindowBounds } from './ipc/utils'

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
    title: 'AI 小说写作助手',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url) }
    return { action: 'deny' }
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
  registerAiHandlers(ipcMain, safeStorage)
  registerKbHandlers(ipcMain, projectsPath, () => mainWindow, safeStorage)
  registerStatsHandlers(ipcMain)

  const parentDir = dirname(projectsPath)
  const styleProjectsPath = join(parentDir, 'style_projects')
  registerStyleHandlers(ipcMain, styleProjectsPath)

  registerStyleTemplateHandlers(ipcMain, parentDir)

  const templatesPath = join(parentDir, 'scene_templates')
  registerTemplateHandlers(ipcMain, templatesPath)

  registerExtractionHandlers(ipcMain)
  registerContinuationHandlers(ipcMain, parentDir)

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
