/**
 * 完整测试：上传 TXT → analyze_text_style → create_file
 * 验证风格模板生成全链路
 */
import { toolRegistry } from '../src/agent/skills/ToolRegistry.js'
import { ALL_TOOLS } from '../src/agent/skills/tools/index.js'
import { V4UnifiedRuntime } from '../src/agent/runtime/V4UnifiedRuntime.js'
import { OpenAIAdapter } from '../src/agent/runtime/adapters/OpenAIAdapter.js'

// ── 1. 工具注册 ──
toolRegistry.registerAll(ALL_TOOLS)
const toolCount = toolRegistry.count()
const hasAnalyze = toolRegistry.has('analyze_text_style')
const hasCreateStyle = toolRegistry.has('create_style_template')
const hasCreateScene = toolRegistry.has('create_scene_template')

console.log('=== 工具检查 ===')
console.log(`工具总数: ${toolCount}`)
console.log(`analyze_text_style: ${hasAnalyze ? '✅' : '❌'}`)
console.log(`create_style_template: ${hasCreateStyle ? '❌ 未删除' : '✅ 已删除'}`)
console.log(`create_scene_template: ${hasCreateScene ? '❌ 未删除' : '✅ 已删除'}`)

// ── 2. 检查 analyze_text_style 参数 ──
const tool = toolRegistry.get('analyze_text_style')
console.log('\n=== analyze_text_style 参数 ===')
console.log(`必填: ${tool?.schema.parameters.required?.join(', ')}`)
console.log(`参数: ${Object.keys(tool?.schema.parameters.properties || {}).join(', ')}`)
const dimsDesc = tool?.schema.parameters.properties.dimensions?.description || ''
console.log(`dimensions限制: ${dimsDesc.includes('≤') || dimsDesc.includes('不超过') ? '❌ 有数量限制' : '✅ 无限制'}`)

// ── 3. 模拟完整流程 ──
const MOCK_TEXT = `林雨晴站在画展的入口处，深吸了一口气。展厅里人不多，偶尔有低语声从远处传来。

那是一幅描绘暴风雨中孤舟的作品，笔触凌厉而克制。她站在画前，久久没有移动。

"你喜欢这幅画？"一个温和的声音从身后传来。

她回头，看见一个戴着金丝眼镜的男人正微笑看着她。那笑容很淡，稍纵即逝。

"画得不错。"她说，声音很轻。

"确实。"男人点点头，"每一笔都恰到好处。不多，不少。"

她看着那幅画，忽然觉得有什么东西在心里松动了。像是长久以来紧绷的弦，被谁轻轻拨了一下。`

const callLog = []
const toolResults = []

const mockAI = {
  chatWithTools: async (messages, _cid, _pid, tools) => {
    callLog.push({ msgCount: messages.length, toolCount: tools?.length || 0 })
    const lastMsg = messages.filter(m => m.role === 'user').pop()?.content || ''

    // 第1轮: read_file
    if (callLog.length === 1) {
      console.log('\n=== 模拟第1轮: read_file ===')
      return {
        text: '让我读取原文。',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: JSON.stringify({ file_path: '../../uploads/files/测试.txt' }) }],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 5000, completion_tokens: 30, total_tokens: 5030 },
      }
    }

    // 第2轮: analyze_text_style
    if (callLog.length === 2) {
      console.log('=== 模拟第2轮: analyze_text_style ===')
      return {
        text: '',
        toolCalls: [{
          id: 'c2', name: 'analyze_text_style',
          arguments: JSON.stringify({
            content: MOCK_TEXT,
            dimensions: ['narrativeTone','sentenceStyle','vocabularyStyle','rhythmStyle','moodStyle'],
          }),
        }],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 8000, completion_tokens: 200, total_tokens: 8200 },
      }
    }

    // 第3轮: create_file 保存模板
    if (callLog.length === 3) {
      console.log('=== 模拟第3轮: create_file ===')
      const dims = JSON.parse(toolResults.find(r => r.name === 'analyze_text_style')?.result?.detail || '{}')
      const yaml = `id: st_test\nname: 测试画展文风\ntype: 都市小说\ndimensions:\n${JSON.stringify(dims, null, 2)}`
      return {
        text: '',
        toolCalls: [{
          id: 'c3', name: 'create_file',
          arguments: JSON.stringify({ file_path: '../../style_templates/测试画展文风.yaml', content: yaml }),
        }],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 10000, completion_tokens: 100, total_tokens: 10100 },
      }
    }

    // 第4轮: 完成
    console.log('=== 模拟第4轮: 完成 ===')
    return {
      text: '已创建风格模板"测试画展文风"。',
      toolCalls: null,
      finishReason: 'stop',
      usage: { prompt_tokens: 11000, completion_tokens: 30, total_tokens: 11030 },
    }
  },
  abortStream: () => {},
}

