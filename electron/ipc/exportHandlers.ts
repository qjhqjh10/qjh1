import { IpcMain, BrowserWindow, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { showSaveDialog, showOpenDialog, isSafePath } from './utils'
import { logError } from './logger'
import type { ContinuationProject } from '../../src/types/continuation'

export function registerExportHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, projectsBasePath: string) {
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

  // ====================== Project Export ======================

  ipcMain.handle('export:project', async (_event, projectPath: string, outputPath: string) => {
    if (!isSafePath(projectPath, projectsBasePath)) throw new Error('项目路径不在允许范围内')
    return new Promise<void>((resolve, reject) => {
      const archiver = require('archiver')
      const archive = archiver('zip', { zlib: { level: 9 } })
      const output = require('fs').createWriteStream(outputPath)
      output.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(output)

      // Add project directory
      archive.directory(projectPath, path.basename(projectPath))

      // For continuation projects, include continuation_projects/ JSON
      const projectName = path.basename(projectPath)
      const contDir = path.join(path.dirname(projectsBasePath), 'continuation_projects')
      const contFile = path.join(contDir, `${projectName}.json`);
      try {
        const stat = require('fs').statSync(contFile)
        if (stat.isFile()) {
          archive.file(contFile, { name: `_continuation/${projectName}.json` })
        }
      } catch { /* not a continuation project */ }

      archive.finalize()
    })
  })

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
    const win = getWindow()
    const result = await showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('dialog:saveZip', async (_event, defaultName: string) => {
    const win = getWindow()
    const result = await showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: '项目压缩包', extensions: ['zip'] }],
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('dialog:openZip', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? null
    const result = await showOpenDialog(win, {
      title: '导入项目',
      filters: [{ name: '项目压缩包', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
