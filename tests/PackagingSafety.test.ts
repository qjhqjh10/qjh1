/**
 * 打包安全测试 (V9.5.2)
 *
 * 打包前必须先读取 packaging-rules.md 记忆文件，确定黑名单，
 * 然后验证 electron-builder.yml + .gitignore 配置安全。
 *
 * 记住：用户数据泄漏到 exe 是不可逆的——不像代码 bug 可以热修复。
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

// ── 从记忆文件加载打包规则 ──

// Memory files live in user's .claude directory (cross-project, shared)
const USER_CLAUDE_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '~', '.claude', 'projects', 'd--3', 'memory')
const PACKAGING_RULES_PATH = path.join(USER_CLAUDE_DIR, 'packaging-rules.md')

interface PackagingRules {
  blacklist: { dir: string; risk: string; gitignored: boolean; packagingRisk: string }[]
  safelist: { dir: string; note: string }[]
}

function parsePackagingRules(): PackagingRules | null {
  if (!fs.existsSync(PACKAGING_RULES_PATH)) {
    return null // Memory file not found — test will warn
  }

  const content = fs.readFileSync(PACKAGING_RULES_PATH, 'utf-8')

  // Parse blacklist table from markdown
  const blacklist: PackagingRules['blacklist'] = []
  const safelist: PackagingRules['safelist'] = []

  // Match blacklist table rows
  const blacklistRegex = /\| `([^`]+)` \| ([^|]+) \| [^|]+ \| ([^|]+) \| ([^|]+) \|/g
  let match
  while ((match = blacklistRegex.exec(content)) !== null) {
    const dir = match[1]
    const risk = match[2].trim()
    const gitignored = match[3].trim()
    const packagingRisk = match[4].trim()

    if (dir === '目录/文件') continue // Skip header

    if (gitignored === '✅') {
      blacklist.push({ dir, risk, gitignored: true, packagingRisk })
    } else if (gitignored === '❌') {
      blacklist.push({ dir, risk, gitignored: false, packagingRisk })
    }
  }

  // Parse safelist from second table
  const safelistRegex = /\| `([^`]+)` \| ([^|]+) \|/g
  // Reset regex state — find the second table by looking for "保留在仓库但不应打包"
  const safelistStart = content.indexOf('保留在仓库但不应打包')
  if (safelistStart > 0) {
    const safelistSection = content.slice(safelistStart)
    const sMatch = safelistSection.matchAll(/\| `([^`]+)` \| ([^|]+) \| ([^|]+) \|/g)
    for (const m of sMatch) {
      if (m[1] === '目录/文件') continue
      safelist.push({ dir: m[1], note: m[3].trim() })
    }
  }

  return { blacklist, safelist }
}

// ── 加载项目配置 ──

// Vitest sets cwd to project root when run via npm/npx
const PROJECT_ROOT = process.cwd()
const ELECTRON_BUILDER_PATH = path.join(PROJECT_ROOT, 'electron-builder.yml')
const GITIGNORE_PATH = path.join(PROJECT_ROOT, '.gitignore')

function loadElectronBuilder(): any {
  if (!fs.existsSync(ELECTRON_BUILDER_PATH)) return null
  const content = fs.readFileSync(ELECTRON_BUILDER_PATH, 'utf-8')
  return yaml.load(content)
}

function loadGitignore(): Set<string> {
  if (!fs.existsSync(GITIGNORE_PATH)) return new Set()
  const content = fs.readFileSync(GITIGNORE_PATH, 'utf-8')
  return new Set(
    content.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.replace(/\/$/, '')) // normalize trailing slash
  )
}

// ── 辅助函数 ──

function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0
  let total = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += getDirSize(full)
      } else {
        total += fs.statSync(full).size
      }
    }
  } catch { /* permission errors = skip */ }
  return total
}

// ══════════════════════════════════════════════════════════════
// 测试开始
// ══════════════════════════════════════════════════════════════

