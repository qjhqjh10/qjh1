import { IpcMain, BrowserWindow, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { showSaveDialog, isSafePath } from './utils'
import { logError } from './logger'

export function registerExportHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('export:chapters', async (_event, options: {
    chapters: { title: string; content: string }[]
    outputPath: string
    type: 'summary' | 'body'
  }) => {
    if (!isSafePath(options.outputPath, app.getPath('documents'))) {
      throw new Error('导出路径不在允许范围内')
    }
    const output = options.chapters
      .map(ch => `=== ${ch.title || '未命名'} ===\n\n${ch.content || ''}\n\n`)
      .join('')
    try {
      await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
      await fs.writeFile(options.outputPath, output, 'utf-8')
    } catch (err) {
      logError(`导出失败: ${options.outputPath}`, err)
      throw err
    }
  })

  ipcMain.handle('export:singleChapter', async (_event, options: {
    title: string; content: string; outputPath: string
  }) => {
    if (!isSafePath(options.outputPath, app.getPath('documents'))) {
      throw new Error('导出路径不在允许范围内')
    }
    const output = `${options.title || '未命名'}\n\n${options.content || ''}`
    try {
      await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
      await fs.writeFile(options.outputPath, output, 'utf-8')
    } catch (err) {
      logError(`导出失败: ${options.outputPath}`, err)
      throw err
    }
  })

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
    const win = getWindow()
    const result = await showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    })
    return result.canceled ? null : result.filePath
  })
}
