#!/usr/bin/env node
/**
 * AI 写作助手 — 综合测试工具函数
 *
 * 提供项目创建、文件验证、结果解析等共享功能。
 * 被 comprehensive-test-suite.mjs 引用。
 */

import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const APP_ROOT = path.resolve(__dirname, '..')
export const PROJECTS_DIR = path.join(APP_ROOT, 'projects')

// ══════════════════════════════════════════════════════════════
// 项目创建（与 GUI fileToolHandlers.ts:929-936 行为一致）
// ══════════════════════════════════════════════════════════════

const OUTLINE_TEMPLATES = {
  'plot.md':            '# 故事剧情\n\n> 一句话梗概\n\n## 第1章\n\n（待填写）',
  'worldbuilding.md':   '# 世界观设定\n\n> 类型·基调\n\n## 一、核心规则\n\n（待填写）',
  'items.yaml':         'items: []\n',
  'locations.yaml':     'locations: []\n',
  'factions.yaml':      'factions: []\n',
  'power_system.yaml':  'name: \'\'\nlevels: []\ndescription: \'\'\n',
  'outline_meta.yaml':  'foreshadowing: []\nplotThreads: []\n',
  'emotion.yaml':       'segments: []\n',
}

/**
 * 创建完整模板项目 — 8 个 outline tab 全部用模板填充（与 GUI 行为一致）
 */
export async function createFullTemplateProject(projectName) {
  const pp = path.join(PROJECTS_DIR, projectName)
  await fsp.mkdir(pp, { recursive: true })

  // 创建子目录
  for (const d of ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']) {
    await fsp.mkdir(path.join(pp, d), { recursive: true })
  }

  // 写入 8 个 outline tab（模板内容）
  for (const [file, content] of Object.entries(OUTLINE_TEMPLATES)) {
    await fsp.writeFile(path.join(pp, 'outline', file), content, 'utf-8')
  }

  // project.json
  await fsp.writeFile(path.join(pp, 'project.json'), JSON.stringify({
    type: 'writing', novelCategory: 'xianxia',
    name: projectName.replace(/_/g, ' ').trim(),
  }), 'utf-8')

  // 测试用 reference text
  const refText = [
    '# 画展\n',
    '林雨晴站在画展的入口处，深吸了一口气。',
    '展厅里已经聚集了不少人，她的画作挂在最显眼的位置——那是一幅描绘暴风雨中孤舟的作品，',
    '笔触凌厉而克制，仿佛每一笔都在诉说着某种无法言说的挣扎。',
    '"这幅画的构图很有意思，"一个低沉的声音从身后传来，',
    '"你用了大量的冷色调，但船帆上那一抹暖黄却格外醒目。是故意的吗？"',
    '林雨晴转身，看到了一个穿着深蓝色衬衫的男人，大约三十岁出头，目光锐利而专注。',
    '他的手指轻轻敲着下巴，那是一种习惯性的思考动作。',
    '"是的，"她说，"我想表达的是——即使在最黑暗的时刻，也总有一丝希望。不过很微弱，所以只是一小片暖色。"',
    '男人微笑了一下，那笑容很淡，稍纵即逝。',
    '"有意思。我注意到你的画笔触感很特别——你用的是哪种毛笔？"',
  ].join('\n')
  await fsp.writeFile(path.join(pp, 'summaries', 'ref.txt'), refText, 'utf-8')

  return pp
}

/**
 * 创建空模板项目 — 8 个 outline tab 全部为空字符串
 * 用于测试空文件边界条件（T2）
 */
export async function createEmptyTemplateProject(projectName) {
  const pp = path.join(PROJECTS_DIR, projectName)
  await fsp.mkdir(pp, { recursive: true })

  for (const d of ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']) {
    await fsp.mkdir(path.join(pp, d), { recursive: true })
  }

  // 全部空字符串
  for (const file of Object.keys(OUTLINE_TEMPLATES)) {
    await fsp.writeFile(path.join(pp, 'outline', file), '', 'utf-8')
  }

  await fsp.writeFile(path.join(pp, 'project.json'), JSON.stringify({
    type: 'writing', novelCategory: 'xianxia',
  }), 'utf-8')

  // 同样放一份 ref.txt
  const refText = ['# 画展\n', '林雨晴站在画展的入口处，深吸了一口气。',
    '展厅里已经聚集了不少人，她的画作挂在最显眼的位置——那是一幅描绘暴风雨中孤舟的作品。',
  ].join('\n')
  await fsp.writeFile(path.join(pp, 'summaries', 'ref.txt'), refText, 'utf-8')

  return pp
}

