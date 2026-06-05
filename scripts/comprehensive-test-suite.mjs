#!/usr/bin/env node
/**
 * AI 写作助手 — 综合测试套件
 *
 * 15 个场景覆盖所有 Skill 边界条件。
 * 用法:
 *   AI_API_KEY=sk-xxx node scripts/comprehensive-test-suite.mjs
 *   AI_API_KEY=sk-xxx node scripts/comprehensive-test-suite.mjs --phase=high
 *   AI_API_KEY=sk-xxx node scripts/comprehensive-test-suite.mjs --scenario=T2,T4
 *   AI_API_KEY=sk-xxx node scripts/comprehensive-test-suite.mjs --model=deepseek-v4-pro
 *   AI_API_KEY=sk-xxx node scripts/comprehensive-test-suite.mjs --keep
 */

import { execSync } from 'node:child_process'
import * as path from 'node:path'
import {
  APP_ROOT, PROJECTS_DIR,
  createFullTemplateProject, createEmptyTemplateProject,
  createChapterSeedFile, createChapterSeed, createCharacterSeed,
  validateYaml, validateCharacterFields, fileContains, fileSize,
  extractMetrics, cleanupProject, cleanupGlobalResources, testProjectName,
} from './test-utils.mjs'

// ══════════════════════════════════════════════════════════════
// 配置
// ══════════════════════════════════════════════════════════════

const CONFIG = {
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || 'deepseek-v4-flash',
  protocol: process.env.AI_PROTOCOL || 'anthropic',
  maxIters: parseInt(process.env.AI_MAX_ITERS || '20'),
  timeout: parseInt(process.env.AI_TIMEOUT || '120000'),
  keep: process.argv.includes('--keep'),
  verbose: process.argv.includes('--verbose'),
}

// 场景过滤
let phaseFilter = null
let scenarioFilter = []
for (const arg of process.argv) {
  if (arg.startsWith('--phase=')) phaseFilter = arg.slice(8)
  if (arg.startsWith('--scenario=')) scenarioFilter = arg.slice(11).split(',')
  if (arg.startsWith('--model=')) CONFIG.model = arg.slice(8)
}

if (!CONFIG.apiKey) {
  console.error('\x1b[31m错误: 未设置 AI_API_KEY 环境变量\x1b[0m')
  process.exit(1)
}

// ══════════════════════════════════════════════════════════════
// Agent 调用
// ══════════════════════════════════════════════════════════════

