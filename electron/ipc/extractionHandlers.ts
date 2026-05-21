import { IpcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { showOpenDialog, readFileWithEncoding, isSafePath } from './utils'
import { logError } from './logger'

let extractionBasePath = ''

export function registerExtractionHandlers(ipcMain: IpcMain, basePath?: string) {
  if (basePath) extractionBasePath = basePath

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

  // 从项目内路径导入（跳过文件选择器）
  ipcMain.handle('extraction:importFromPath', async (_event, filePath: string) => {
    if (!extractionBasePath || !isSafePath(filePath, extractionBasePath)) {
      throw new Error('路径不在项目目录内')
    }
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