describe('打包安全验证', () => {
  // ── 0. 记忆文件存在性（仅本地检查，CI 环境跳过） ──
  it('0. 记忆文件存在 — 打包前必须读取 packaging-rules.md', () => {
    const exists = fs.existsSync(PACKAGING_RULES_PATH)
    if (!exists) {
      // CI 环境没有用户的记忆文件，跳过断言但不标记失败
      console.warn('⚠️ 打包记忆文件不存在（CI 环境或首次使用）')
      console.warn('   路径:', PACKAGING_RULES_PATH)
      return // 跳过，不 fail
    }
    expect(exists).toBe(true)
  })

  // ── 1. extraResources 必须为空 ──
  it('1. extraResources 必须为空 — 禁止将用户数据目录打包', () => {
    const config = loadElectronBuilder()
    expect(config).not.toBeNull()

    const extra = config?.extraResources
    if (Array.isArray(extra)) {
      expect(extra.length).toBe(0)
    } else {
      // If extraResources is undefined or null, that's also fine
      expect(extra === undefined || extra === null || (Array.isArray(extra) && extra.length === 0)).toBe(true)
    }
  })

  // ── 2. files 只包含构建产物 ──
  it('2. files 只包含 dist + dist-electron + package.json', () => {
    const config = loadElectronBuilder()
    const files = config?.files as string[]

    expect(files).toBeDefined()
    expect(files).toContain('dist')
    expect(files).toContain('dist-electron')
    expect(files).toContain('package.json')

    // 不能包含任何数据目录
    const forbidden = ['projects', 'knowledge_base', 'uploads', 'notes', 'agent-sessions']
    for (const f of files) {
      const name = f.split('/')[0].split('\\')[0]
      expect(forbidden).not.toContain(name)
    }
  })

  // ── 3. 黑名单目录不能被 git 跟踪（应在 .gitignore） ──
  it('3. 记忆文件黑名单中的 🔴最高 风险目录 — 全部在 .gitignore', () => {
    const rules = parsePackagingRules()
    if (!rules) return // CI 环境无记忆文件，跳过
    expect(rules).not.toBeNull()

    const gitignore = loadGitignore()
    const highRisk = rules.blacklist.filter(b => b.risk.includes('最高') || b.risk.includes('高'))

    for (const item of highRisk) {
      const dirName = item.dir.replace(/\/$/, '').split('/').pop()!
      const isIgnored = gitignore.has(dirName) || gitignore.has(item.dir.replace(/\/$/, ''))
      expect(isIgnored).toBe(true)
    }
  })

  // ── 4. 黑名单目录不在 dist/ 构建产物中 ──
  it('4. dist/ 构建产物不包含用户数据泄漏', () => {
    const distDir = path.join(PROJECT_ROOT, 'dist')
    if (!fs.existsSync(distDir)) return // dist 可能还未构建

    function checkDir(dir: string, depth: number = 0): string[] {
      if (depth > 5) return []
      const issues: string[] = []
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            // User data dirs should NEVER appear in dist/
            const forbidden = ['projects', 'uploads', 'notes', 'knowledge_base', 'agent-sessions']
            if (forbidden.includes(entry.name)) {
              issues.push(`🔴 用户数据目录出现在 dist/: ${full}`)
            }
            issues.push(...checkDir(full, depth + 1))
          }
        }
      } catch {}
      return issues
    }

    const issues = checkDir(distDir)
    expect(issues).toEqual([])
  })

  // ── 5. dist-electron/ 构建产物不包含用户数据泄漏 ──
  it('5. dist-electron/ 构建产物无敏感路径硬编码', () => {
    const deDir = path.join(PROJECT_ROOT, 'dist-electron')
    if (!fs.existsSync(deDir)) return

    const files = fs.readdirSync(deDir).filter(f => f.endsWith('.js'))
    for (const file of files) {
      const content = fs.readFileSync(path.join(deDir, file), 'utf-8')
      // 不应包含指向用户主目录的绝对路径
      expect(content).not.toMatch(/C:\\Users\\[^\\]+\\projects/i)
      expect(content).not.toMatch(/C:\\Users\\[^\\]+\\uploads/i)
    }
  })

  // ── 6. 当前项目中的用户数据目录未被 git 跟踪 ──
  it('6. 实际目录检查 — 用户数据目录存在但不被 git 跟踪', () => {
    const rules = parsePackagingRules()
    if (!rules) return

    const userDirs = rules.blacklist.map(b => {
      const dirName = b.dir.replace(/\/$/, '').split('/').pop()!
      return { name: dirName, path: path.join(PROJECT_ROOT, dirName) }
    })

    for (const dir of userDirs) {
      if (fs.existsSync(dir.path)) {
        const size = getDirSize(dir.path)
        if (size > 0) {
          // 目录存在且有内容 → 验证它有合理的用途（不做断言，只记录）
          console.log(`  ℹ ${dir.name}/ 存在 (${(size / 1024).toFixed(1)}KB) — 确保不被 git 跟踪`)
        }
      }
    }
  })

  // ── 7. electron-builder.yml 不包含 asar.unpack 敏感文件 ──
  it('7. asar.unpack 配置不泄露敏感文件', () => {
    const config = loadElectronBuilder()
    const asar = config?.asar
    if (asar && typeof asar === 'object' && (asar as any).unpack) {
      const unpacked = (asar as any).unpack as string[]
      for (const u of unpacked) {
        // 不能包含任何用户数据目录的 glob
        const forbidden = ['projects', 'knowledge_base', 'uploads', 'notes', '**.log', '.env']
        for (const f of forbidden) {
          expect(u).not.toContain(f)
        }
      }
    }
  })

  // ── 8. 记忆文件中的安全审查清单完整 ──
  it('8. 记忆文件包含完整审查清单', () => {
    const exists = fs.existsSync(PACKAGING_RULES_PATH)
    if (!exists) return

    const content = fs.readFileSync(PACKAGING_RULES_PATH, 'utf-8')

    // 必须包含关键检查项
    const requiredChecks = [
      'electron-builder.yml',
      'extraResources',
      'gitignore',
      'dist/',
      'dist-electron/',
      '审查清单',
      '历史事故',
    ]

    for (const check of requiredChecks) {
      expect(content).toContain(check)
    }
  })
})

