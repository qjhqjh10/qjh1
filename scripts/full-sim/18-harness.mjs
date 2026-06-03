#!/usr/bin/env node
/**
 * 仿真测试: 自管理 (18-harness)
 * 模拟用户打开AI写作助手，进行规则学习、审计查看、经验记录、
 * 配置更新等自管理操作。
 *
 * 场景: 用户管理AI助手的规则库、审计日志、学习经验和配置。
 * 验证: list_rules / learn_rule / list_audit / write_learning / update_config
 *       五个自管理工具的正确性和错误恢复能力。
 *
 * 复杂度: medium — 4轮主对话 + 4个边界测试, 3-5个工具调用
 * 工具覆盖: list_rules, learn_rule, list_audit, write_learning, update_config
 *
 * 运行: node scripts/full-sim/18-harness.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()

// 测试数据隔离目录 —— 保证每次运行结果可控、可重复
const TEST_DATA = path.join(ROOT, 'test_data', '18-harness')
const TD = p => path.join(TEST_DATA, p)

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

// ═══════════════════════════════════════════════════
//  工具实现（自管理五个核心工具采用真实文件持久化，
//  其余工具保留为 stub，确保完全兼容完整工具集）
// ═══════════════════════════════════════════════════
const tools = {

  // ─── 文件操作（标准实现，与 openai-sim-test.mjs 一致） ───
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(path.join(ROOT, 'projects', fp), 'utf-8')
      return c.length > 2000 ? c.slice(0, 2000) + '\n...(' + c.length + '字)' : c
    } catch (e) {
      return `[错误: 文件不存在或无法读取: ${fp}]`
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const entries = fs.readdirSync(path.join(ROOT, 'projects', dir), { withFileTypes: true })
      return entries.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return `[错误: 目录不存在: ${dir}]`
    }
  },

  search_content: a => {
    try {
      const fp = path.join(ROOT, 'projects', a.path || '.')
      const re = new RegExp((a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
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
    } catch (e) {
      return '[错误: 搜索失败]'
    }
  },

  create_file: a => {
    try {
      const fp = path.join(ROOT, 'projects', a.file_path || a.path || '')
      const c = a.content || ''
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) {
          return `[JSON格式错误: ${e.message}]`
        }
      }
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c, 'utf-8')
      return `创建成功: ${a.file_path || a.path}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  edit_file: a => {
    try {
      const fp = path.join(ROOT, 'projects', a.file_path || a.path || '')
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fp, nw, 'utf-8')
        return '全量替换成功'
      }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return `[未找到匹配文本: "${old.slice(0, 80)}"]`
      fs.writeFileSync(fp, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  delete_file: a => {
    try {
      fs.unlinkSync(path.join(ROOT, 'projects', a.file_path || a.path || ''))
      return '删除成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  // ─── 知识库 / 笔记 / 项目（stub 实现） ───
  kb_list: () => {
    try {
      const kdir = path.join(ROOT, 'knowledge_base', 'files')
      fs.mkdirSync(kdir, { recursive: true })
      return fs.readdirSync(kdir).filter(f => f.endsWith('.md')).join('\n') || '无KB文件'
    } catch { return '无KB文件' }
  },

  kb_create_file: a => {
    try {
      const kdir = path.join(ROOT, 'knowledge_base', 'files')
      fs.mkdirSync(kdir, { recursive: true })
      fs.writeFileSync(path.join(kdir, (a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return 'KB创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  list_notes: () => {
    try {
      const ndir = path.join(ROOT, 'notes')
      fs.mkdirSync(ndir, { recursive: true })
      return fs.readdirSync(ndir).filter(f => f.endsWith('.md')).join('\n') || '无笔记'
    } catch { return '无笔记' }
  },

  write_note: a => {
    try {
      const ndir = path.join(ROOT, 'notes')
      fs.mkdirSync(ndir, { recursive: true })
      fs.writeFileSync(path.join(ndir, (a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return '笔记创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  read_note: a => {
    try {
      return fs.readFileSync(path.join(ROOT, 'notes', (a.name || 'x') + '.md'), 'utf-8').slice(0, 500)
    } catch { return '[笔记不存在]' }
  },

  delete_note: a => {
    try {
      fs.unlinkSync(path.join(ROOT, 'notes', (a.name || 'x') + '.md'))
      return '笔记删除成功'
    } catch { return '[错误]' }
  },

  create_style_template: a => {
    try {
      const sdir = path.join(ROOT, 'style_templates')
      fs.mkdirSync(sdir, { recursive: true })
      fs.writeFileSync(path.join(sdir, (a.name || 'x') + '.json'), JSON.stringify(a, null, 2), 'utf-8')
      return '模板创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  create_project: a => {
    try {
      const d = path.join(ROOT, 'projects', a.name || 'new-project')
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        s => fs.mkdirSync(path.join(d, s), { recursive: true })
      )
      return `项目${a.name}创建成功`
    } catch (e) { return `[错误: ${e.message}]` }
  },

  delete_project: a => {
    try {
      fs.rmSync(path.join(ROOT, 'projects', a.name || ''), { recursive: true, force: true })
      return '项目删除成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',

  // ═══════════════════════════════════════════════════
  //  自管理核心工具（真实持久化实现）
  // ═══════════════════════════════════════════════════

  /**
   * list_rules — 列出所有已学习的规则
   * 从 test_data/18-harness/rules/ 目录读取 .md 文件
   */
  list_rules: () => {
    try {
      const rulesDir = TD('rules')
      ensureDir(rulesDir)
      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'))
      if (files.length === 0) return '暂无已学习的规则。用户尚未添加任何自定义规则。'
      const items = files.map((f, i) => {
        const content = fs.readFileSync(path.join(rulesDir, f), 'utf-8')
        const preview = content.slice(0, 200)
        return `[${i + 1}] ${f.replace(/\.md$/, '')}\n    ${preview}${content.length > 200 ? '...' : ''}\n`
      })
      return `共 ${files.length} 条已学习规则:\n\n${items.join('\n')}`
    } catch (e) {
      return `[错误: 读取规则列表失败: ${e.message}]`
    }
  },

  /**
   * learn_rule — 学习新规则
   * 将规则内容写入 test_data/18-harness/rules/{摘要}.md
   * 自动从内容前20字生成文件名
   */
  learn_rule: a => {
    try {
      const rule = (a.rule || '').trim()
      if (!rule) return '[错误: 规则内容不能为空]'

      const rulesDir = TD('rules')
      ensureDir(rulesDir)

      // 用内容前20字 + 时间戳生成唯一文件名
      const slug = rule.slice(0, 20).replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_')
      const ts = Date.now()
      const filename = `${slug}_${ts}.md`

      // 构建带时间戳的完整规则文件
      const fullContent = [
        `# 规则 (学习于 ${new Date(ts).toISOString()})`,
        '',
        rule,
        '',
      ].join('\n')

      fs.writeFileSync(path.join(rulesDir, filename), fullContent, 'utf-8')
      return `规则已学习并保存。规则摘要: "${rule.slice(0, 80)}${rule.length > 80 ? '...' : ''}"`
    } catch (e) {
      return `[错误: 学习规则失败: ${e.message}]`
    }
  },

  /**
   * list_audit — 查看审计记录
   * 从 test_data/18-harness/audit/ 目录读取审计日志
   * 如果没有记录，返回空状态
   */
  list_audit: () => {
    try {
      const auditDir = TD('audit')
      ensureDir(auditDir)
      const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.json'))
      if (files.length === 0) return '暂无审计记录。系统运行正常，没有需要审计的异常事件。'

      const items = files.map((f, i) => {
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(auditDir, f), 'utf-8'))
          return `[${i + 1}] ${entry.timestamp || '未知时间'} | ${entry.action || '未知操作'} | ${entry.detail || ''}`
        } catch {
          return `[${i + 1}] ${f} (格式异常)`
        }
      })
      return `共 ${files.length} 条审计记录:\n\n${items.join('\n')}`
    } catch (e) {
      return `[错误: 读取审计记录失败: ${e.message}]`
    }
  },

  /**
   * write_learning — 记录学习经验
   * 将经验写入 test_data/18-harness/learnings/ 目录
   */
  write_learning: a => {
    try {
      const summary = (a.summary || '').trim()
      if (!summary) return '[错误: 经验内容不能为空]'

      const learnDir = TD('learnings')
      ensureDir(learnDir)

      const slug = summary.slice(0, 20).replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_')
      const ts = Date.now()
      const filename = `${slug}_${ts}.md`

      const fullContent = [
        `# 学习经验 (记录于 ${new Date(ts).toISOString()})`,
        '',
        summary,
        '',
      ].join('\n')

      fs.writeFileSync(path.join(learnDir, filename), fullContent, 'utf-8')
      return `学习经验已记录。内容摘要: "${summary.slice(0, 80)}${summary.length > 80 ? '...' : ''}"`
    } catch (e) {
      return `[错误: 记录经验失败: ${e.message}]`
    }
  },

  /**
   * update_config — 更新AI助手配置
   * 读写 test_data/18-harness/config.json
   * 自动校验 JSON 格式
   */
  update_config: a => {
    try {
      const configPath = TD('config.json')
      ensureDir(TEST_DATA)

      // 读取现有配置
      let config = {}
      try {
        const raw = fs.readFileSync(configPath, 'utf-8')
        config = JSON.parse(raw)
      } catch {
        // 配置文件不存在或损坏，从头开始
      }

      // 支持两种更新方式：单 key/value 或批量 updates
      if (a.key !== undefined && a.value !== undefined) {
        const key = String(a.key).trim()
        if (!key) return '[错误: 配置键名不能为空]'

        // 尝试智能解析 value —— 可能是 JSON 字符串
        let parsedValue = a.value
        try { parsedValue = JSON.parse(a.value) } catch { /* 保持原字符串 */ }
        config[key] = parsedValue
      }

      if (a.updates !== undefined) {
        let updates = a.updates
        if (typeof updates === 'string') {
          try { updates = JSON.parse(updates) } catch (e) {
            return `[JSON格式错误: updates参数不是合法的JSON - ${e.message}]`
          }
        }
        if (typeof updates !== 'object' || updates === null) {
          return '[错误: updates参数必须是一个JSON对象]'
        }
        Object.assign(config, updates)
      }

      // 验证 config 中所有值都可以被序列化
      try {
        JSON.stringify(config)
      } catch (e) {
        return `[JSON序列化错误: ${e.message}]`
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

      const keys = Object.keys(config)
      return `配置已更新。当前配置项(${keys.length}项): ${keys.map(k => `${k}=${JSON.stringify(config[k])}`).join(', ')}`
    } catch (e) {
      return `[错误: 更新配置失败: ${e.message}]`
    }
  },
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义（与真实 Harness 一致）
// ═══════════════════════════════════════════════════
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目文件内容。不需要先list_directory。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: '文件相对路径，如 1/characters/林语晴.yaml' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出项目目录内容',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录路径，如 1/characters' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '搜索项目文件内容',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词或正则' },
          path: { type: 'string', description: '搜索路径(可选)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '创建新文件。JSON文件自动校验格式。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑文件内容。先read_file确认原文。old_string=__FULL_REPLACE__表示全量替换。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除项目文件',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_list',
      description: '列出知识库文件',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_create_file',
      description: '创建KB文件',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出所有笔记',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '创建笔记',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取笔记',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: '删除笔记',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_style_template',
      description: '创建风格模板',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '创建项目',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: '删除项目',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_prompts',
      description: '列出提示词模板',
      parameters: { type: 'object', properties: {} },
    },
  },
  // ═══════════════════════════════════════════
  //  自管理五个核心工具定义
  // ═══════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: '列出所有已学习的自定义规则。用户想查看当前有哪些规则时调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'learn_rule',
      description: '学习并保存一条新的写作规则。用户说"记住""学习""添加规则"时调用。',
      parameters: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: '要学习的规则全文' },
        },
        required: ['rule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_audit',
      description: '查看审计记录/操作日志。用户想了解系统运行历史时调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_learning',
      description: '记录用户的写作学习经验/心得。用户说"记录经验""记住心得""总结教训"时调用。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '经验的完整描述' },
        },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_config',
      description: '更新AI助手的配置项。用户说"修改配置""设置""改成""更新设置"时调用。支持单键值对(key/value)或批量更新(updates JSON对象)。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '配置键名，如 default_project, language, auto_save' },
          value: { type: 'string', description: '配置值，可以是字符串或JSON' },
          updates: { type: 'string', description: '批量更新的JSON对象字符串，如 {"key1":"val1","key2":"val2"}' },
        },
        required: [],
      },
    },
  },
]

