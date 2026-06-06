// ── V4 System Prompt — Action-First Design ──
// 格式知识已嵌入工具描述和项目模板文件中，提示词只负责行为引导。

export const CORE_SYSTEM_PROMPT = `你是青剑，一个小说创作AI Agent。你的工作是用工具操作项目文件。

## ⚠️ 铁律（最高优先级，违反即失败）

1. **读完必须写**：read_file 之后如果内容需要修改/填充，必须在同一轮或下一轮调用 edit_file 或 create_file 写入。读完文件只输出文本分析而不写入 = 任务失败。
2. **调用工具才算完成**：文字中说"已完成""已创建"没有意义。只有工具返回 status: "success" 才算真正完成。
3. **只做用户要求的事**：不要额外创建用户没要求的文件或内容。

## 工作方式（v10: 分阶段执行）

### 🔍 阶段1: ANALYZE — 意图分析（必须先完成，不能跳过）
1. 收到用户消息后，先用一到两句话分析：用户想完成什么？涉及哪些文件？需要哪个技能？
2. 意图模糊时追问澄清，不要猜测
3. 意图清晰时输出你的理解，系统会自动进入执行阶段
4. **这个阶段不允许调用工具**。只需输出文本分析。

### ⚡ 阶段2: EXECUTE — 任务执行（ANALYZE完成后自动进入）
**简单任务**（读文件、搜索、列表）→ 直接调用对应工具
**复杂任务**（创建角色/章节/模板/大纲编辑）→ 必须先 invoke_skill 再调工具
- read_file → edit_file/create_file → 确认。三步一体，每步确认status:"success"
- 空文件用 old_string="__FULL_REPLACE__" 全量覆写
- 多文件任务：完成一个文件→确认success→下一个。逐个处理，全部完成后再做最终汇报
- 严格按 Skill 工作流步骤执行，持续不断直至所有文件操作完毕

### ✅ 阶段3: VERIFY — 事后验证（任务完成后自动触发）
- 运行 Skill 指定的验证脚本（shell_run_script）
- 验证失败→修正→重新验证
- 验证通过→汇报结果

## 🚫 禁止行为

- 读完文件后只输出文本描述而不调用写工具
- 一次性 read_file 所有文件然后不做写入
- 说"已完成"但没调用工具
- 把不同任务的操作混在一起处理
- **只完成部分任务就声称"已完成"**（所有文件都必须操作完毕才能停止）

## 路径速查

项目名/outline/plot.md worldbuilding.md items.yaml locations.yaml factions.yaml power_system.yaml outline_meta.yaml emotion.yaml
角色: 项目名/characters/中文名.yaml  章节: 项目名/chapters/chapterN.txt  细纲: 项目名/detailed_outline/chapterN.yaml
不知道项目名→list_directory("projects/")

## 任务排序

- 用户指定了多个任务 → 严格遵守用户指定的顺序，不得调换或跳过
- 批量操作（多个文件/多个角色/多个Tab）→ 逐个完成，完成一个汇报一次进度
- 如果用户列举了编号列表（1. 2. 3.），必须先完成1再完成2再完成3
- 全部完成后一次性列出所有结果

项目: __PROJECT_STRUCTURE__ __PROJECT_CONTEXT__`

// 格式约束独立为模块，仅在创建对应类型文件时注入。不再塞进核心提示词。
export const CHARACTER_DOMAIN_MODULE = `
创建角色时: 16字段平铺YAML，禁止嵌套。读characters/目录下已有角色参考格式。role: 男主|女主|男配|女配|反派|其他。`

export const OUTLINE_DOMAIN_MODULE = `
编辑大纲: plot.md/worldbuilding.md 用 Markdown。yaml tab（items/locations/factions/power_system/outline_meta/emotion）用 JSON 格式如 {"key":[...]}。追加用 edit_file，禁止 create_file 覆盖已有文件。`

export const CHAPTER_DOMAIN_MODULE = `
写章节时: 先读大纲→读角色卡→读细纲→读前章摘要。章节是.txt，自然段空行分隔。`

export const STYLE_DOMAIN_MODULE = `
风格模板: 用create_style_template工具。必填name/type/dimensions。11个必填维度必须分析。维度用英文key。`

export const SCENE_DOMAIN_MODULE = `
场景模板: 用create_scene_template工具。必填name/type。不确定的字段放autoFields数组。`

export const KB_DOMAIN_MODULE = `
知识库: 先kb_list查看已有文件→再kb_create_file或kb_append_file。`

// AI能力/软件功能自述模块
export const AI_CAPABILITIES_MODULE = `我是青剑内置的AI写作助手。能直接操作项目文件完成：文件操作/角色管理/大纲创作/细纲创作/章节生成/小说仿写/续写/改写/风格场景模板/知识库管理/图片搜索。`
export const SOFTWARE_FEATURES_MODULE = `青剑是AI辅助小说创作桌面软件。功能：项目管理/AI写作助手(39工具)/大纲(10Tab)/角色(16字段+G6关系图)/章节写作(TipTap+版本管理)/仿写(26维度)/续写(7步)/风格场景工坊/故事脉络(14Tab)/知识库/改写/EPUB导出/设置(10+AI服务商+7主题)。`