const mockExecutor = async (args, ctx) => {
  if (ctx.toolName === 'read_file') {
    console.log(`  read_file: ${args.file_path}`)
    toolResults.push({ name: 'read_file', path: args.file_path })
    return { status: 'success', summary: `${MOCK_TEXT.length} 字符`, detail: MOCK_TEXT }
  }

  if (ctx.toolName === 'analyze_text_style') {
    console.log(`  analyze_text_style: ${args.dimensions?.length || 0} 维`)
    // 测试真正执行 analyze_text_style 的 executor
    try {
      const t = toolRegistry.get('analyze_text_style')
      if (!t) return { status: 'error', summary: '工具未注册' }
      const result = await t.executor(args, {
        projectId: 'test', configId: 'test', callId: ctx.callId || 'test',
        toolName: 'analyze_text_style', signal: new AbortController().signal,
      })
      toolResults.push({ name: 'analyze_text_style', result })
      console.log(`  结果: ${result.status} - ${result.summary}`)
      return result
    } catch (e) {
      // Expected: aiService not available in test env
      console.log(`  ⚠️ 无法调用真实AI: ${e.message?.slice(0, 60)}`)
      // 返回模拟的成功结果
      const mockDims = {
        narrativeTone: { description: '叙事含蓄克制', examples: ['例句1','例句2','例句3'], writingRules: ['规则1','规则2','规则3'], vocabularyList: ['词1','词2','词3','词4','词5','词6','词7','词8','词9','词10'] },
        sentenceStyle: { description: '中短句为主', examples: ['例句1','例句2','例句3'], writingRules: ['规则1','规则2','规则3'], vocabularyList: ['词1','词2','词3','词4','词5','词6','词7','词8','词9','词10'] },
      }
      return { status: 'success', summary: '2维(模拟)', detail: JSON.stringify(mockDims) }
    }
  }

  if (ctx.toolName === 'create_file') {
    console.log(`  create_file: ${args.file_path}`)
    toolResults.push({ name: 'create_file', path: args.file_path })
    return { status: 'success', summary: `已创建 (${(args.content || '').length} 字符)` }
  }

  return { status: 'success', summary: `${ctx.toolName} 完成` }
}

// ── 4. 运行 Runtime ──
console.log('\n=== 开始完整流程模拟 ===')
const adapter = new OpenAIAdapter(mockAI)
const runtime = new V4UnifiedRuntime({
  configId: 'test', projectId: 'test-project', maxIterations: 6,
  abortSignal: new AbortController().signal, contextWindow: 128000,
}, adapter)
runtime.setToolExecutor(mockExecutor)
runtime.setTools(toolRegistry.getAllSchemas())

const result = await runtime.run({
  userMessage: '[上传文件: 测试.txt]\n分析生成风格模板',
  attachments: [],
})

// ── 5. 结果检查 ──
console.log('\n=== 结果 ===')
console.log(`成功: ${result.success}`)
console.log(`工具调用: ${result.toolCalls} 次`)
console.log(`使用工具: ${result.toolsUsed.join(' → ')}`)
console.log(`迭代: ${result.iterationCount} 轮`)
console.log(`结束文本: ${result.text?.slice(0, 80)}`)

const checks = [
  ['工具总数=33', toolCount === 33, toolCount],
  ['analyze_text_style注册', hasAnalyze],
  ['create_style_template已删除', !hasCreateStyle],
  ['create_scene_template已删除', !hasCreateScene],
  ['read_file调用', toolResults.some(r => r.name === 'read_file')],
  ['analyze_text_style调用', toolResults.some(r => r.name === 'analyze_text_style')],
  ['create_file调用', toolResults.some(r => r.name === 'create_file')],
  ['运行成功', result.success],
  ['流程完整', result.toolsUsed.includes('analyze_text_style')],
]

console.log('\n=== 检查清单 ===')
let allOk = true
for (const [name, ok, detail] of checks) {
  const mark = ok ? '✅' : '❌'
  console.log(`  ${mark} ${name}${detail !== undefined && !ok ? ` (实际: ${detail})` : ''}`)
  if (!ok) allOk = false
}

console.log(allOk ? '\n🎉 全部通过' : '\n⚠️ 存在问题')
process.exit(allOk ? 0 : 1)
