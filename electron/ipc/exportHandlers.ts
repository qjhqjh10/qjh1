import { IpcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'

export function registerExportHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('export:chapters', async (_event, options: {
    chapters: { title: string; content: string }[]
    outputPath: string
    type: 'summary' | 'body'
  }) => {
    const output = options.chapters
      .map(ch => `=== ${ch.title || '未命名'} ===\n\n${ch.content || ''}\n\n`)
      .join('')
    await fs.writeFile(options.outputPath, output, 'utf-8')
  })

  ipcMain.handle('export:singleChapter', async (_event, options: {
    title: string; content: string; outputPath: string
  }) => {
    const output = `${options.title || '未命名'}\n\n${options.content || ''}`
    await fs.writeFile(options.outputPath, output, 'utf-8')
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win || undefined, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win || undefined, {
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    })
    return result.canceled ? null : result.filePath
  })
}
