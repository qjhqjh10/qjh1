// ── 文件技能加载器 ──
// 从文件系统加载技能定义。
// 支持格式：.json, .js, .ts（通过动态 import）
//
// 文件结构示例：
//   my-skills/
//   ├── manifest.json          ← 可选清单
//   ├── character-review.json   ← 单个技能
//   └── worldbuilding.json

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SkillDefinition, SkillSource, SkillSourceType } from '../types'

interface FileSkillLoaderOptions {
  /** 技能文件扩展名 */
  extensions?: string[]
  /** 是否监听文件变更（热重载） */
  watch?: boolean
}

export class FileSkillLoader implements SkillSource {
  readonly id: string
  readonly type: SkillSourceType = 'file'
  readonly description: string

  private dirPath: string
  private options: Required<FileSkillLoaderOptions>
  private watcher: fs.FSWatcher | null = null

  constructor(dirPath: string, description?: string, options?: FileSkillLoaderOptions) {
    this.dirPath = path.resolve(dirPath)
    this.description = description || `文件技能: ${this.dirPath}`
    this.id = `file:${this.dirPath}`
    this.options = {
      extensions: options?.extensions || ['.json'],
      watch: options?.watch ?? false,
    }
  }

  async discover(): Promise<SkillDefinition[]> {
    const skills: SkillDefinition[] = []

    try {
      const entries = fs.readdirSync(this.dirPath, { withFileTypes: true })

      // 先检查 manifest.json
      const manifestFile = entries.find(e => e.isFile() && e.name === 'manifest.json')
      if (manifestFile) {
        try {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(this.dirPath, 'manifest.json'), 'utf-8')
          )
          if (manifest.skills && Array.isArray(manifest.skills)) {
            for (const skill of manifest.skills) {
              skills.push(this.normalizeSkill(skill))
            }
            return skills
          }
        } catch {
          // manifest 解析失败，回退到逐文件读取
        }
      }

      // 逐文件读取
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name)
        if (!this.options.extensions.includes(ext)) continue
        if (entry.name === 'manifest.json') continue

        try {
          const filePath = path.join(this.dirPath, entry.name)
          const content = fs.readFileSync(filePath, 'utf-8')
          const skill = JSON.parse(content)

          if (skill.id && skill.name) {
            skills.push(this.normalizeSkill(skill))
          }
        } catch {
          console.warn(`[FileSkillLoader] 跳过无效文件: ${entry.name}`)
        }
      }
    } catch {
      // 目录不存在
    }

    return skills
  }

  async load(skillId: string): Promise<SkillDefinition | null> {
    try {
      // 尝试从 manifest 加载
      const manifestPath = path.join(this.dirPath, 'manifest.json')
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        const found = manifest.skills?.find((s: SkillDefinition) => s.id === skillId)
        if (found) return this.normalizeSkill(found)
      }

      // 尝试从独立文件加载
      const filePath = path.join(this.dirPath, `${skillId}.json`)
      if (fs.existsSync(filePath)) {
        const skill = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        return this.normalizeSkill(skill)
      }

      return null
    } catch {
      return null
    }
  }

  async reload(): Promise<SkillDefinition[]> {
    return this.discover()
  }

  async has(skillId: string): Promise<boolean> {
    const skill = await this.load(skillId)
    return skill !== null
  }

  async count(): Promise<number> {
    const skills = await this.discover()
    return skills.length
  }

  /** 设置文件监听（热重载） */
  enableWatch(): void {
    if (this.watcher) return
    try {
      this.watcher = fs.watch(this.dirPath, { persistent: false }, () => {
        console.log(`[FileSkillLoader] 检测到技能文件变更: ${this.dirPath}`)
      })
    } catch {
      // 不支持监听
    }
  }

  disableWatch(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /** 标准化技能定义，补全缺失字段 */
  private normalizeSkill(raw: Partial<SkillDefinition> & { id: string; name: string }): SkillDefinition {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description || raw.name,
      triggerPatterns: raw.triggerPatterns || [raw.name],
      category: raw.category || 'general',
      workflow: raw.workflow || { description: raw.description || '', steps: [] },
      qualityChecks: raw.qualityChecks || [],
      inputSchema: raw.inputSchema || { fields: [], extractionHint: '' },
      examples: raw.examples || [],
      metadata: {
        version: raw.metadata?.version || '1.0.0',
        author: raw.metadata?.author || 'unknown',
        source: 'file',
        sourcePath: this.dirPath,
        enabled: raw.metadata?.enabled ?? true,
        priority: raw.metadata?.priority || 50,
        createdAt: raw.metadata?.createdAt || new Date().toISOString(),
        updatedAt: raw.metadata?.updatedAt || new Date().toISOString(),
      },
    }
  }
}
