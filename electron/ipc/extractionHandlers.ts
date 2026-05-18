import { IpcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { showOpenDialog, readFileWithEncoding } from './utils'
import { logError } from './logger'

export function registerExtractionHandlers(ipcMain: IpcMain) {
  ipcMain.handle('extraction:importFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? null
    const result = await showOpenDialog(win, {
      title: '导入TXT小说',
      filters: [{ name: '文本文件', extensions: ['txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    try {
      const content = await readFileWithEncoding(filePath)
      if (!content || content.trim().length === 0) throw new Error('文件为空')
      return { name: path.basename(filePath), content }
    } catch (err) {
      logError(`文件读取失败: ${filePath}`, err)
      throw err
    }
  })
}