/**
 * 创建章节种子文件 — 解决 chapter-0 依赖链断裂问题
 */
export async function createChapterSeedFile(projectPath, chapterNum) {
  const seed = [
    `# 第${chapterNum}章·测试章节 — 摘要`,
    '## 剧情概述',
    `这是第${chapterNum}章的测试摘要，用于验证章节创作工作流。`,
    '## 关键事件',
    '- 事件A',
    '- 事件B',
    '## 出场角色',
    '- 主角',
  ].join('\n')
  await fsp.writeFile(path.join(projectPath, 'summaries', `chapter${chapterNum}.md`), seed, 'utf-8')
}

/**
 * 创建角色种子文件
 */
const CHARACTER_TEMPLATE = (name, role, gender, age, occupation) =>
`id: ${name.toLowerCase().replace(/\s/g, '_')}
name: ${name}
role: ${role}
gender: ${gender}
age: ${age}
occupation: ${occupation}
background: >-
  测试角色背景故事。
appearance: >-
  外貌描述。
personality: >-
  性格描述。
abilities: >-
  能力描述，纯文本字符串。
weaknesses: >-
  弱点描述。
relationships: >-
  关系描述。
relationshipTags:
  - 主角
arc: >-
  角色成长弧线。
importance: 80
image: ''
`

export async function createCharacterSeed(projectPath, name, role, gender = '男', age = '20', occupation = '修士') {
  const content = CHARACTER_TEMPLATE(name, role, gender, age, occupation)
  await fsp.writeFile(path.join(projectPath, 'characters', `${name}.yaml`), content, 'utf-8')
}

/**
 * 创建章节正文种子
 */
export async function createChapterSeed(projectPath, chapterNum) {
  const title = chapterNum === 1 ? '觉醒之日' : `第${chapterNum}章`
  const content = [
    `# 第${chapterNum}章·${title}`,
    '',
    '## 第一节',
    '清晨的阳光透过窗棂洒进房间，林逸缓缓睁开眼睛。',
    '',
    '今天是宗门大比的日子，所有弟子都聚集在演武场上。',
    '空气中弥漫着紧张的气氛，每个人脸上都写满了期待与不安。',
    '',
    '"林逸，你准备好了吗？"苏婉清的声音从身后传来，带着一丝担忧。',
    '',
    '林逸点了点头，没有说话。他的手紧紧握着腰间的剑柄，',
    '指节因用力而微微发白。这把剑是他师父留下的唯一遗物，',
    '每一道剑痕都承载着一段无法磨灭的记忆。',
    '',
    '## 第二节',
    '演武场上，鼓声如雷。',
    '',
    '林逸站在擂台中央，对面的对手是宗门的首席弟子——陈啸天。',
    '两人的目光在空中碰撞，仿佛能擦出火花。',
    '',
    '"开始！"长老的声音刚落，陈啸天就已经化作一道残影冲了过来。',
    '林逸侧身避开，同时拔剑出鞘。剑光如雪，在阳光下闪烁着寒芒。',
  ].join('\n')
  await fsp.writeFile(path.join(projectPath, 'chapters', `chapter${chapterNum}.txt`), content, 'utf-8')
}

// ══════════════════════════════════════════════════════════════
// 文件验证
// ══════════════════════════════════════════════════════════════

/**
 * 验证 YAML/JSON 文件是否可解析
 */
export async function validateYaml(filePath, requiredKeys = []) {
  try {
    const content = await fsp.readFile(filePath, 'utf-8')
    if (!content.trim()) return { valid: false, reason: '文件为空' }

    // Try JSON parse
    try {
      const json = JSON.parse(content)
      const missing = requiredKeys.filter(k => !(k in json))
      if (missing.length > 0) return { valid: false, reason: `缺少字段: ${missing.join(', ')}` }
      return { valid: true }
    } catch {
      // Not JSON, check for YAML structure
      const missing = requiredKeys.filter(k => !content.includes(k + ':'))
      if (missing.length > 0) return { valid: false, reason: `缺少字段: ${missing.join(', ')}` }
      return { valid: true }
    }
  } catch {
    return { valid: false, reason: '文件不存在或不可读' }
  }
}

