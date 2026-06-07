#!/usr/bin/env node
/**
 * AI 写作助手 — CLI 集成测试 (v11.5.1)
 *
 * 测试真实的 Runtime 工作流：索引 → read_file/find_files → create_file/edit_file
 * 使用 Anthropic 协议 + deepseek-v4-flash 模型。
 *
 * 用法:
 *   node scripts/cli-test.mjs              # 全部 7 场景
 *   node scripts/cli-test.mjs --only=C1    # 单个场景
 *   node scripts/cli-test.mjs --keep       # 保留测试项目
 *
 * 环境变量:
 *   AI_API_KEY  — API 密钥 (默认使用内置 key)
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..')
const PROJECTS = path.join(ROOT, 'projects')
const TEST_PROJ = '_cli_test'
const TEST_DIR = path.join(PROJECTS, TEST_PROJ)

// ══════════════════════════════════════════════════════════════
// 配置
// ══════════════════════════════════════════════════════════════

const CONFIG = {
  apiKey: process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d',
  apiUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  protocol: 'anthropic',
  timeout: 120_000,        // 每场景最大 120s
  maxIterations: 60,
}

// ══════════════════════════════════════════════════════════════
// 测试场景
// ══════════════════════════════════════════════════════════════

const SCENARIOS = [
  {
    id: 'C1',
    name: '知识问答 — 不调工具直接回答',
    setup: null,
    command: '你好，请你用一句话介绍一下自己叫什么名字，能做什么',
    verify: (output) => {
      return output.includes('青剑') && !output.includes('read_file') && !output.includes('list_directory')
    },
    expectTools: 0,
  },
  {
    id: 'C2',
    name: '项目列表 — list_directory 唯一合理场景',
    setup: null,
    command: `这个软件里有哪些小说项目？列出它们的名字`,
    verify: (output) => {
      return true  // 只要不报错就通过
    },
    expectToolsMin: 1,
    expectToolsMax: 3,
  },
  {
    id: 'C3',
    name: '读取文件 — 索引→直接 read_file',
    setup: () => {
      fs.mkdirSync(path.join(TEST_DIR, 'outline'), { recursive: true })
      fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'),
        '# 故事剧情\n\n> 这是一个测试项目的梗概\n\n## 第一章·开端\n\n故事从这里开始。\n', 'utf-8')
      fs.writeFileSync(path.join(TEST_DIR, 'project.json'),
        JSON.stringify({ type: 'writing', novelCategory: 'general' }), 'utf-8')
    },
    command: `读一下项目 ${TEST_PROJ} 的大纲文件，告诉我故事梗概是什么`,
    verify: (output) => {
      return output.includes('测试') || output.includes('梗概') || output.includes('开端')
    },
    expectToolsMin: 1,
    expectToolsMax: 3,
  },
  {
    id: 'C4',
    name: '搜索文件 — find_files 按模式递归搜索',
    setup: () => {
      fs.mkdirSync(path.join(TEST_DIR, 'characters'), { recursive: true })
      fs.writeFileSync(path.join(TEST_DIR, 'characters', '张三.yaml'),
        'id: zhangsan\nname: 张三\nrole: 男主\n', 'utf-8')
      fs.writeFileSync(path.join(TEST_DIR, 'characters', '李四.yaml'),
        'id: lisi\nname: 李四\nrole: 男配\n', 'utf-8')
    },
    command: `在项目 ${TEST_PROJ} 中找所有 .yaml 文件`,
    verify: (output) => {
      return output.includes('张三') || output.includes('李四') || output.includes('zhangsan') || output.includes('lisi')
    },
    expectToolsMin: 1,
    expectToolsMax: 3,
  },
  {
    id: 'C5',
    name: '创建角色 — read_file模板→create_file完整角色',
    setup: null,
    command: `在项目 ${TEST_PROJ} 中创建角色"王五"，身份是江湖侠客，男性配角`,
    verify: (output) => {
      try {
        const files = fs.readdirSync(path.join(TEST_DIR, 'characters'))
        const match = files.find(f => f.includes('王五') || f.includes('wangwu'))
        if (match) {
          const content = fs.readFileSync(path.join(TEST_DIR, 'characters', match), 'utf-8')
          return content.includes('王五') && (content.includes('男配') || content.includes('侠客'))
        }
        return false
      } catch { return false }
    },
    expectToolsMin: 1,
    expectToolsMax: 5,
  },
  {
    id: 'C6',
    name: '编辑文件 — read_file→edit_file 精确替换',
    setup: () => {
      fs.mkdirSync(path.join(TEST_DIR, 'outline'), { recursive: true })
      const plot = '# 故事剧情\n\n> 测试项目的梗概\n\n## 第一章·开端\n\n故事从这里开始。\n'
      fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), plot, 'utf-8')
    },
    command: `在项目 ${TEST_PROJ} 的大纲中，把"故事从这里开始"改成"故事从一座古城开始"`,
    verify: (output) => {
      try {
        const content = fs.readFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), 'utf-8')
        return content.includes('故事从一座古城开始') && !content.includes('故事从这里开始')
      } catch { return false }
    },
    expectToolsMin: 2,
    expectToolsMax: 5,
  },
  {
    id: 'C7',
    name: 'nudge 不无限循环 — >200字回复直接接受',
    setup: null,
    command: `分析项目 ${TEST_PROJ} 的当前状态，列出已有文件和角色，然后总结一下项目概况`,
    verify: (output) => {
      // 关键：不应该因为nudge导致超时或无限循环
      return output.includes('轮') && !output.includes('超时') && !output.includes('已读取完毕。现在请**立即**')
    },
    expectToolsMin: 0,
    expectToolsMax: 10,
  },
]

// ══════════════════════════════════════════════════════════════
// 测试运行器
// ══════════════════════════════════════════════════════════════

let passed = 0
let failed = 0
const results = []

function log(icon, msg) {
  const ts = new Date().toLocaleTimeString('zh-CN')
  console.log(`  ${icon} [${ts}] ${msg}`)
}

function spinStart(msg) {
  process.stdout.write(`  ⏳ ${msg}...`)
}

function spinDone(icon) {
  process.stdout.write(`\r  ${icon}\n`)
}

async function runScenario(scenario) {
  log('📋', `${scenario.id}: ${scenario.name}`)

  // Setup
  if (scenario.setup) {
    try { scenario.setup() } catch {}
  }

  const start = Date.now()
  let output = ''
  let timedOut = false

  try {
    output = await new Promise((resolve, reject) => {
      const runArgs = [
        'tsx', '--tsconfig', 'scripts/tsconfig.cli.json',
        'scripts/run-agent.ts',
        `--protocol=${CONFIG.protocol}`,
        `--model=${CONFIG.model}`,
        `--api-key=${CONFIG.apiKey}`,
        `--api-url=${CONFIG.apiUrl}`,
        `--project=${TEST_PROJ}`,
        `--max-iters=${CONFIG.maxIterations}`,
        `--command=${scenario.command}`,
      ]
      // Escape single quotes in command
      const cmdStr = `export AI_API_KEY='${CONFIG.apiKey}' && npx ${runArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`

      const child = spawn('bash', ['-c', cmdStr], {
        cwd: ROOT,
        env: { ...process.env, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: CONFIG.timeout,
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

      child.on('close', (code) => {
        resolve(stdout + (stderr ? '\n[STDERR]\n' + stderr : ''))
      })

      child.on('error', (err) => {
        resolve(`[PROCESS ERROR] ${err.message}`)
      })
    })
  } catch (err) {
    output = `[EXCEPTION] ${err.message}`
    timedOut = true
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  const toolMatch = output.match(/(\d+) 工具/)
  const toolCount = toolMatch ? parseInt(toolMatch[1]) : 0
  const iterMatch = output.match(/(\d+) 轮/)
  const iterCount = iterMatch ? parseInt(iterMatch[1]) : 0

  // 验证
  const verifyResult = scenario.verify(output)
  const toolOk = (scenario.expectToolsMin === undefined || toolCount >= scenario.expectToolsMin) &&
                 (scenario.expectToolsMax === undefined || toolCount <= scenario.expectToolsMax)
  const passed_test = verifyResult && toolOk

  const result = {
    id: scenario.id, name: scenario.name,
    passed: passed_test,
    elapsed, toolCount, iterCount,
    verifyResult, toolOk,
  }
  results.push(result)

  if (passed_test) {
    passed++
    log('✅', `通过 · ${iterCount}轮 · ${toolCount}工具 · ${elapsed}s`)
  } else {
    failed++
    const reasons = []
    if (!verifyResult) reasons.push('验证失败')
    if (!toolOk) reasons.push(`工具数=${toolCount}(预期${scenario.expectToolsMin || 0}-${scenario.expectToolsMax || '∞'})`)
    log('❌', `失败 · ${reasons.join('; ')} · ${iterCount}轮 · ${toolCount}工具 · ${elapsed}s`)
    // 截取最后500字供调试
    const tail = output.slice(-500).replace(/\n/g, '\\n')
    console.log(`      输出末尾: ${tail}`)
  }

  return result
}

// ══════════════════════════════════════════════════════════════
// 清理
// ══════════════════════════════════════════════════════════════

function cleanup() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {}
}

function setupTestProject() {
  cleanup()
  fs.mkdirSync(TEST_DIR, { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'characters'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'outline'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'chapters'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'detailed_outline'), { recursive: true })
  fs.mkdirSync(path.join(TEST_DIR, 'summaries'), { recursive: true })
  fs.writeFileSync(path.join(TEST_DIR, 'project.json'),
    JSON.stringify({ type: 'writing', novelCategory: 'general' }), 'utf-8')
}

// ══════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════

const onlyArg = process.argv.find(a => a.startsWith('--only='))
const keepArg = process.argv.includes('--keep')

async function main() {
  console.log('')
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  AI 写作助手 CLI 集成测试 (v11.5.1)     ║')
  console.log(`║  协议: ${CONFIG.protocol.padEnd(26)}     ║`)
  console.log(`║  模型: ${CONFIG.model.padEnd(26)}     ║`)
  console.log('╚══════════════════════════════════════════╝')
  console.log('')

  if (!CONFIG.apiKey) {
    console.error('❌ 未设置 API 密钥。请设置 AI_API_KEY 环境变量。')
    process.exit(1)
  }

  const toRun = onlyArg
    ? SCENARIOS.filter(s => onlyArg.slice(7).split(',').includes(s.id))
    : SCENARIOS

  if (toRun.length === 0) {
    console.error('❌ 未找到匹配的场景')
    process.exit(1)
  }

  // 每个场景前重建干净项目
  for (const scenario of toRun) {
    setupTestProject()
    await runScenario(scenario)
  }

  // 清理
  if (!keepArg) {
    cleanup()
  }

  // 汇总
  console.log('')
  console.log('═══════════════════════════════════════════')
  console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${results.length} 总计`)
  console.log('═══════════════════════════════════════════')

  if (failed > 0) {
    console.log('')
    console.log('  失败场景:')
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ❌ ${r.id}: ${r.name}`)
    }
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('致命错误:', err.message)
  process.exit(1)
})
