#!/usr/bin/env node
/**
 * 仿真测试: 图片搜索与生成 (14-images)
 * 模拟用户进行图片搜索和生成操作。
 *
 * 场景: 搜索古风女侠图片 → 生成修仙场景图
 * 验证: search_images 和 generate_image 工具被正确调用。
 *
 * 复杂度: 简单 — 2个图片操作场景
 * 工具覆盖: search_images, generate_image
 *
 * 运行: node scripts/full-sim/14-images.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 5
const ROOT = path.resolve(import.meta.dirname || '.', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  工具实现
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 2000 ? c.slice(0, 2000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return '[错误: 文件不存在]'
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return '[错误: 目录不存在]'
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const keyword = a.pattern || ''
      if (!keyword) return '[错误]'
      let re
      try { re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') } catch { return '[错误]' }
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i]))
            results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
      } else {
        searchDir(fp)
      }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) { return '[错误]' }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, a.content || '')
      return '创建成功: ' + a.file_path
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  edit_file: a => {
    try {
      const fp = P(a.file_path)
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') { fs.writeFileSync(fp, nw); return '全量替换成功' }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return '[未找到匹配文本]'
      fs.writeFileSync(fp, c.slice(0, idx) + nw + c.slice(idx + old.length))
      return '编辑成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path)); return '删除成功' } catch { return '[错误]' }
  },

  // ── 图片相关工具 (mock实现) ──
  search_images: a => {
    const query = String(a.query || '').trim()
    if (!query) return '[错误: 缺少搜索关键词]'
    const count = Math.min(Math.max(parseInt(a.count) || 5, 1), 10)
    const results = []
    const mockPool = [
      { id: 'img001', desc: query + ' 场景图1', url: 'https://images.unsplash.com/example1.jpg', width: 1920, height: 1080 },
      { id: 'img002', desc: query + ' 场景图2', url: 'https://images.unsplash.com/example2.jpg', width: 1920, height: 1280 },
      { id: 'img003', desc: query + ' 角色概念图', url: 'https://images.unsplash.com/example3.jpg', width: 1080, height: 1920 },
      { id: 'img004', desc: query + ' 意境参考图', url: 'https://images.unsplash.com/example4.jpg', width: 1600, height: 900 },
      { id: 'img005', desc: query + ' 氛围参考图', url: 'https://images.unsplash.com/example5.jpg', width: 2048, height: 1024 },
    ]
    for (let i = 0; i < Math.min(count, mockPool.length); i++) {
      results.push(mockPool[i])
    }
    return '找到 ' + results.length + ' 张图片:\n' + results.map(r =>
      '  - [' + r.id + '] ' + r.desc + ' (' + r.width + 'x' + r.height + ')\n    ' + r.url
    ).join('\n')
  },

  generate_image: a => {
    const prompt = String(a.prompt || a.query || '').trim()
    if (!prompt) return '[错误: 缺少生成提示词]'
    const style = a.style || '写实'
    const size = a.size || '1024x1024'
    return [
      '图片生成成功!',
      '  提示词: ' + prompt,
      '  风格: ' + style,
      '  尺寸: ' + size,
      '  预览: https://images.unsplash.com/generated-' + Date.now() + '.jpg',
      '  ID: gen_' + Math.random().toString(36).slice(2, 10),
    ].join('\n')
  },
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取项目文件', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'search_images', description: '搜索参考图片。用于查找角色形象/场景参考/氛围图等。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词，如"古风女侠"' }, count: { type: 'integer', description: '返回图片数量(1-10)，默认5', default: 5 } }, required: ['query'] } } },
  { type: 'function', function: { name: 'generate_image', description: '生成AI图片。根据文字描述生成原创图片。', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '图片生成提示词，详细描述想要的画面' }, style: { type: 'string', description: '风格，如"写实""水墨""二次元"', default: '写实' }, size: { type: 'string', description: '图片尺寸，如"1024x1024"', default: '1024x1024' } }, required: ['prompt'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 图片功能',
  '用户说"搜索图片"/"找图"/"搜图"时，使用 search_images 工具。',
  '用户说"生成图"/"画"/"生成一张"时，使用 generate_image 工具。',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了。',
  '- 搜索/生成完成后汇报结果。',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 2048,
    tools: TOOLS,
    tool_choice: 'auto',
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200))
  }
  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ═══════════════════════════════════════════════════
//  Agent 运行循环
// ═══════════════════════════════════════════════════
async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0
  let totalTools = 0
  let fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write('  [iter' + iterations + '] ')

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write('文本回复(' + r.text.length + '字)\n')
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch {}
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = result.startsWith && !result.startsWith('[')
      totalTools++
      process.stdout.write(fn.name + (ok ? '✓' : '✗') + ' ')
      toolLog.push({ name: fn.name, ok, args, result: result.slice(0, 100) })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  测试框架
// ═══════════════════════════════════════════════════
let pass = 0
let fail = 0

function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name + (detail ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ❌ ' + name + (detail ? ': ' + detail : ''))
  }
}

function hr(title) {
  console.log('\n' + '─'.repeat(55))
  console.log('  ' + title)
  console.log('─'.repeat(55))
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 图片 (14-images)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 图片搜索与生成 — 验证 search_images/generate_image')
  console.log('══════════════════════════════════════')

  // ──────────────────────────────────────────────
  //  S1: 搜索古风女侠图片
  // ──────────────────────────────────────────────
  hr('S1 图片搜索 — “搜索古风女侠的图片”')
  const r1 = await agentRun('搜索古风女侠的图片')
  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 search_images 被调用', r1.toolLog.some(l => l.name === 'search_images'),
    r1.toolLog.filter(l => l.name === 'search_images').length + '次')
  const s1img = r1.toolLog.find(l => l.name === 'search_images')
  t('S1 搜索关键词包含古风或女侠', s1img && s1img.args && (
    String(s1img.args.query).includes('古风') || String(s1img.args.query).includes('女侠')
  ), 'query=' + (s1img ? JSON.stringify(s1img.args.query) : '无'))
  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S2: 生成修仙场景图
  // ──────────────────────────────────────────────
  hr('S2 图片生成 — “生成一张修仙场景图”')
  const r2 = await agentRun('生成一张修仙场景图')
  t('S2 返回文本', r2.text.length > 0, r2.text.length + '字')
  t('S2 generate_image 被调用', r2.toolLog.some(l => l.name === 'generate_image'),
    r2.toolLog.filter(l => l.name === 'generate_image').length + '次')
  const s2img = r2.toolLog.find(l => l.name === 'generate_image')
  t('S2 生成提示词包含修仙', s2img && s2img.args && (
    String(s2img.args.prompt || s2img.args.query || '').includes('修仙')
  ), 'prompt=' + (s2img ? JSON.stringify(s2img.args.prompt || s2img.args.query || '') : '无'))
  console.log('    工具调用: ' + r2.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r2.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 图片 (14-images) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  搜索图片  — “搜索古风女侠的图片”')
  console.log('    S2  生成图片  — “生成一张修仙场景图”')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