/**
 * 验证角色 YAML 的 16 字段完整性
 */
export async function validateCharacterFields(filePath) {
  const requiredFields = [
    'id', 'name', 'role', 'gender', 'age', 'occupation',
    'background', 'appearance', 'personality', 'abilities', 'weaknesses',
    'relationships', 'relationshipTags', 'arc', 'importance',
  ]
  const content = await fsp.readFile(filePath, 'utf-8')
  const missing = requiredFields.filter(f => {
    const re = new RegExp(`^${f}\\s*:`, 'm')
    return !re.test(content)
  })

  // Extra checks
  const issues = []
  if (!/\brole\b.*:\s*(男主|女主|男配|女配|反派|其他)/.test(content)) issues.push('role 枚举值异常')
  if (!/relationshipTags\b.*:\s*\[/.test(content)) issues.push('relationshipTags 不是数组')
  if (!/\bimportance\b.*:\s*\d+/.test(content)) issues.push('importance 不是数字')
  if (/\babilities\b.*:\s*[\{\[]/.test(content)) issues.push('abilities 是对象/数组而非纯文本')

  return {
    valid: missing.length === 0 && issues.length === 0,
    missing,
    issues,
    fieldCount: requiredFields.length - missing.length,
  }
}

/**
 * 检查文件是否包含指定关键词
 */
export async function fileContains(filePath, substring) {
  try {
    const content = await fsp.readFile(filePath, 'utf-8')
    return content.includes(substring)
  } catch {
    return false
  }
}

/**
 * 获取文件大小
 */
export async function fileSize(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    return stat.size
  } catch {
    return -1
  }
}

// ══════════════════════════════════════════════════════════════
// 输出解析
// ══════════════════════════════════════════════════════════════

/**
 * 从 run-agent.ts 输出中提取指标
 */
export function extractMetrics(output) {
  // 格式: "── 7 轮 · 6 工具 · 10.2K tokens · 65.4s"
  const match = output.match(/──\s*(\d+)\s*轮\s*·\s*(\d+)\s*工具\s*·\s*([\d.]+)K\s*tokens\s*·\s*([\d.]+)s/)
  if (!match) return { rounds: 0, toolCalls: 0, tokensK: 0, durationS: 0 }
  return {
    rounds: parseInt(match[1]),
    toolCalls: parseInt(match[2]),
    tokensK: parseFloat(match[3]),
    durationS: parseFloat(match[4]),
  }
}

/**
 * 从输出中提取 Skill 匹配信息
 */
export function extractSkillMatch(output) {
  // Skill:    SkillRegistry (10 技能)
  const countMatch = output.match(/SkillRegistry\s*\((\d+)\s*技能\)/)
  return countMatch ? parseInt(countMatch[1]) : 0
}

/**
 * 检查输出中是否包含工具调用错误
 */
export function hasToolErrors(output) {
  return (output.match(/❌/g) || []).length
}

// ══════════════════════════════════════════════════════════════
// 清理
// ══════════════════════════════════════════════════════════════

/**
 * 清理测试项目
 */
export async function cleanupProject(projectName) {
  const pp = path.join(PROJECTS_DIR, projectName)
  await fsp.rm(pp, { recursive: true, force: true })
}

/**
 * 清理全局测试资源
 */
export async function cleanupGlobalResources() {
  const patterns = ['测试', '画展', '修仙境界', '上古剑魂', '写作灵感']

  // 清理 style_templates
  try {
    const styleDir = path.join(APP_ROOT, 'style_templates')
    const files = await fsp.readdir(styleDir)
    for (const f of files) {
      if (patterns.some(p => f.includes(p))) {
        await fsp.unlink(path.join(styleDir, f))
      }
    }
  } catch {}

  // 清理 KB
  try {
    const kbDir = path.join(APP_ROOT, 'knowledge_base', 'files')
    const files = await fsp.readdir(kbDir)
    for (const f of files) {
      if (patterns.some(p => f.includes(p))) {
        await fsp.unlink(path.join(kbDir, f))
      }
    }
  } catch {}
}

/**
 * 生成唯一的测试项目名
 */
export function testProjectName(suffix = '') {
  const ts = Date.now().toString(36)
  return `_ct_${ts}${suffix}`
}
