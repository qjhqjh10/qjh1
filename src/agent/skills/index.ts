// ── 技能系统 — 统一入口 ──
// 使用方式：
//   import { initSkills, skillRegistry, skillToolRegistry } from '@/agent/skills'
//   initSkills()  // 在 app 启动时调用一次
//   const matches = skillRegistry.match('创建女主林雨晴')
//
// 扩展方式：
//   import { FileSkillLoader, PluginSkillLoader, createSimplePlugin } from '@/agent/skills'
//   skillRegistry.addSource(new FileSkillLoader('./my-skills/'))
//   skillRegistry.addSource(new PluginSkillLoader(myPlugin))

// ── 核心 ──
export { SkillToolRegistry, skillToolRegistry } from './ToolRegistry'
export { SkillRegistry, skillRegistry } from './SkillRegistry'

// ── 类型 ──
export type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
  SkillDefinition,
  SkillCategory,
  SkillStep,
  SkillWorkflow,
  SkillInputField,
  SkillInputSchema,
  SkillExample,
  SkillMetadata,
  SkillSourceType,
  SkillMatch,
  SkillExecutionResult,
  SkillPromptContext,
  SkillPromptFragment,
} from './types'

// ── 加载器 ──
export { FileSkillLoader } from './loader/FileSkillLoader'
export {
  PluginSkillLoader,
  createSimplePlugin,
  createRemotePlugin,
  type SkillPlugin,
} from './loader/PluginSkillLoader'

// 技能来源接口
export type { SkillSource } from './types'

// ── 核心实例 ──
import { skillRegistry } from './SkillRegistry'

// ── 内置技能（10个） ──
import { characterSkill } from './builtin/character'
import { outlineSkill } from './builtin/outline'
import { detailedOutlineSkill } from './builtin/detailedOutline'
import { chapterWritingSkill } from './builtin/chapterWriting'
import { chapterPolishSkill } from './builtin/chapterPolish'
import { styleTemplateSkill } from './builtin/styleTemplate'
import { sceneTemplateSkill } from './builtin/sceneTemplate'
import { knowledgeBaseSkill } from './builtin/knowledgeBase'
import { textProcessorSkill } from './builtin/textProcessor'
import { taskOrchestrationSkill } from './builtin/taskOrchestration'
import type { SkillDefinition } from './types'

export const BUILTIN_SKILLS: SkillDefinition[] = [
  taskOrchestrationSkill,  // v9.5.3: 最高优先级 — 多意图编排
  characterSkill,
  outlineSkill,
  detailedOutlineSkill,
  chapterWritingSkill,
  chapterPolishSkill,
  styleTemplateSkill,
  sceneTemplateSkill,
  knowledgeBaseSkill,
  textProcessorSkill,    // v9.5.4: 合并 textAnalysis + textImport
]

/**
 * 初始化技能系统（同步）。
 * 在 app 启动时调用一次。
 * 注册所有内置技能。
 */
export function initSkills(): void {
  skillRegistry.registerBuiltins(BUILTIN_SKILLS)
  console.log(`[Skills] 已注册 ${BUILTIN_SKILLS.length} 个内置技能`)
}

/**
 * 初始化技能系统（异步版本）。
 * 注册内置技能 + 可选的额外技能来源。
 */
export async function initSkillsAsync(
  additionalSources?: Array<{ type: 'file' | 'plugin'; config: unknown }>,
): Promise<void> {
  skillRegistry.registerBuiltins(BUILTIN_SKILLS)

  if (additionalSources) {
    for (const src of additionalSources) {
      if (src.type === 'file') {
        const { FileSkillLoader } = await import('./loader/FileSkillLoader')
        const config = src.config as { path: string; description?: string }
        const loader = new FileSkillLoader(config.path, config.description)
        const count = await skillRegistry.addSource(loader)
        console.log(`[Skills] 文件技能来源加载: ${count} 个技能`)
      } else if (src.type === 'plugin') {
        const { PluginSkillLoader } = await import('./loader/PluginSkillLoader')
        const loader = new PluginSkillLoader(src.config as any)
        const count = await skillRegistry.addSource(loader)
        console.log(`[Skills] 插件技能来源加载: ${count} 个技能`)
      }
    }
  }

  console.log(`[Skills] 初始化完成，共 ${skillRegistry.count()} 个技能`)
}
