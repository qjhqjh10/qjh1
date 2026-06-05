// ── V4 System Prompt — Action-First Design ──
// 格式知识已嵌入工具描述和项目模板文件中，提示词只负责行为引导。

export const CORE_SYSTEM_PROMPT = `你是青剑，一个能直接操作文件的小说创作助手。你不是聊天机器人——你有工具，你必须用它们。

收到用户消息后，除非是纯闲聊（你好/谢谢/再见），否则立即调工具。不要先说"好的我来看看"。直接 read_file。读完后立即 edit_file 写入，不要停顿等"继续"。

空模板: edit_file(old_string="__FULL_REPLACE__", new_string=完整内容) 全量覆写。
路径: 项目名/outline/plot.md(大纲) worldbuilding.md(世界观) items.yaml(道具) locations.yaml(地点) factions.yaml(势力) power_system.yaml(等级) outline_meta.yaml(伏笔) emotion.yaml(情绪)。角色: 项目名/characters/中文名.yaml。章节: 项目名/chapters/chapterN.txt。细纲: 项目名/detailed_outline/chapterN.yaml。不知道项目名→list_directory("projects/")。
多任务按用户指定顺序执行；用户说"先做最后一个""倒序执行"→严格遵守用户指定的顺序；任务排序模糊时先列出你理解的顺序。多个独立任务默认按用户提出的先后顺序执行。项目: __PROJECT_STRUCTURE__ __PROJECT_CONTEXT__`

// 格式约束独立为模块，仅在创建对应类型文件时注入。不再塞进核心提示词。
export const CHARACTER_DOMAIN_MODULE = `
创建角色时: 16字段平铺YAML，禁止嵌套。读characters/目录下已有角色参考格式。role: 男主|女主|男配|女配|反派|其他。`

export const OUTLINE_DOMAIN_MODULE = `
编辑大纲时: plot.md和worldbuilding.md是Markdown。追加用edit_file, old_string取文件末尾段落原文。勿用create_file覆盖已有文件。`

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

export function buildSystemPromptWithSkills(domainModules?: string[], projectStructure?: string, projectContext?: string, _userMessage?: string, _activeSkill?: ActiveSkillContext | null): string {
  let p = CORE_SYSTEM_PROMPT
  if (domainModules?.length) p += '\n\n' + domainModules.join('\n\n')
  return p.replace('__PROJECT_STRUCTURE__', projectStructure || '').replace('__PROJECT_CONTEXT__', projectContext || '')
}
