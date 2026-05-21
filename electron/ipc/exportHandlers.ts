import { IpcMain, BrowserWindow, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { showSaveDialog, showOpenDialog, isSafePath } from './utils'
import { logError } from './logger'

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
    if (!isSafePath(outputPath, app.getPath('documents'))) throw new Error('导出路径不在允许范围内')
    return new Promise<void>((resolve, reject) => {
      const archiver = require('archiver')
      const archive = archiver('zip', { zlib: { level: 9 } })
      const output = require('fs').createWriteStream(outputPath)
      output.on('close', resolve)
      output.on('error', reject)
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
    const isEpub = defaultName.endsWith('.epub')
    const result = await showSaveDialog(win, {
      defaultPath: defaultName,
      filters: isEpub
        ? [{ name: 'EPUB 电子书', extensions: ['epub'] }]
        : [{ name: 'Text Files', extensions: ['txt'] }],
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

  const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // EPUB export
  ipcMain.handle('export:epub', async (_event, options: {
    title: string; author: string; chapters: { title: string; content: string }[]; outputPath: string
  }) => {
    if (!isSafePath(options.outputPath, app.getPath('documents'))) throw new Error('导出路径不在允许范围内')
    try {
      const archiver = require('archiver')
      const output = require('fs').createWriteStream(options.outputPath)
      const archive = archiver('zip', { zlib: { level: 9 } })
      archive.pipe(output)

      await new Promise<void>((resolve, reject) => {
        let archiveErr: Error | null = null; let outputErr: Error | null = null
        archive.on('error', (e: Error) => { archiveErr = e; reject(e) })
        output.on('error', (e: Error) => { outputErr = e; reject(e) })
        output.on('close', () => { if (!archiveErr && !outputErr) resolve() })

        // mimetype (must be first, uncompressed)
        archive.append('application/epub+zip', { name: 'mimetype', store: true })
        archive.append(`<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`, { name: 'META-INF/container.xml' })

        const chapterFiles: { id: string; href: string }[] = []
        const imageManifestItems: string[] = []
        for (let i = 0; i < options.chapters.length; i++) {
          const ch = options.chapters[i]
          const id = `ch${i + 1}`
          const href = `chapter${i + 1}.xhtml`
          chapterFiles.push({ id, href })
          let body = ch.content
          // Extract base64 images
          body = body.replace(/<img\s[^>]*src="(data:image\/[^"]*)"[^>]*>/gi, (_m: string, dataUri: string) => {
            try {
              const imgId = `img${i}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
              const mime = (dataUri.split(';')[0]?.split(':')[1] || 'image/png').split('/')[1] || 'png'
              const base64 = dataUri.split(',')[1] || ''
              if (!base64) return ''
              archive.append(Buffer.from(base64, 'base64'), { name: `OEBPS/images/${imgId}.${mime}` })
              imageManifestItems.push(`<item id="${imgId}" href="images/${imgId}.${mime}" media-type="image/${mime}"/>`)
              return `<img src="images/${imgId}.${mime}" alt=""/>`
            } catch { return '' }
          })
          // Strip non-base64 img tags (keep external URLs)
          body = body.replace(/<img\s[^>]*>/gi, '')
          archive.append(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escXml(ch.title)}</title></head><body><h2>${escXml(ch.title)}</h2>${body}</body></html>`, { name: `OEBPS/${href}` })
        }

        const chItems = chapterFiles.map(cf => `<item id="${cf.id}" href="${cf.href}" media-type="application/xhtml+xml"/>`).join('')
        const spineItems = chapterFiles.map(cf => `<itemref idref="${cf.id}"/>`).join('')
        archive.append(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escXml(options.title)}</dc:title><dc:creator>${escXml(options.author)}</dc:creator><dc:language>zh-CN</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${chItems}${imageManifestItems.join('')}</manifest><spine>${spineItems}</spine></package>`, { name: 'OEBPS/content.opf' })

        const navPoints = chapterFiles.map((cf, i) => `<navPoint id="nav${cf.id}" playOrder="${i + 1}"><navLabel><text>${escXml(options.chapters[i].title)}</text></navLabel><content src="${cf.href}"/></navPoint>`).join('')
        archive.append(`<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="book-id"/></head><docTitle><text>${escXml(options.title)}</text></docTitle><navMap>${navPoints}</navMap></ncx>`, { name: 'OEBPS/toc.ncx' })

        archive.finalize()
      })
    } catch (err) {
      logError('EPUB导出失败', err)
      throw err
    }
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
