// ── responsesConverter 纯函数单测（v14.8） ──
// 覆盖：消息→items 转换、孤儿 tool 裁剪、web_search 注入、cache_control 剥离、function_call 收集。

import { describe, it, expect } from 'vitest'
import { convertMessages, convertTools, collectFunctionCalls } from '../responsesConverter'
import type { ConverterMessage } from '../responsesConverter'

describe('convertMessages', () => {
  it('system/user → message items（input_text）', () => {
    const items = convertMessages([
      { role: 'system', content: '你是写作助手' },
      { role: 'user', content: '帮我写一段' },
    ] as ConverterMessage[])
    expect(items).toEqual([
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: '你是写作助手' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '帮我写一段' }] },
    ])
  })

  it('assistant 纯文本 → message item', () => {
    const items = convertMessages([
      { role: 'assistant', content: '好的，这是初稿。' },
    ] as ConverterMessage[])
    expect(items[0]).toMatchObject({ type: 'message', role: 'assistant' })
    expect((items[0].content as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'output_text', text: '好的，这是初稿。' })
  })

  it('assistant 带 tool_calls → message + function_call items（call_id = 原 tool_call id）', () => {
    const items = convertMessages([
      {
        role: 'assistant',
        content: '先看看目录',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_directory', arguments: '{"dir_path":""}' } }],
      } as unknown as ConverterMessage,
    ])
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ type: 'function_call', call_id: 'call_1', name: 'list_directory', arguments: '{"dir_path":""}' })
  })

  it('tool 消息 → function_call_output；孤儿 tool（无对应 function_call）丢弃', () => {
    const items = convertMessages([
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] } as unknown as ConverterMessage,
      { role: 'tool', tool_call_id: 'call_1', content: '{"status":"success"}' },
      { role: 'tool', tool_call_id: 'orphan_9', content: '{"status":"error"}' },
    ] as ConverterMessage[])
    expect(items).toHaveLength(2)  // function_call + function_call_output；孤儿被丢
    expect(items[1]).toMatchObject({ type: 'function_call_output', call_id: 'call_1', output: '{"status":"success"}' })
  })

  it('历史 reasoning 不回传（每轮重新生成）', () => {
    const items = convertMessages([
      { role: 'assistant', content: '（推理省略）' },
    ] as ConverterMessage[])
    expect(items.some(i => i.type === 'reasoning')).toBe(false)
  })
})

describe('convertTools', () => {
  it('function 工具转换并剥离 cache_control', () => {
    const tools = [
      { type: 'function', function: { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: {} } }, cache_control: { type: 'ephemeral' } },
    ]
    const out = convertTools(tools, false)
    expect(out).toEqual([
      { type: 'function', name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: {} } },
    ])
    expect((out[0] as Record<string, unknown>).cache_control).toBeUndefined()
  })

  it('nativeWebSearch 时追加 web_search 工具', () => {
    const out = convertTools([], true)
    expect(out).toEqual([{ type: 'web_search', search_context_size: 'high' }])
  })

  it('空 tools 且不开原生搜索 → 空数组', () => {
    expect(convertTools([], false)).toEqual([])
  })

  it('跳过无效条目（无 name）', () => {
    const out = convertTools([{ type: 'function', function: {} }], false)
    expect(out).toEqual([])
  })
})

describe('collectFunctionCalls', () => {
  it('只收集 function_call items，取 call_id/name/arguments', () => {
    const calls = collectFunctionCalls([
      { type: 'reasoning', summary: [] },
      { type: 'function_call', call_id: 'c1', name: 'kb_search', arguments: '{"query":"x"}' },
      { type: 'message', role: 'assistant', content: [] },
      { type: 'web_search_call', call_id: 'w1' },
    ] as unknown as Array<import('../responsesConverter').ResponseItem>)
    expect(calls).toEqual([{ id: 'c1', name: 'kb_search', arguments: '{"query":"x"}' }])
  })
})