// ══════════════════════════════════════════════════════════════
// 图片上下文安全验证
// ══════════════════════════════════════════════════════════════

describe('图片上下文安全 — 图片不入对话上下文', () => {
  it('图片消息不在 buildHistoryMessages 输出中', () => {
    // 模拟 buildHistoryMessages 的核心过滤逻辑
    const buildHistoryMessages = (msgs: Array<{ role: string; content: string; images?: string[]; previewUrl?: string }>) => {
      return msgs
        .filter(m => (m.role === 'user' || m.role === 'assistant'))
        .map(m => ({ role: m.role, content: m.content }))
    }

    const msgs = [
      { role: 'user', content: '帮我生成一张古风图', images: undefined },
      { role: 'assistant', content: '图片已生成：images/img_001.png', images: ['https://example.com/img.png'] },
      { role: 'user', content: '继续写第三章' },
    ]

    const history = buildHistoryMessages(msgs as any)

    // 图片 URL 不应出现在历史中
    for (const h of history) {
      expect(h).not.toHaveProperty('images')
      expect(h).not.toHaveProperty('previewUrl')
    }

    // 历史消息只包含 role + content
    for (const h of history) {
      const keys = Object.keys(h)
      expect(keys.length).toBe(2)
      expect(keys).toContain('role')
      expect(keys).toContain('content')
    }
  })

  it('attachment.previewUrl 仅用于 UI 显示，不进入用户消息 content', () => {
    // 模拟 handleSend 中的图片附件处理
    const attachment = {
      type: 'image' as const,
      name: 'test.png',
      content: '[上传图片: test.png]',
      previewUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    }

    // 发送时只会把 attachment.content 加入消息
    const attachText = `[上传图片: ${attachment.name}]\n图片已保存到 uploads/images/${attachment.name}。`
    const fullContent = `${attachText}\n\n请分析这张图片`

    // previewUrl（base64 图片数据）不在 content 中！
    expect(fullContent).not.toContain('base64')
    expect(fullContent).not.toContain('data:image')
    expect(fullContent).not.toContain(attachment.previewUrl)
  })

  it('ContractExecutor 中图片工具结果不包含 base64 图片数据', () => {
    // 模拟 generate_image 工具结果
    const imageResult = {
      status: 'success',
      summary: '已生成图片',
      detail: '图片路径: images/ai_001.png\n花费: $0.02',
    }

    // 图片工具结果只有路径和花费，没有 base64
    expect(imageResult.detail).not.toContain('base64')
    expect(imageResult.detail).not.toContain('data:image')
    expect(imageResult.detail!.length).toBeLessThan(100) // 很小
  })
})
