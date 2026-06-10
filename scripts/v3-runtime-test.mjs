#!/usr/bin/env node
/**
 * v3 真实 Runtime 测试 — 使用 V4UnifiedRuntime（GUI 同一套代码）
 * 验证: 行为决策树 4 分支 + Nudge + 工具执行 + 文件写入
 */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJECTS = path.join(ROOT, 'projects')
const TEST_PROJ = '_v3_test'
const TEST_DIR = path.join(PROJECTS, TEST_PROJ)
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const MODEL = 'deepseek-v4-flash'

function setup() {
  // Create clean test project
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'outline'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'characters'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'chapters'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'detailed_outline'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'summaries'), { recursive: true })
  fs.writeFileSync(path.join(TEST_DIR, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'general' }))

  // Pre-create empty plot.md (the model might try to edit it)
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), '# 故事剧情\n\n> 梗概\n\n', 'utf-8')
  console.log(`✅ 测试项目已创建: ${TEST_DIR}`)
}

function runAgent(command) {
  const start = Date.now()
  const tsxCmd = path.join(ROOT, 'node_modules', '.bin', 'tsx.cmd')
  // Escape double quotes in command for Windows cmd
  const safeCmd = command.replace(/"/g, '\\"')
  const fullCmd = `"${tsxCmd}" scripts/run-agent.ts --api-key=${API_KEY} --model=${MODEL} --project=${TEST_PROJ} --command="${safeCmd}" --protocol=openai`

  let out = '', err = '', code = 0
  try {
    out = execSync(fullCmd, { cwd: ROOT, timeout: 180000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    out = e.stdout || ''
    err = e.stderr || e.message || ''
    code = e.status || 1
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  // Parse results
  const toolMatches = out.match(/🔧\s+(\w+)/g) || []
  const toolCalls = toolMatches.map(m => m.replace('🔧 ', ''))
  const iterMatch = out.match(/第 (\d+) 轮/)
  const iterations = iterMatch ? parseInt(iterMatch[1]) : 0
  const hasCreate = out.includes('已创建') || out.includes('success')
  const hasNudge = out.includes('已读取完毕') || out.includes('立即')

  return { code, elapsed, toolCalls, iterations, hasCreate, hasNudge, out: out.slice(-500), err }
}

function test(name, command, verify) {
  console.log(`\n── ${name} ──`)
  console.log(`  命令: ${command.slice(0, 80)}...`)
  const r = runAgent(command)
  const verdict = verify(r)
  console.log(`  ${verdict.pass ? '✅' : '❌'} ${verdict.reason} | ${r.elapsed}s | ${r.iterations}轮 | 工具: [${r.toolCalls.join(',')}]`)
  if (r.hasNudge) console.log(`  ⚡ Nudge 触发: ${r.hasNudge}`)
  if (r.err && r.err.includes('Error')) console.log(`  ⚠️  stderr: ${r.err.slice(0, 200)}`)
  return { ...r, verdict: verdict.pass, name }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' v3 真实 Runtime 测试')
  console.log(` 使用: V4UnifiedRuntime (GUI 同一套代码)`)
  console.log(` 模型: ${MODEL}`)
  console.log('═══════════════════════════════════════')

  setup()
  const results = []

  // ═══ 分支1: 纯对话 (3 tests) ═══
  console.log('\n━━━ 分支1: 纯对话 ━━━')

  let r = test('T1-寒暄', '你好，请你用一句话介绍一下自己叫什么，能做什么。', r => ({
    pass: r.toolCalls.length === 0 && r.iterations <= 2,
    reason: r.toolCalls.length === 0 ? `纯文字(${r.iterations}轮,0工具)` : `调了工具:${r.toolCalls.join(',')}`
  }))
  results.push(r)

  r = await test('T2-对话分析', '这个修仙世界观里，元婴期修士能活多久？给我一些设定建议。', r => ({
    pass: r.toolCalls.length === 0 && r.iterations <= 2,
    reason: r.toolCalls.length === 0 ? `纯文字(${r.iterations}轮)` : `调了工具:${r.toolCalls.join(',')}`
  }))
  results.push(r)

  r = await test('T3-创意构思', '帮我想一个修仙小说里的反派角色，要有深度和反转。只需要文字描述，不需要创建文件。', r => ({
    pass: r.toolCalls.length === 0 && r.iterations <= 2,
    reason: r.toolCalls.length === 0 ? `纯文字(${r.iterations}轮)` : `调了工具:${r.toolCalls.join(',')}`
  }))
  results.push(r)

  // ═══ 分支2: 对话转化 (2 tests) ═══
  console.log('\n━━━ 分支2: 对话转化 ━━━')

  r = await test('T4-对话→创建角色卡', `在项目${TEST_PROJ}中创建角色卡文件。角色名柳如烟，女性，反派，魔道卧底在正道宗门。`, r => {
    // Check file was created
    let fileCreated = false
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'characters'))
      fileCreated = files.some(f => f.includes('柳') || f.includes('如烟') || f.includes('liu'))
      if (fileCreated) console.log(`  📁 角色卡已创建: ${files.find(f => f.includes('柳') || f.includes('如烟') || f.includes('liu'))}`)
    } catch {}
    return {
      pass: fileCreated,
      reason: fileCreated ? '文件已写入磁盘' : `未找到角色文件 (工具:${r.toolCalls.join(',')})`
    }
  })
  results.push(r)

  r = await test('T5-对话→追加大纲', `把我下面这个设定追加到项目${TEST_PROJ}的大纲 worldbuilding.md 文件中：这个世界的力量体系叫"灵脉九转"，修炼者通过打通体内灵脉来提升境界。`, r => {
    // Check if worldbuilding.md was modified
    let content = ''
    try { content = fs.readFileSync(path.join(TEST_DIR, 'outline', 'worldbuilding.md'), 'utf-8') } catch {}
    const hasAppend = content.includes('灵脉九转')
    return {
      pass: hasAppend || r.toolCalls.some(t => t.includes('edit') || t.includes('create')),
      reason: hasAppend ? '设定已写入worldbuilding.md' : `未写入 (工具:${r.toolCalls.join(',')})`
    }
  })
  results.push(r)

  // ═══ 分支3: 混合模式 (2 tests) ═══
  console.log('\n━━━ 分支3: 混合模式 ━━━')

  r = await test('T6-混合·分析+摘要', `分析下面这段文字，然后生成章节摘要保存到项目${TEST_PROJ}的 summaries/chapter1.md："林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他的对手是首席弟子陈啸天。金丹期的威压碾压而来，林逸咬牙死死撑住。突然一道青芒从他丹田炸开——上古剑魂觉醒了。"`, r => {
    let fileCreated = false
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'summaries'))
      fileCreated = files.length > 0
      if (fileCreated) console.log(`  📁 摘要已创建: ${files.join(', ')}`)
    } catch {}
    return {
      pass: fileCreated || r.hasCreate,
      reason: fileCreated ? '摘要文件已写入磁盘' : `未创建文件 (工具:${r.toolCalls.join(',')})`
    }
  })
  results.push(r)

  r = await test('T7-混合·分析+细纲', `分析这段文字并生成细纲保存到项目${TEST_PROJ}的 detailed_outline/chapter1.yaml："林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他的对手是首席弟子陈啸天。金丹期的威压碾压而来，林逸咬牙死死撑住。突然一道青芒从他丹田炸开——上古剑魂觉醒了。全场震惊。陈啸天脸色铁青。"`, r => {
    let fileCreated = false
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'detailed_outline'))
      fileCreated = files.length > 0
      if (fileCreated) console.log(`  📁 细纲已创建: ${files.join(', ')}`)
    } catch {}
    const content = fileCreated ? fs.readFileSync(path.join(TEST_DIR, 'detailed_outline', fs.readdirSync(path.join(TEST_DIR, 'detailed_outline'))[0]), 'utf-8') : ''
    const hasYaml = content.includes('plotOverview') || content.includes('keyEvents')
    return {
      pass: fileCreated && hasYaml,
      reason: fileCreated && hasYaml ? '细纲YAML已写入磁盘' : `文件:${fileCreated} YAML:${hasYaml}`
    }
  })
  results.push(r)

  // ═══ 分支4: 创作模式 (1 test) ═══
  console.log('\n━━━ 分支4: 创作模式 ━━━')

  r = await test('T8-创作·写章节', `帮我在项目${TEST_PROJ}写第1章，200字左右。主角林逸是剑修，宗门大比中觉醒剑魂。保存到 chapters/chapter1.txt。`, r => {
    let fileCreated = false, wordCount = 0
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'chapters'))
      if (files.length > 0) {
        const content = fs.readFileSync(path.join(TEST_DIR, 'chapters', files[0]), 'utf-8')
        wordCount = content.length
        fileCreated = true
        console.log(`  📁 章节已创建: ${files[0]} (${wordCount}字)`)
      }
    } catch {}
    return {
      pass: fileCreated && wordCount > 50,
      reason: fileCreated ? `章节已写入(${wordCount}字)` : `未创建文件`
    }
  })
  results.push(r)

  // ═══ 汇总 ═══
  console.log('\n═══════════════════════════════════════')
  console.log('                   结 果 汇 总')
  console.log('═══════════════════════════════════════')

  console.log(`\n| 场景 | 轮数 | 工具 | 判定 |`)
  console.log('|------|:--:|------|:--:|')
  for (const r of results) {
    console.log(`| ${r.name} | ${r.iterations} | [${r.toolCalls.slice(0,2).join(',')}] | ${r.verdict ? '✅' : '❌'} |`)
  }

  const pass = results.filter(r => r.verdict).length
  console.log(`\n通过: ${pass}/${results.length}`)

  // Cleanup
  // fs.rmSync(TEST_DIR, { recursive: true, force: true })
  console.log(`\n测试项目保留在: ${TEST_DIR} (可手动检查)`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