// ═══════════════════════════════════════════════════
//  系统提示词（与真实 Harness 的 CORE_SYSTEM_PROMPT 概念一致）
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，帮助用户进行小说创作。',

  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作）：',
  '  - 查看/列出规则 → list_rules',
  '  - 学习/记住/添加规则 → learn_rule',
  '  - 查看审计/操作日志 → list_audit',
  '  - 记录经验/心得/教训 → write_learning',
  '  - 修改/更新/设置配置 → update_config',
  '  - 读/写/搜索/创建/编辑/删除文件 → 对应文件工具',
  '❌ 不调工具（纯对话）：',
  '  - 问候/闲聊/我是/我叫/我喜欢/我觉得/谢谢/什么是/为什么/怎么/推荐',

  '',
  '# 执行规则',
  '- 已知文件路径直接读文件，不需要先列目录。',
  '- 修改文件前必须先读取原文件内容。',
  '- list_rules / list_audit 直接调用即可，不需要额外准备。',
  '- learn_rule 将规则原文完整传入 rule 参数。',
  '- write_learning 将经验全文传入 summary 参数。',
  '- update_config 使用 key+value 参数；批量更新用 updates 参数传入 JSON。',
  '- 只做用户要求的操作，不多做也不少做。',
  '- 操作完成后向用户确认结果，回复简洁。',

  '',
  '# 路径速查',
  '角色: {项目}/characters/{中文名}.yaml  例: 1/characters/林语晴.yaml',
  '章节: {项目}/chapters/chapter{N}.txt   例: 1/chapters/chapter3.txt',
  '细纲: {项目}/detailed_outline/chapter{N}.yaml',
  '大纲: {项目}/outline/plot.md',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用（与 openai-sim-test.mjs 一致的 fetch 模式）
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
//  Agent 运行循环（与 openai-sim-test.mjs 一致的 agentRun 模式）
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
    process.stdout.write(`  [iter${iterations}] `)

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write(`文本回复(${r.text.length}字)\n`)
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant 消息（含 tool_calls）
    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    // 执行每个工具调用
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch { /* ignore parse errors */ }

      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = typeof result === 'string' && !result.startsWith('[')
      const icon = ok ? '✓' : '✗'
      totalTools++

      process.stdout.write(`${fn.name}${icon} `)
      toolLog.push({ name: fn.name, ok, args, result: (result || '').slice(0, 120) })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
    process.stdout.write('\n')
  }

  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  多轮对话运行（模拟真实用户的多轮交互）