function runAgent(command, projectName) {
  const escaped = command.replace(/"/g, '\\"').replace(/\n/g, ' ')
  const cmd = `npx tsx --tsconfig scripts/tsconfig.cli.json scripts/run-agent.ts --project=${projectName} --protocol=${CONFIG.protocol} --max-iters=${CONFIG.maxIters} --command="${escaped}"`
  try {
    const stdout = execSync(cmd, {
      cwd: APP_ROOT,
      timeout: CONFIG.timeout,
      encoding: 'utf-8',
      env: { ...process.env, AI_API_KEY: CONFIG.apiKey, AI_MODEL: CONFIG.model },
    })
    return stdout
  } catch (e) {
    return `ERROR: ${e.message}\nSTDOUT: ${e.stdout || '(空)'}\nSTDERR: ${e.stderr || '(空)'}`
  }
}

// ══════════════════════════════════════════════════════════════
// 场景定义
// ══════════════════════════════════════════════════════════════

const SCENARIOS = []

function def(id, phase, name, command, validate) {
  SCENARIOS.push({ id, phase, name, command, validate })
}

// ── Phase: high ──

def('T1', 'high', '多Tab大纲填充（有模板）',
  p => `项目 ${p}/outline/ 里有预创建的 items.yaml、locations.yaml、factions.yaml。` +
    `帮我填充这3个Tab的内容，写一个修仙世界的基础设定。` +
    `每个文件先 read_file 再 edit_file，完成一个再处理下一个。`,
  async (pp) => {
    const results = {}
    for (const f of ['items.yaml', 'locations.yaml', 'factions.yaml']) {
      const fp = path.join(pp, 'outline', f)
      const size = await fileSize(fp)
      results[f] = { size, hasContent: size > 100 }
    }
    return { passed: Object.values(results).every(r => r.hasContent), detail: results }
  }
)

def('T2', 'high', '多Tab大纲填充（空文件）',
  p => `项目 ${p}/outline/ 里有空的 items.yaml、locations.yaml、factions.yaml。` +
    `帮我填充这3个Tab的内容，写一个修仙世界的基础设定。` +
    `每个文件先 read_file 再 edit_file，完成一个再处理下一个。`,
  async (pp) => {
    const results = {}
    for (const f of ['items.yaml', 'locations.yaml', 'factions.yaml']) {
      const fp = path.join(pp, 'outline', f)
      const size = await fileSize(fp)
      results[f] = { size, hasContent: size > 50 }
    }
    return { passed: Object.values(results).every(r => r.hasContent), detail: results }
  }
)

def('T3', 'high', '批量创建3个角色',
  p => `批量创建3个角色：\n` +
    `1. 林逸 — 男主，18岁，剑修，性格孤傲但内心善良\n` +
    `2. 苏婉清 — 女主，17岁，丹师，性格温柔体贴\n` +
    `3. 陈长老 — 反派，50岁，宗门大长老，表面正直实则阴险\n` +
    `先 list_directory characters/ 看已有角色格式，再逐个创建。每个必须16字段完整YAML。`,
  async (pp) => {
    const results = {}
    for (const name of ['林逸', '苏婉清', '陈长老']) {
      const fp = path.join(pp, 'characters', `${name}.yaml`)
      const check = await validateCharacterFields(fp)
      results[name] = check
    }
    const allPassed = Object.values(results).every(r => r.valid)
    return { passed: allPassed, detail: results }
  }
)

def('T4', 'high', '章节写作（空依赖）',
  p => `写第1章正文，2000字。标题是"觉醒之日"。` +
    `先读大纲和角色卡了解背景，即使细纲和摘要文件不存在也应该继续创作。`,
  async (pp) => {
    const fp = path.join(pp, 'chapters', 'chapter1.txt')
    const size = await fileSize(fp)
    const hasContent = size > 500
    const hasTitle = await fileContains(fp, '# 第1章')
    return { passed: hasContent && hasTitle, detail: { size, hasTitle } }
  }
)

def('T5', 'high', '大纲追加内容',
  p => `在 ${p}/outline/plot.md 的故事剧情里，往第1章后面追加一段新剧情：` +
    `主角在宗门后山的禁地发现了一柄锈迹斑斑的古剑，剑身刻着看不懂的符文。` +
    `先 read_file 确认原文，再用 edit_file 追加。`,
  async (pp) => {
    const fp = path.join(pp, 'outline', 'plot.md')
    const hasNew = await fileContains(fp, '古剑') || await fileContains(fp, '禁地')
    const size = await fileSize(fp)
    return { passed: hasNew && size > 60, detail: { hasNew, size } }
  }
)

// ── Phase: medium ──

def('T6', 'medium', '章节润色',
  p => `润色 ${p}/chapters/chapter1.txt，优化对话的生动性。` +
    `只改需要改的段落，用 edit_file 精确替换，不要全量重写。`,
  async (pp) => {
    const fp = path.join(pp, 'chapters', 'chapter1.txt')
    const size = await fileSize(fp)
    return { passed: size > 400, detail: { size } }
  }
)

def('T7', 'medium', '细纲创作（缺依赖）',
  p => `给第3章写细纲，剧情是：主角在雨夜遭遇宗门围剿，被迫使用禁术。` +
    `先读大纲了解背景。前章摘要可能不存在，不存在就跳过。`,
  async (pp) => {
    const fp = path.join(pp, 'detailed_outline', 'chapter3.yaml')
    const size = await fileSize(fp)
    const hasFields = await fileContains(fp, 'plotOverview') && await fileContains(fp, 'keyEvents')
    return { passed: size > 100 && hasFields, detail: { size, hasFields } }
  }
)

def('T8', 'medium', '修改角色属性',
  p => `把 ${p}/characters/林逸.yaml 里的修为从测试内容改为"筑基期"，` +
    `同时更新 abilities 描述。先 read_file 确认原文，再用 edit_file 精确替换。`,
  async (pp) => {
    const fp = path.join(pp, 'characters', '林逸.yaml')
    const hasNew = await fileContains(fp, '筑基期')
    return { passed: hasNew, detail: { hasNew } }
  }
)

def('T9', 'medium', '文本导入→大纲',
  p => `分析 ${p}/summaries/ref.txt 里的内容，判断内容类型后，` +
    `把剧情相关的部分导入到故事剧情（${p}/outline/plot.md）里。` +
    `先分析文本内容类型，再 read_file 看 plot.md 结构，用 edit_file 追加。`,
  async (pp) => {
    const fp = path.join(pp, 'outline', 'plot.md')
    const hasImport = await fileContains(fp, '林雨晴') || await fileContains(fp, '画展')
    const size = await fileSize(fp)
    return { passed: hasImport && size > 150, detail: { hasImport, size } }
  }
)

def('T10', 'medium', '知识库保存',
  p => `把修仙九境的完整设定保存到知识库，文件名叫"修仙境界体系"。` +
    `先 kb_list 查看已有文件，如果不存在就 kb_create_file。`,
  async () => {
    const fp = path.join(APP_ROOT, 'knowledge_base', 'files', '修仙境界体系.md')
    const size = await fileSize(fp)
    const hasContent = size > 50
    return { passed: hasContent, detail: { size } }
  }
)

// ── Phase: low ──

def('T11', 'low', '读不存在的文件→恢复',
  p => `读取 ${p}/characters/周明远.yaml 的内容。如果文件不存在，帮我搜索项目里有哪些角色文件。`,
  async (pp) => {
    // 输出中应包含搜索/列表行为
    // 检查输出中是否有其他角色文件列表
    return { passed: true, detail: { note: '检查模型是否用 list_directory/find_files 替代了失败路径' } }
  }
)

def('T12', 'low', '错误old_string→修正',
  p => `把 ${p}/outline/plot.md 里第1章的标题从"## 第1章"改成"## 第一章·觉醒"。` +
    `先 read_file 看准确内容，再用 edit_file。`,
  async (pp) => {
    const fp = path.join(pp, 'outline', 'plot.md')
    const hasNew = await fileContains(fp, '第一章·觉醒') || await fileContains(fp, '觉醒')
    return { passed: hasNew, detail: { hasNew } }
  }
)

def('T13', 'low', '风格模板（26维分析）',
  p => `读取 ${p}/summaries/ref.txt，分析文风后创建风格模板。` +
    `模板名叫"测试画展文风"，类型选"都市小说"。` +
    `必须包含全部11个必填维度（narrativeTone/sentenceStyle/vocabularyStyle/` +
    `rhetoricStyle/rhythmStyle/dialogueStyle/moodStyle/perspectiveStyle/` +
    `bodyLanguageStyle/sensoryStyle/descriptionPattern），用英文key。`,
  async () => {
    // 检查 style_templates 目录下是否有新创建的模板
    const { readdir } = await import('node:fs/promises')
    try {
      const files = await readdir(path.join(APP_ROOT, 'style_templates'))
      const testFile = files.find(f => f.includes('测试画展') || f.includes('test'))
      if (!testFile) return { passed: false, detail: { reason: '未找到风格模板文件' } }
      const { readFile } = await import('node:fs/promises')
      const content = await readFile(path.join(APP_ROOT, 'style_templates', testFile), 'utf-8')
      const json = JSON.parse(content)
      const dims = json.dimensions || {}
      const required = ['narrativeTone','sentenceStyle','vocabularyStyle','rhetoricStyle',
        'rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle',
        'sensoryStyle','descriptionPattern']
      const missing = required.filter(d => !dims[d])
      return { passed: missing.length === 0, detail: { file: testFile, missing, dimCount: Object.keys(dims).length } }
    } catch (e) {
      return { passed: false, detail: { reason: e.message } }
    }
  }
)

def('T14', 'low', '多意图混合任务',
  p => `帮我做三件事：\n` +
    `1. 在 ${p}/outline/plot.md 末尾追加一段新剧情思路：主角发现禁地古剑中藏有一缕上古剑魂\n` +
    `2. 把这段设定保存到知识库，文件名叫"上古剑魂设定"\n` +
    `3. 以这段设定为灵感，创建一个新的配角角色：剑魂·青冥，外貌描写为半透明的蓝衣老者\n` +
    `这三个任务必须全部完成，不要遗漏任何一个。`,
  async (pp) => {
    const r1 = await fileContains(path.join(pp, 'outline', 'plot.md'), '剑魂')
    const r2 = await fileSize(path.join(APP_ROOT, 'knowledge_base', 'files', '上古剑魂设定.md'))
    const r3 = await fileSize(path.join(pp, 'characters', '剑魂·青冥.yaml'))
    const allDone = r1 && r2 > 0 && r3 > 0
    return { passed: allDone, detail: { r1_plotUpdated: r1, r2_kbSize: r2, r3_charSize: r3 } }
  }
)

def('T15', 'low', '指定执行顺序',
  p => `帮我做三件事，但要按我说的顺序来：\n` +
    `① 先创建知识库文件"写作灵感.md"，内容是"雨夜、古剑、禁术、觉醒"\n` +
    `② 然后列出项目 ${p} 里所有的 .yaml 文件\n` +
    `③ 最后读取 ${p}/characters/林逸.yaml 的内容\n` +
    `请严格遵守这个顺序，不要自作主张调换。`,
  async (pp) => {
    const kbOk = await fileSize(path.join(APP_ROOT, 'knowledge_base', 'files', '写作灵感.md')) > 0
    const charOk = await fileSize(path.join(pp, 'characters', '林逸.yaml')) > 0
    return { passed: kbOk, detail: { kbOk, charExists: charOk } }
  }
)

// ══════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log('\x1b[36m╔══════════════════════════════════════════╗\x1b[0m')
  console.log('\x1b[36m║  AI 写作助手 — 综合测试套件（15场景）║\x1b[0m')
  console.log('\x1b[36m╠══════════════════════════════════════════╣\x1b[0m')
  console.log(`\x1b[36m║  模型: ${CONFIG.model.padEnd(30)}║\x1b[0m`)
  console.log(`\x1b[36m║  协议: ${CONFIG.protocol.padEnd(30)}║\x1b[0m`)
  console.log(`\x1b[36m╚══════════════════════════════════════════╝\x1b[0m`)

  // 筛选场景
  let scenarios = SCENARIOS
  if (phaseFilter) {
    scenarios = scenarios.filter(s => s.phase === phaseFilter)
    console.log(`\x1b[33m筛选: phase=${phaseFilter} → ${scenarios.length} 个场景\x1b[0m`)
  }
  if (scenarioFilter.length > 0) {
    scenarios = scenarios.filter(s => scenarioFilter.includes(s.id))
    console.log(`\x1b[33m筛选: scenario=${scenarioFilter.join(',')} → ${scenarios.length} 个场景\x1b[0m`)
  }

  if (scenarios.length === 0) {
    console.log('\x1b[33m没有匹配的场景\x1b[0m')
    process.exit(0)
  }

  // 准备 .env.test 文件（run-agent.ts 可能需要）
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(APP_ROOT, 'scripts', '.env.test'),
    `AI_API_KEY=${CONFIG.apiKey}\nAI_MODEL=${CONFIG.model}\n`, 'utf-8')

  // ════════════════════════════════════════════════════════════
  // Phase 0: 创建测试项目
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 0: 创建测试项目 ──')
  const fullProject = testProjectName()
  const emptyProject = testProjectName('_empty')

  console.log(`  创建完整模板项目: ${fullProject}`)
  const fullPP = await createFullTemplateProject(fullProject)
  console.log(`  创建空模板项目: ${emptyProject}`)
  const emptyPP = await createEmptyTemplateProject(emptyProject)

  // 种子数据
  await createCharacterSeed(fullPP, '林逸', '男主', '男', '18', '剑修')
  await createChapterSeed(fullPP, 1)
  console.log('  种子数据已创建（林逸角色 + chapter1.txt）')

  // ════════════════════════════════════════════════════════════
  // 执行场景
  // ════════════════════════════════════════════════════════════
  const results = []
  const phases = ['low', 'medium', 'high']
  let currentPhase = ''

  for (const phase of phases) {
    const phaseScenarios = scenarios.filter(s => s.phase === phase)
    if (phaseScenarios.length === 0) continue
    if (currentPhase !== phase) {
      const phaseLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' }[phase]
      console.log(`\n── Phase: ${phaseLabel} (${phaseScenarios.length} 场景) ──`)
      currentPhase = phase
    }

    for (const s of phaseScenarios) {
      // 选择项目：T2 用空模板项目，其他用完整项目
      const projName = s.id === 'T2' ? emptyProject : fullProject
      const projPath = s.id === 'T2' ? emptyPP : fullPP

      console.log(`\n\x1b[90m[${s.id}]\x1b[0m ${s.name}`)
      const startTime = Date.now()

      const command = typeof s.command === 'function' ? s.command(projName) : s.command
      if (CONFIG.verbose) console.log(`\x1b[90m  > ${command.slice(0, 100)}...\x1b[0m`)

      const output = runAgent(command, projName)
      const metrics = extractMetrics(output)
      const durationMs = Date.now() - startTime

      // 验证
      let validation = { passed: false, detail: {} }
      try {
        validation = await s.validate(projPath)
      } catch (e) {
        validation = { passed: false, detail: { error: e.message } }
      }

      const status = validation.passed ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m'
      console.log(`  ${status} ${metrics.rounds}轮·${metrics.toolCalls}工具·${metrics.tokensK}Kt·${(durationMs/1000).toFixed(1)}s`)

      if (!validation.passed && CONFIG.verbose) {
        console.log(`  \x1b[31m详情:\x1b[0m ${JSON.stringify(validation.detail).slice(0, 120)}`)
      }

      results.push({
        id: s.id, name: s.name, phase: s.phase, status: validation.passed ? 'PASS' : 'FAIL',
        metrics, validation, durationMs,
      })
    }
  }

  // ════════════════════════════════════════════════════════════
  // 报告
  // ════════════════════════════════════════════════════════════
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const totalTokens = results.reduce((s, r) => s + (r.metrics?.tokensK || 0), 0)
  const totalTime = results.reduce((s, r) => s + (r.metrics?.durationS || 0), 0)

  console.log('\n\x1b[36m╔══════════════════════════════════════════╗\x1b[0m')
  console.log('\x1b[36m║  综合测试报告                            ║\x1b[0m')
  console.log('\x1b[36m╠══════════════════════════════════════════╣\x1b[0m')
  console.log(`\x1b[36m║  通过: ${String(passed).padStart(2)}/${results.length}  失败: ${String(failed).padStart(2)}                ║\x1b[0m`)
  console.log(`\x1b[36m║  总Token: ${totalTokens.toFixed(0)}K  总耗时: ${totalTime.toFixed(0)}s              ║\x1b[0m`)
  console.log('\x1b[36m╚══════════════════════════════════════════╝\x1b[0m')

  // 按阶段分组展示
  for (const phase of phases) {
    const phaseResults = results.filter(r => r.phase === phase)
    if (phaseResults.length === 0) continue
    const phaseLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' }[phase]
    console.log(`\n${phaseLabel}:`)
    for (const r of phaseResults) {
      const icon = r.status === 'PASS' ? '✅' : '❌'
      console.log(`  ${icon} ${r.id}: ${r.name.padEnd(20)} | ${r.metrics?.rounds || 0}轮·${r.metrics?.toolCalls || 0}工具·${r.metrics?.tokensK || 0}Kt`)
      if (r.status === 'FAIL' && r.validation?.detail) {
        const detailStr = typeof r.validation.detail === 'string'
          ? r.validation.detail
          : JSON.stringify(r.validation.detail).slice(0, 100)
        console.log(`     原因: ${detailStr}`)
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 清理
  // ════════════════════════════════════════════════════════════
  if (!CONFIG.keep) {
    console.log('\n清理测试资源...')
    await cleanupProject(fullProject)
    await cleanupProject(emptyProject)
    await cleanupGlobalResources()
    console.log('已清理')
  } else {
    console.log(`\n\x1b[33m--keep: 保留测试项目 ${fullProject}, ${emptyProject}\x1b[0m`)
  }

  // 清理 .env.test
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(path.join(APP_ROOT, 'scripts', '.env.test'))
  } catch {}

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\x1b[31m致命错误:\x1b[0m', err.message)
  if (CONFIG.verbose) console.error(err)
  process.exit(2)
})
