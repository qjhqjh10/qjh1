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

  // Match blacklist table rows（表头: 目录/文件 | 内容 | 风险等级 | gitignore? | 打包风险）
  // M4 审查修正: 原正则跳过的是"内容"列导致 risk 绑定错列 → highRisk 恒空、断言恒真空
  const blacklistRegex = /\| `([^`]+)` \| [^|]+ \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/g
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

  // ── 1. extraResources 只能包含 AI 运行时必需的静态资源 ──
  it('1. extraResources 仅含 .aiharness 静态资源 — 禁止用户数据目录', () => {
    const config = loadElectronBuilder()
    expect(config).not.toBeNull()

    const extra = config?.extraResources
    // extraResources 可以包含 from/to 对象或字符串
    const items = Array.isArray(extra) ? extra : []

    // 安全的 extraResource 路径（仅限 .aiharness 下的静态资源）
    const SAFE_RESOURCES = [
      '.aiharness/templates',
      '.aiharness/rules',
      '.aiharness/scripts',
      '.aiharness/aiharness.json',
      '.aiharness/AGENTS.md',
    ]

    // 禁止的用户数据目录
    const FORBIDDEN = [
      'projects', 'knowledge_base', 'uploads', 'notes',
      'agent-sessions', 'continuation_projects', 'style_projects',
      '.appdata', '.ai_backups', 'coverage', '测试',
    ]

    for (const item of items) {
      // item can be string or { from, to }
      const path = typeof item === 'string' ? item : (item.from || item.to || '')
      // Must be in safe list
      const isSafe = SAFE_RESOURCES.some(s => path === s || path.startsWith(s + '/'))
      // Must not be in forbidden list
      const hasForbidden = FORBIDDEN.some(f => path.includes(f))

      expect(isSafe).toBe(true)
      expect(hasForbidden).toBe(false)
    }
    // Ensure we have the expected 4 resources（v15.0.0: scripts 空目录已从 extraResources 移除）
    expect(items.length).toBe(4)
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
  it('6. 实际目录检查 — 存在的用户数据目录必须被 .gitignore 覆盖', () => {
    const rules = parsePackagingRules()
    if (!rules) return

    const gitignore = loadGitignore()

    const userDirs = rules.blacklist.map(b => {
      const dirName = b.dir.replace(/\/$/, '').split('/').pop()!
      return { name: dirName, path: path.join(PROJECT_ROOT, dirName) }
    })

    let checked = 0
    for (const dir of userDirs) {
      if (fs.existsSync(dir.path)) {
        const size = getDirSize(dir.path)
        if (size > 0) {
          // M4: 真实断言——存在的用户数据目录必须被 gitignore 覆盖（精确或通配前缀）
          const ignored = [...gitignore].some(g =>
            g === dir.name || g.startsWith(dir.name + '/') || g.startsWith('**/' + dir.name))
          expect(ignored).toBe(true)
          checked++
        }
      }
    }
    // 防空洞：必须实际检查到至少一个目录
    expect(checked).toBeGreaterThan(0)
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
  it('ContractExecutor 剥离 generate_image 结果的 base64/数据字段', async () => {
    // M4: 引用真实 ContractExecutor（原测试自造字面量断言恒真）
    const { ContractExecutor } = await import('../src/agent/context/ContractExecutor')
    const imageResult = {
      status: 'success',
      summary: '已生成图片',
      detail: '图片路径: images/ai_001.png\n花费: $0.02',
      // 模拟工具实现泄露敏感字段（真实执行器不应透传）
      base64Data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      dataUrl: 'data:image/png;base64,xxx',
    }
    const { resultForApi } = ContractExecutor.filterForContext('generate_image', imageResult as any)

    // generate_image 契约 = status/summary/detail → base64/dataUrl 必须被剥离
    expect(resultForApi).not.toHaveProperty('base64Data')
    expect(resultForApi).not.toHaveProperty('dataUrl')
    expect(JSON.stringify(resultForApi)).not.toContain('base64')
    expect(resultForApi.detail!.length).toBeLessThan(100)
  })
})