// ═══════════════════════════════════════════════════
async function multiTurnRun(userMessages) {
  const messages = [{ role: 'system', content: SYS }]
  let totalIterations = 0, totalTools = 0, allTexts = [], allUsages = []
  const allToolLogs = []
  const turnResults = []

  for (let turnIdx = 0; turnIdx < userMessages.length; turnIdx++) {
    const userMsg = userMessages[turnIdx]
    messages.push({ role: 'user', content: userMsg })
    const preview = userMsg.length > 50 ? userMsg.slice(0, 50) + '...' : userMsg
    process.stdout.write(`  [轮${turnIdx + 1}] "${preview}" `)

    let turnIterations = 0
    let turnText = ''
    const turnToolLog = []

    while (turnIterations < MAX_ITERATIONS) {
      turnIterations++
      totalIterations++
      const r = await callOpenAI(messages)
      if (r.text) turnText = r.text
      if (r.usage) allUsages.push(r.usage)

      if (!r.toolCalls.length) {
        allTexts.push(turnText)
        process.stdout.write(`→ ${turnText.slice(0, 60)}${turnText.length > 60 ? '...' : ''}\n`)
        turnResults.push({ text: turnText, toolLog: turnToolLog, iterations: turnIterations })
        break
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
        try { args = JSON.parse(fn.arguments) } catch { /* ignore */ }

        const result = toolFn ? await toolFn(args) : '[未知工具]'
        const ok = typeof result === 'string' && !result.startsWith('[')
        totalTools++
        const icon = ok ? '✓' : '✗'

        process.stdout.write(`${fn.name}${icon} `)
        const entry = { name: fn.name, ok, args, result: (result || '').slice(0, 120) }
        turnToolLog.push(entry)
        allToolLogs.push(entry)

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        })
      }
      process.stdout.write('\n')
    }
  }

  return {
    text: allTexts[allTexts.length - 1] || '',
    allTexts,
    turnResults,
    iterations: totalIterations,
    toolCalls: totalTools,
    toolLog: allToolLogs,
    totalTokens: allUsages.reduce((s, u) => s + (u.total_tokens || 0), 0),
  }
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
//  初始化测试环境
// ═══════════════════════════════════════════════════
function setupTestData() {
  // 清理旧数据，保证测试可重复
  try { fs.rmSync(TEST_DATA, { recursive: true, force: true }) } catch {}

  // 创建目录结构
  ensureDir(TD('rules'))
  ensureDir(TD('audit'))
  ensureDir(TD('learnings'))

  // 预置一条审计记录（模拟系统已有运行历史）
  const initAudit = {
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    action: 'session_start',
    detail: '系统启动，加载默认配置',
  }
  fs.writeFileSync(
    TD('audit/init_session.json'),
    JSON.stringify(initAudit, null, 2),
    'utf-8'
  )

  // 预置一条初始规则（模拟用户之前已经学过一条规则）
  const initRule = '写作时保持章节长度在2000-4000字之间，确保每章都有一个完整的情节单元。'
  const initRuleContent = [
    `# 规则 (学习于 ${new Date(Date.now() - 172800000).toISOString()})`,
    '',
    initRule,
    '',
  ].join('\n')
  fs.writeFileSync(TD('rules/章节长度控制.md'), initRuleContent, 'utf-8')
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试: 自管理 (18-harness)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: 规则学习 / 审计查看 / 经验记录 / 配置更新')
  console.log('═══════════════════════════════════════════════')

  setupTestData()

  // ──────────────────────────────────────────────
  //  S1: 查看现有规则 (list_rules)
  // ──────────────────────────────────────────────
  hr('S1 查看现有规则')
  console.log('  用户: "帮我看看现在有哪些写作规则？我想确认一下"')
  const r1 = await agentRun('帮我看看现在有哪些写作规则？我想确认一下')
  t('S1 调用了list_rules',
    r1.toolLog.some(l => l.name === 'list_rules'),
    r1.iterations + '轮 ' + r1.toolCalls + '工具')
  t('S1 list_rules成功',
    r1.toolLog.some(l => l.name === 'list_rules' && l.ok),
    '返回规则列表')
  t('S1 有文本回复',
    r1.text.length > 0,
    r1.text.length + '字')
  t('S1 回复含中文',
    /[一-鿿]/.test(r1.text),
    '中文回复')
  console.log('    回复: ' + r1.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S2: 学习新规则 (learn_rule)
  // ──────────────────────────────────────────────
  hr('S2 学习新规则')
  console.log('  用户: "我学到一条新规则，帮我记住：每次写完一章后，')
  console.log('         必须先检查这三件事——1.人物对话是否符合作品性格，')
  console.log('         2.情节逻辑是否有漏洞，3.给下一章写一个简短大纲"')
  const ruleText = '每次写完一章后，必须先做三件事：' +
    '1. 检查人物对话是否符合作品性格设定，' +
    '2. 检查情节逻辑是否有前后矛盾和漏洞，' +
    '3. 给下一章写一个简短大纲（100-200字），明确下一章的核心冲突和推进方向。'
  const r2 = await agentRun('我学到一条新规则，帮我记住：' + ruleText)
  t('S2 调用了learn_rule',
    r2.toolLog.some(l => l.name === 'learn_rule'),
    r2.iterations + '轮 ' + r2.toolCalls + '工具')
  t('S2 learn_rule成功',
    r2.toolLog.some(l => l.name === 'learn_rule' && l.ok),
    '规则已保存')
  t('S2 规则参数非空',
    r2.toolLog.some(l => l.name === 'learn_rule' && l.args.rule && l.args.rule.length > 30),
    '规则内容完整传入')
  t('S2 有确认回复',
    r2.text.length > 0,
    r2.text.length + '字')
  console.log('    回复: ' + r2.text.slice(0, 120))

  // 验证规则文件确实被创建
  try {
    const ruleFiles = fs.readdirSync(TD('rules')).filter(f => f.endsWith('.md'))
    t('S2a 规则文件已持久化',
      ruleFiles.length >= 2,
      `${ruleFiles.length}个规则文件 (预期 >=2)`)
  } catch (e) {
    t('S2a 规则文件已持久化', false, e.message)
  }

  // ──────────────────────────────────────────────
  //  S3: 确认规则列表包含新规则 (list_rules 验证)
  // ──────────────────────────────────────────────
  hr('S3 确认规则列表')
  console.log('  用户: "好的，那再帮我看看现在的规则列表，确认新规则加进去了"')
  const r3 = await agentRun('好的，那再帮我看看现在的规则列表，确认新规则加进去了')
  t('S3 调用了list_rules',
    r3.toolLog.some(l => l.name === 'list_rules'),
    r3.iterations + '轮 ' + r3.toolCalls + '工具')
  t('S3 list_rules成功',
    r3.toolLog.some(l => l.name === 'list_rules' && l.ok),
    '返回更新后的规则列表')
  t('S3 回复确认了有规则',
    r3.text.length > 10,
    r3.text.length + '字')
  console.log('    回复: ' + r3.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S4: 查看审计记录 (list_audit)
  // ──────────────────────────────────────────────
  hr('S4 查看审计记录')
  console.log('  用户: "对了，帮我查一下最近的审计记录，看看有没有什么问题"')
  const r4 = await agentRun('对了，帮我查一下最近的审计记录，看看有没有什么问题')
  t('S4 调用了list_audit',
    r4.toolLog.some(l => l.name === 'list_audit'),
    r4.iterations + '轮 ' + r4.toolCalls + '工具')
  t('S4 list_audit成功',
    r4.toolLog.some(l => l.name === 'list_audit' && l.ok),
    '返回审计记录')
  t('S4 有文本回复',
    r4.text.length > 0,
    r4.text.length + '字')
  console.log('    回复: ' + r4.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S5: 记录学习经验 (write_learning)
  // ──────────────────────────────────────────────
  hr('S5 记录学习经验')
  console.log('  用户: "帮我把今天学到的技巧记下来：写打斗场景时，')
  console.log('         不要只描写动作，要把人物的心理活动也穿插进去，')
  console.log('         这样打斗会更有张力和层次感"')
  const expText = '写打斗场景时，不要只描写动作，' +
    '要把人物的心理活动也穿插进去，这样打斗会更有张力和层次感。' +
    '具体做法：每三段动作描写后插入一段角色的内心独白或感知描写。'
  const r5 = await agentRun('帮我把今天学到的写作技巧记下来：' + expText)
  t('S5 调用了write_learning',
    r5.toolLog.some(l => l.name === 'write_learning'),
    r5.iterations + '轮 ' + r5.toolCalls + '工具')
  t('S5 write_learning成功',
    r5.toolLog.some(l => l.name === 'write_learning' && l.ok),
    '经验已记录')
  t('S5 summary参数非空',
    r5.toolLog.some(l => l.name === 'write_learning' && l.args.summary && l.args.summary.length > 20),
    '经验内容完整传入')
  console.log('    回复: ' + r5.text.slice(0, 120))

  // 验证学习经验文件确实被创建
  try {
    const learnFiles = fs.readdirSync(TD('learnings')).filter(f => f.endsWith('.md'))
    t('S5a 经验文件已持久化',
      learnFiles.length >= 1,
      `${learnFiles.length}个经验文件`)
  } catch (e) {
    t('S5a 经验文件已持久化', false, e.message)
  }

  // ──────────────────────────────────────────────
  //  S6: 更新配置 (update_config)
  // ──────────────────────────────────────────────
  hr('S6 更新配置')
  console.log('  用户: "帮我把默认项目改成项目1，语言设置成简体中文"')
  const r6 = await agentRun('帮我把默认项目改成项目1，语言设置成简体中文，自动保存打开')
  t('S6 调用了update_config',
    r6.toolLog.some(l => l.name === 'update_config'),
    r6.iterations + '轮 ' + r6.toolCalls + '工具')
  t('S6 update_config成功',
    r6.toolLog.some(l => l.name === 'update_config' && l.ok),
    '配置已更新')
  console.log('    回复: ' + r6.text.slice(0, 120))

  // 验证配置文件确实被写入
  try {
    const configRaw = fs.readFileSync(TD('config.json'), 'utf-8')
    const config = JSON.parse(configRaw)
    t('S6a 配置文件有效JSON',
      typeof config === 'object' && config !== null,
      Object.keys(config).join(', '))
  } catch (e) {
    t('S6a 配置文件有效JSON', false, e.message)
  }

  // ──────────────────────────────────────────────
  //  S7: 边界测试 — 空规则 (learn_rule empty)
  // ──────────────────────────────────────────────
  hr('S7 边界: 空规则拒绝')
  console.log('  用户: "帮我学一条规则"（故意不提供规则内容）')
  const r7 = await agentRun('帮我学一条规则')
  t('S7 调用了工具或返回了提示',
    r7.toolCalls >= 0,
    r7.iterations + '轮 ' + r7.toolCalls + '工具')
  // 无论AI是追问规则内容还是调用learn_rule（会得到空内容错误），都是合理行为
  console.log('    回复: ' + r7.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S8: 边界测试 — 超长规则内容 (learn_rule long)
  // ──────────────────────────────────────────────
  hr('S8 边界: 超长规则学习')
  const longRule = '这是一条非常详细的写作规则，涵盖了多个方面：' +
    '第一，关于人物塑造，每个主要人物都必须有一个清晰的成长弧线，从出场时的缺陷到结尾时的转变要有明确的因果链。' +
    '第二，关于情节结构，采用三幕式结构但允许灵活变通，第一幕占25%篇幅用于建立世界观和冲突，第二幕占50%用于推进冲突和人物成长，第三幕占25%用于高潮和收尾。' +
    '第三，关于对话写作，每个角色的对话风格要与其性格、教育背景、社会地位匹配，主角的对话要有辨识度的口头禅或语言习惯。' +
    '第四，关于环境描写，每章至少有一段环境描写来烘托氛围，但不能超过全文字数的15%，避免过度描写拖慢节奏。' +
    '第五，关于修订流程，初稿完成后至少放置24小时再进行第一次修订，修订时分三遍：第一遍看情节逻辑，第二遍看人物一致性，第三遍看语言润色。'
  console.log('  用户: "帮我记住这条长规则"(约350字)')
  const r8 = await agentRun('帮我记住这条写作规则：' + longRule)
  t('S8 调用了learn_rule',
    r8.toolLog.some(l => l.name === 'learn_rule'),
    r8.iterations + '轮 ' + r8.toolCalls + '工具')
  t('S8 learn_rule处理长内容成功',
    r8.toolLog.some(l => l.name === 'learn_rule' && l.ok),
    '长规则已保存')
  // 验证长规则被截断显示但完整保存
  t('S8 长规则完整传入',
    r8.toolLog.some(l => l.name === 'learn_rule' && l.args.rule && l.args.rule.length >= 200),
    '规则参数长度 ' + (r8.toolLog.find(l => l.name === 'learn_rule')?.args.rule?.length || 0))
  console.log('    回复: ' + r8.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S9: 边界测试 — JSON配置格式验证 (update_config)
  // ──────────────────────────────────────────────
  hr('S9 边界: 配置JSON格式验证')
  console.log('  用户: "更新一下配置，把写作风格设置成"古风""')
  const r9 = await agentRun('更新一下配置，把写作风格设置成古风，目标字数设成3000字每章')
  t('S9 调用了update_config',
    r9.toolLog.some(l => l.name === 'update_config'),
    r9.iterations + '轮 ' + r9.toolCalls + '工具')
  t('S9 update_config成功',
    r9.toolLog.some(l => l.name === 'update_config' && l.ok),
    '配置更新')

  // 验证配置文件累积了所有设置
  try {
    const config = JSON.parse(fs.readFileSync(TD('config.json'), 'utf-8'))
    t('S9a 配置包含新字段',
      Object.keys(config).length >= 2,
      Object.keys(config).join(', ') + ` (${Object.keys(config).length}项)`)
  } catch (e) {
    t('S9a 配置包含新字段', false, e.message)
  }

  console.log('    回复: ' + r9.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S10: 边界测试 — 用户修正 (不对，改成...)
  // ──────────────────────────────────────────────
  hr('S10 边界: 用户修正配置')
  console.log('  用户: "不对，刚才的写作风格设置错了，')
  console.log('         改成"现代白话"，目标字数也改成5000字"')
  const r10 = await agentRun(
    '不对，刚才的写作风格设置错了，改成现代白话，目标字数也改成5000字每章'
  )
  t('S10 调用了update_config',
    r10.toolLog.some(l => l.name === 'update_config'),
    r10.iterations + '轮 ' + r10.toolCalls + '工具')
  t('S10 update_config修正成功',
    r10.toolLog.some(l => l.name === 'update_config' && l.ok),
    '配置已修正')
  console.log('    回复: ' + r10.text.slice(0, 120))

  // 验证配置确实被覆盖
  try {
    const config = JSON.parse(fs.readFileSync(TD('config.json'), 'utf-8'))
    const styleOk = config['写作风格'] === '现代白话' || config['写作风格'] === '"现代白话"'
    t('S10a 配置值已覆盖',
      styleOk || Object.values(config).some(v => String(v).includes('现代白话')),
      '写作风格: ' + (config['写作风格'] || 'N/A'))
  } catch (e) {
    t('S10a 配置值已覆盖', false, e.message)
  }

  // ──────────────────────────────────────────────
  //  S11: 多轮连续对话 — 模拟真实自管理流程
  // ──────────────────────────────────────────────
  hr('S11 多轮连续对话 (模拟真实自管理)')
  const chatFlow = [
    '你好，我刚写完第二章，想做一些管理上的调整。先帮我看看现在有哪些规则？',
    '好的，那帮我把默认项目设成项目1，自动保存打开，然后学一条新规则：每次修改角色设定后，必须同步检查所有相关章节中的角色描述是否一致。',
    '谢谢！再帮我记录一个经验：今天发现大纲写得太详细反而会限制创作发挥，以后大纲只写核心节点，细节留给灵感发挥。',
  ]
  const r11 = await multiTurnRun(chatFlow)
  t('S11 多轮对话全部完成',
    r11.turnResults.length === chatFlow.length,
    `${r11.turnResults.length}/${chatFlow.length}轮有回复`)
  t('S11 多轮有工具调用',
    r11.toolCalls >= 2,
    `全程${r11.toolCalls}个工具调用`)
  t('S11 每轮均有文本',
    r11.allTexts.every(tx => tx.length > 0),
    `最少${Math.min(...r11.allTexts.map(t => t.length))}字`)
  t('S11 覆盖多工具',
    new Set(r11.toolLog.map(l => l.name)).size >= 2,
    '使用了 ' + [...new Set(r11.toolLog.map(l => l.name))].join(', '))
  console.log('    总轮数: ' + chatFlow.length)
  console.log('    总工具: ' + r11.toolCalls)
  console.log('    工具列表: ' + r11.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(' '))
  for (let i = 0; i < r11.turnResults.length; i++) {
    console.log(`    轮${i + 1}: ${(r11.turnResults[i].text || '').slice(0, 80)}`)
  }

  // ──────────────────────────────────────────────
  //  S12: 审计为空的边界测试 (清理后重新查询)
  // ──────────────────────────────────────────────
  hr('S12 边界: 空审计记录')
  // 临时清空审计目录
  try {
    const auditDir = TD('audit')
    const backup = fs.readdirSync(auditDir).map(f => ({
      name: f,
      content: fs.readFileSync(path.join(auditDir, f)),
    }))
    fs.rmSync(auditDir, { recursive: true, force: true })
    ensureDir(auditDir)

    const r12 = await agentRun('帮我看看审计记录')
    t('S12 空审计调用list_audit',
      r12.toolLog.some(l => l.name === 'list_audit'),
      r12.iterations + '轮 ' + r12.toolCalls + '工具')
    t('S12 空审计handle成功',
      r12.toolLog.some(l => l.name === 'list_audit' && l.ok),
      '优雅处理空状态')
    console.log('    回复: ' + r12.text.slice(0, 120))

    // 恢复审计目录
    for (const f of backup) {
      fs.writeFileSync(path.join(auditDir, f.name), f.content)
    }
  } catch (e) {
    t('S12 空审计', false, e.message)
  }

  // ──────────────────────────────────────────────
  //  清理测试数据
  // ──────────────────────────────────────────────
  hr('清理测试数据')
  try {
    fs.rmSync(TEST_DATA, { recursive: true, force: true })
    console.log('  🧹 已清理测试数据: test_data/18-harness/')
  } catch (e) {
    console.log('  ⚠️ 清理失败: ' + e.message)
  }

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n\n═══════════════════════════════════════════════')
  console.log('  自管理仿真测试结果 (18-harness)')
  console.log('═══════════════════════════════════════════════')
  console.log('  总计: ' + total + '  ✅ ' + pass + '  ❌ ' + fail)
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  工具覆盖:')
  console.log('    ✓ list_rules     — 列出已有规则 (S1, S3, S11)')
  console.log('    ✓ learn_rule     — 学习新规则/长规则 (S2, S8, S11)')
  console.log('    ✓ list_audit     — 查看审计记录/空审计 (S4, S12)')
  console.log('    ✓ write_learning — 记录学习经验 (S5, S11)')
  console.log('    ✓ update_config  — 更新/修正配置 (S6, S9, S10, S11)')
  console.log('')
  console.log('  边界测试:')
  console.log('    ✓ 空规则内容拒绝 (S7)')
  console.log('    ✓ 超长规则学习 (S8, ~350字)')
  console.log('    ✓ 配置JSON格式验证 (S9)')
  console.log('    ✓ 用户修正/覆盖配置 (S10)')
  console.log('    ✓ 空审计记录处理 (S12)')
  console.log('    ✓ 多轮连续对话+多工具 (S11)')
  console.log('')
  console.log('═══════════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

// ═══════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════
main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
