// ── 插件技能加载器 ──
// 允许外部插件动态注入技能。
//
// 使用方式：
//   // 1. 实现 SkillPlugin 接口
//   const myPlugin: SkillPlugin = {
//     id: 'community-writing-skills',
//     name: '社区写作技能包',
//     version: '1.0.0',
//     getSkills: () => [myCustomSkill],
//     onLoad: () => console.log('loaded'),
//     onUnload: () => console.log('unloaded'),
//   }
//
//   // 2. 注册到 registry
//   registry.addSource(new PluginSkillLoader(myPlugin))
//
//   // 3. 用户消息匹配时自动生效

import type { SkillDefinition, SkillSource, SkillSourceType } from '../types'

/** 技能插件接口 —— 第三方实现此接口来注入技能 */
export interface SkillPlugin {
  /** 插件唯一标识 */
  id: string
  /** 插件名称 */
  name: string
  /** 版本号 */
  version: string
  /** 插件描述 */
  description?: string
  /** 作者 */
  author?: string

  /** 获取该插件提供的所有技能 */
  getSkills(): SkillDefinition[] | Promise<SkillDefinition[]>

  /** 加载回调（插件被注册时调用） */
  onLoad?(): void | Promise<void>

  /** 卸载回调（插件被移除时调用） */
  onUnload?(): void | Promise<void>

  /** 配置更新回调 */
  onConfigChange?(config: Record<string, unknown>): void | Promise<void>
}

export class PluginSkillLoader implements SkillSource {
  readonly id: string
  readonly type: SkillSourceType = 'plugin'
  readonly description: string

  private plugin: SkillPlugin
  private loaded = false
  private skills: SkillDefinition[] = []

  constructor(plugin: SkillPlugin) {
    this.plugin = plugin
    this.id = `plugin:${plugin.id}`
    this.description = plugin.description || `插件技能: ${plugin.name} v${plugin.version}`
  }

  async discover(): Promise<SkillDefinition[]> {
    if (!this.loaded) {
      await this.plugin.onLoad?.()
      this.loaded = true
    }

    const rawSkills = await Promise.resolve(this.plugin.getSkills())
    this.skills = rawSkills.map(s => this.decorateSkill(s))
    return this.skills
  }

  async load(skillId: string): Promise<SkillDefinition | null> {
    const skills = await this.discover()
    return skills.find(s => s.id === skillId) || null
  }

  async reload(): Promise<SkillDefinition[]> {
    this.loaded = false
    this.skills = []
    return this.discover()
  }

  async has(skillId: string): Promise<boolean> {
    const s = await this.load(skillId)
    return s !== null
  }

  async count(): Promise<number> {
    const skills = await this.discover()
    return skills.length
  }

  /** 卸载插件 */
  async unload(): Promise<void> {
    await this.plugin.onUnload?.()
    this.loaded = false
    this.skills = []
  }

  /** 更新插件配置 */
  async updateConfig(config: Record<string, unknown>): Promise<void> {
    await this.plugin.onConfigChange?.(config)
  }

  getPlugin(): SkillPlugin {
    return this.plugin
  }

  /** 给技能标注来源 */
  private decorateSkill(skill: SkillDefinition): SkillDefinition {
    return {
      ...skill,
      metadata: {
        ...skill.metadata,
        source: 'plugin' as SkillSourceType,
        pluginId: this.plugin.id,
        author: skill.metadata.author || this.plugin.author || 'unknown',
        version: skill.metadata.version || this.plugin.version,
      },
    }
  }
}

// ═══════════════════════════════════════════════════
//  便捷工厂函数
// ═══════════════════════════════════════════════════

/**
 * 从技能数组快速创建插件。
 * 最简单的插件创建方式。
 *
 * @example
 *   const plugin = createSimplePlugin('my-skills', '我的技能', [
 *     characterReviewSkill,
 *     worldbuildingSkill,
 *   ])
 *   registry.addSource(new PluginSkillLoader(plugin))
 */
export function createSimplePlugin(
  id: string,
  name: string,
  skills: SkillDefinition[],
  options?: { version?: string; author?: string; description?: string },
): SkillPlugin {
  return {
    id,
    name,
    version: options?.version || '1.0.0',
    author: options?.author,
    description: options?.description,
    getSkills: () => skills,
  }
}

/**
 * 从远程 URL 加载技能的插件工厂。
 * 注意：此函数返回一个异步加载的插件，首次 getSkills 时会 fetch。
 *
 * @example
 *   const plugin = createRemotePlugin('community-pack',
 *     'https://skills.example.com/pack/v1/manifest.json')
 *   registry.addSource(new PluginSkillLoader(plugin))
 */
export function createRemotePlugin(
  id: string,
  manifestUrl: string,
  options?: { name?: string; version?: string; refreshInterval?: number },
): SkillPlugin {
  let cached: SkillDefinition[] | null = null
  let lastFetch = 0

  return {
    id,
    name: options?.name || id,
    version: options?.version || '0.0.0',
    description: `远程技能: ${manifestUrl}`,
    getSkills: async () => {
      const now = Date.now()
      const ttl = (options?.refreshInterval || 3600_000) // 默认 1 小时缓存
      if (cached && (now - lastFetch) < ttl) return cached

      try {
        const res = await fetch(manifestUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        if (Array.isArray(data)) {
          cached = data
        } else if (data.skills && Array.isArray(data.skills)) {
          cached = data.skills
        } else {
          console.warn(`[RemotePlugin] 无法解析远程技能清单: ${manifestUrl}`)
          return cached || []
        }

        lastFetch = now
        return cached!
      } catch (err) {
        console.warn(`[RemotePlugin] 加载远程技能失败: ${manifestUrl}`, err)
        return cached || []
      }
    },
  }
}
