import { fileService } from './fileService'
import { logError } from '@/utils/logger'
import { htmlToMarkdown, markdownToHtml } from '@/utils/markdownConverter'

// v16.4.1: doc 部分文件夹化（outline/story/、outline/worldbuilding/）；旧平铺路径保留兼容回退
const PLOT_MD = (pp: string) => `${pp}/outline/story/plot.md`
const PLOT_MD_LEGACY = (pp: string) => `${pp}/outline/plot.md`
const PLOT_JSON = (pp: string) => `${pp}/outline/plot.json`
const PLOT_OLD = (pp: string) => `${pp}/outline/outline.json`
const WORLD_MD = (pp: string) => `${pp}/outline/worldbuilding/worldbuilding.md`
const WORLD_MD_LEGACY = (pp: string) => `${pp}/outline/worldbuilding.md`
const WORLD_JSON = (pp: string) => `${pp}/outline/worldbuilding.json`

// Generic fallback loader — tries each path, returns first successful read
async function tryReadPaths(projectPath: string, paths: Array<(pp: string) => string>): Promise<string> {
  for (const getPath of paths) {
    try {
      const raw = await fileService.read(getPath(projectPath))
      if (raw) return markdownToHtml(raw)
    } catch (err) { logError(`Failed to read outline from ${getPath(projectPath)}`, err) }
  }
  return ''
}

// Load: read Markdown from disk, convert to HTML for RichTextEditor.
// Legacy HTML files are detected and passed through unchanged.
export async function loadOutlineContent(projectPath: string): Promise<string> {
  return tryReadPaths(projectPath, [PLOT_MD, PLOT_MD_LEGACY, PLOT_JSON, PLOT_OLD, pp => `${pp}/outline/outline.txt`])
}

// Save: receive HTML from editor, convert to Markdown for disk.
export async function saveOutlineContent(projectPath: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline/story`)
    await fileService.write(PLOT_MD(projectPath), htmlToMarkdown(content))
  } catch (err) { logError('Failed to save plot', err) }
}

export async function loadWorldbuildingContent(projectPath: string): Promise<string> {
  return tryReadPaths(projectPath, [WORLD_MD, WORLD_MD_LEGACY, WORLD_JSON, pp => `${pp}/worldbuilding/worldbuilding.json`, pp => `${pp}/worldbuilding/worldbuilding.txt`])
}

export async function saveWorldbuildingContent(projectPath: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline/worldbuilding`)
    await fileService.write(WORLD_MD(projectPath), htmlToMarkdown(content))
  } catch (err) { logError('Failed to save worldbuilding', err) }
}
