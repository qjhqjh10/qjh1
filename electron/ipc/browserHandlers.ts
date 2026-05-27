// ── Browser Handlers ──
// Lightweight web page fetching using Node.js built-in fetch + html-to-text.
// For full browser automation, install puppeteer-core separately.

import { IpcMain } from 'electron'

const MAX_PAGE_SIZE = 100_000
const PAGE_TIMEOUT = 30_000

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PAGE_SIZE)
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 AIWritingAssistant/1.0' },
      signal: controller.signal,
    })
    const html = await res.text()
    return stripHtml(html)
  } finally {
    clearTimeout(timeout)
  }
}

export function registerBrowserHandlers(ipcMain: IpcMain) {
  ipcMain.handle('browser:open', async (_event, url: string) => {
    const clean = String(url || '').trim()
    if (!/^https?:\/\//.test(clean)) {
      return { status: 'error', summary: '仅支持 HTTP/HTTPS URL' }
    }
    try {
      const text = await fetchPage(clean)
      return {
        status: 'success',
        summary: `页面内容 (${text.length} 字符): ${clean.slice(0, 50)}`,
        detail: text,
      }
    } catch (err) {
      return { status: 'error', summary: `打开页面失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })

  ipcMain.handle('browser:search', async (_event, query: string) => {
    const q = encodeURIComponent(String(query || ''))
    const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`
    try {
      const text = await fetchPage(searchUrl)
      // Extract result snippets
      const lines = text.split('\n').filter(l => l.trim().length > 20).slice(0, 30)
      return {
        status: 'success',
        summary: `搜索结果: ${query}`,
        detail: lines.join('\n') || text.slice(0, 5000),
      }
    } catch (err) {
      return { status: 'error', summary: `搜索失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })

  ipcMain.handle('browser:screenshot', async () => {
    return { status: 'error', summary: '截图功能需要安装 puppeteer-core。在 Electron 窗口外运行: npm install puppeteer-core' }
  })
}