// ── Helpers ──

import type { ActiveSkillContext } from './skills/types'
// v10.0.0: Skill 注入已由 Skill Catalog + invoke_skill 取代

export function selectDomainModules(userMessage: string): string[] {
  const m: string[] = []
  if (/角色|人物|男主|女主|配角|反派/.test(userMessage)) m.push(CHARACTER_DOMAIN_MODULE)
  if (/大纲|剧情|情节|故事线|outline|plot|worldbuilding|世界观|设定/.test(userMessage)) m.push(OUTLINE_DOMAIN_MODULE)
  if (/写|创作|生成|续写|章节|第.{1,3}章|chapter/.test(userMessage)) m.push(CHAPTER_DOMAIN_MODULE)
  if (/风格|文风|分析.*文|仿写|style/.test(userMessage)) m.push(STYLE_DOMAIN_MODULE)
  if (/场景.*模板|创建.*场景|scene/.test(userMessage)) m.push(SCENE_DOMAIN_MODULE)
  if (/知识库|kb|素材.*保存/.test(userMessage)) m.push(KB_DOMAIN_MODULE)
  if (/你能做什么|功能|介绍/.test(userMessage)) { m.push(AI_CAPABILITIES_MODULE); m.push(SOFTWARE_FEATURES_MODULE) }
  if (/你会什么|能力/.test(userMessage) && !/软件/.test(userMessage)) { m.push(AI_CAPABILITIES_MODULE) }
  return m
}

export function buildSystemPrompt(domainModules?: string[], projectStructure?: string, projectContext?: string): string {
  let p = CORE_SYSTEM_PROMPT
  if (domainModules?.length) p += '\n\n' + domainModules.join('\n\n')
  return p.replace('__PROJECT_STRUCTURE__', projectStructure || '').replace('__PROJECT_CONTEXT__', projectContext || '')
}

/**
 * v9.6.1: 构建 Skill 目录（仅元数据，~800 tokens，常驻系统提示词）。
 * 模型读取目录后，通过 invoke_skill 工具主动调用所需的 Skill。
 * 替代旧的被动注入方式。
 */
import { skillRegistry } from './skills/SkillRegistry'
import { initSkills } from './skills'

let _skillsInited = false
function ensureSkillsInit() {
  if (!_skillsInited) { try { initSkills(); _skillsInited = true } catch {} }
}

export function getSkillCatalog(): string {
  ensureSkillsInit()
  const skills = skillRegistry.getEnabled()
  if (skills.length === 0) return ''

  const byCategory = new Map<string, string[]>()
  for (const s of skills) {
    const cat = s.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    // 提取前 3 个最有辨识度的触发词
    const triggers = s.triggerPatterns
      .filter(p => p.length <= 12 && !/^[\\^$.*+?()[\]{}|]/.test(p)) // 纯文本短触发词
      .slice(0, 3)
      .join('、')
    const hint = triggers ? ` | 触发: ${triggers}` : ''
    byCategory.get(cat)!.push(`- **${s.id}** — ${s.description}${hint}`)
  }

  const catLabels: Record<string, string> = {
    outline: '大纲', character: '角色', chapter: '章节',
    style: '风格', scene: '场景', knowledge: '知识库',
    review: '审稿', continuation: '续写', imitation: '仿写',
    general: '通用',
  }

  const lines: string[] = [
    '',
    '## 🔧 技能目录（Skill Catalog）',
    '',
    '以下技能封装了完成特定任务的**完整工作流**。当你面对以下任务时，',
    '**必须先调用 `invoke_skill` 工具**获取该技能的详细步骤指引，然后严格按步骤执行。',
    '不要跳过 invoke_skill 直接开始操作——技能工作流中包含了关键的格式规范和操作顺序。',
    '',
  ]

  for (const [cat, entries] of byCategory) {
    lines.push(`### ${catLabels[cat] || cat}`)
    for (const e of entries) lines.push(`- ${e}`)
    lines.push('')
  }

  return lines.join('\n')
}

export function buildSystemPromptWithSkills(domainModules?: string[], projectStructure?: string, projectContext?: string, userMessage?: string, _activeSkill?: ActiveSkillContext | null): string {
  let p = CORE_SYSTEM_PROMPT

  // v9.6.1: Skill 目录（元数据，~800 tokens，常驻）
  // 替代旧的全量工作流注入。模型通过 invoke_skill 主动获取详细步骤。
  p += getSkillCatalog()

  if (domainModules?.length) p += '\n\n' + domainModules.join('\n\n')

  return p.replace('__PROJECT_STRUCTURE__', projectStructure || '').replace('__PROJECT_CONTEXT__', projectContext || '')
}

/**
 * v9.6.1: 不再使用（保留接口兼容）。Skill 工作流改为由 invoke_skill 工具按需返回。
 */
export function getSkillSystemMessage(_userMessage: string): { role: 'system'; content: string } | null {
  return null
}
