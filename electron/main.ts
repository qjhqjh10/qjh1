import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { registerFileHandlers, setupFileWatcher } from './ipc/fileHandlers'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerExportHandlers } from './ipc/exportHandlers'
import { registerAiHandlers } from './ipc/aiHandlers'
import { registerKbHandlers, autoIndexProjectFile } from './ipc/kbHandlers'
import { registerStatsHandlers } from './ipc/statsHandlers'

let mainWindow: BrowserWindow | null = null

function getProjectsBasePath(): string {
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return join(app.getAppPath(), 'projects')
  }
  return join(app.getPath('userData'), 'projects')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
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

app.whenReady().then(() => {
  const projectsPath = getProjectsBasePath()

  registerFileHandlers(ipcMain, (filePath, content) => autoIndexProjectFile(filePath, content, projectsPath), projectsPath)
  registerProjectHandlers(ipcMain, projectsPath)
  registerExportHandlers(ipcMain, () => mainWindow)
  registerAiHandlers(ipcMain, safeStorage)
  registerKbHandlers(ipcMain, projectsPath, () => mainWindow)
  registerStatsHandlers(ipcMain)

  const win = createWindow()

  // Set up file watcher for bidirectional sync (normalize paths for Windows)
  let watcher: ReturnType<typeof setupFileWatcher> | null = null
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
  console.error('App failed to start:', err)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { mainWindow }
