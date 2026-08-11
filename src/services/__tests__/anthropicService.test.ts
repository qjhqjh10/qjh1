// H7: chatAnthropicStream/chatStream 错误透传与监听器清理验证
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { anthropicService } from '../anthropicService'

function setupElectronMock(chatResult: Promise<string> | (() => Promise<string>)) {
  const unsubSpy = vi.fn()
  const api = {
    ai: {
      onAnthropicChunk: vi.fn(() => unsubSpy),
      chatAnthropicStream: typeof chatResult === 'function' ? chatResult : vi.fn(() => chatResult),
      abortAnthropicStream: vi.fn(),
    },
  }
  ;(window as any).electron = api
  return { api, unsubSpy }
}

const wait = () => new Promise(r => setTimeout(r, 0))

describe('chatStream (H7)', () => {
  beforeEach(() => {
    delete (window as any).electron
  })

  it('主进程返回 stopReason:"error" + error 字段 → onError 被调、onDone 不调', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '', toolUses: [], stopReason: 'error', error: '[AUTH_ERROR] API 密钥无效',
    })))
    const onDone = vi.fn()
    const onError = vi.fn()

    anthropicService.chatStream({ messages: [{ role: 'user', content: 'hi' }], configId: 'c1' },
      () => {}, onDone, onError)

    await wait()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].message).toContain('API 密钥无效')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('IPC 调用抛异常 → onError 带错误消息', async () => {
    const { api } = setupElectronMock(Promise.reject(new Error('bridge crashed')))
    const onDone = vi.fn()
    const onError = vi.fn()

    anthropicService.chatStream({ messages: [{ role: 'user', content: 'hi' }], configId: 'c1' },
      () => {}, onDone, onError)

    await wait()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].message).toContain('bridge crashed')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('失败路径清理 chunk 监听器（unsubChunk 在 finally 调用）', async () => {
    const { unsubSpy } = setupElectronMock(Promise.reject(new Error('fail')))
    anthropicService.chatStream({ messages: [{ role: 'user', content: 'hi' }], configId: 'c1' },
      () => {}, () => {}, () => {})
    await wait()
    expect(unsubSpy).toHaveBeenCalledOnce()
  })

  it('正常结果 → onDone 被调、onError 不调', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '你好', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 3, cost: 0.01 },
    })))
    const onDone = vi.fn()
    const onError = vi.fn()

    anthropicService.chatStream({ messages: [{ role: 'user', content: 'hi' }], configId: 'c1' },
      () => {}, onDone, onError)

    await wait()
    expect(onDone).toHaveBeenCalledOnce()
    expect(onDone.mock.calls[0][0].text).toBe('你好')
    expect(onDone.mock.calls[0][0].usage?.cost).toBe(0.01)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('chatAnthropicStream (H7)', () => {
  beforeEach(() => {
    delete (window as any).electron
  })

  it('返回结果透传 error 字段（不再吞掉）', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '', toolUses: [], stopReason: 'error', error: 'boom',
    })))
    const result = await anthropicService.chatAnthropicStream({
      system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], configId: 'c1',
    })
    expect(result.stopReason).toBe('error')
    expect(result.error).toBe('boom')
  })

  it('v14.5.0 透传 thinkingBlocks（多轮工具调用推理回传；原实现丢弃）', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '分析中', toolUses: [], stopReason: 'tool_use',
      thinkingBlocks: [{ thinking: '推理过程', signature: 'sig123' }],
    })))
    const result = await anthropicService.chatAnthropicStream({
      system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], configId: 'c1',
    })
    expect(result.thinkingBlocks).toBeDefined()
    expect(result.thinkingBlocks![0]).toMatchObject({ thinking: '推理过程', signature: 'sig123' })
  })

  it('v14.5.0 无 thinkingBlocks 时返回 undefined（不引入空数组）', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: 'ok', toolUses: [], stopReason: 'end_turn',
    })))
    const result = await anthropicService.chatAnthropicStream({
      system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], configId: 'c1',
    })
    expect(result.thinkingBlocks).toBeUndefined()
  })

  it('本地 catch 路径携带错误消息', async () => {
    setupElectronMock(Promise.reject(new Error('local error')))
    const result = await anthropicService.chatAnthropicStream({
      system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], configId: 'c1',
    })
    expect(result.stopReason).toBe('error')
    expect(result.error).toContain('local error')
  })
})

// ── v16.3.1 审计 F3: pipeline usage total_tokens 补 cache_read/cache_creation（互斥语义） ──

describe('chatWithUsage usage total_tokens (F3)', () => {
  beforeEach(() => {
    delete (window as any).electron
  })

  it('total_tokens = input + output + cache_read + cache_creation（Anthropic 互斥语义）', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '生成结果',
      toolUses: [], stopReason: 'end_turn', error: null,
      usage: {
        input_tokens: 1000, output_tokens: 500,
        cache_creation_input_tokens: 300, cache_read_input_tokens: 7000,
        cost: 0.012,
      },
    })))
    const result = await anthropicService.chatWithUsage({
      messages: [{ role: 'user', content: 'hi' }], configId: 'c1',
    })
    expect(result.usage).toBeDefined()
    expect(result.usage?.prompt_tokens).toBe(1000)
    expect(result.usage?.completion_tokens).toBe(500)
    // 原实现 total = 1000+500=1500（漏 7300 缓存 token → 系统性低估 60-90%）
    expect(result.usage?.total_tokens).toBe(1000 + 500 + 300 + 7000)
    expect(result.usage?.cacheHitTokens).toBe(7000)
    expect(result.usage?.cost).toBe(0.012)
  })

  it('无缓存字段时 total_tokens 行为不变（不引入 NaN）', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: 'x', toolUses: [], stopReason: 'end_turn', error: null,
      usage: { input_tokens: 10, output_tokens: 5, cost: 0.001 },
    })))
    const result = await anthropicService.chatWithUsage({
      messages: [{ role: 'user', content: 'hi' }], configId: 'c1',
    })
    expect(result.usage?.total_tokens).toBe(15)
  })
})

// ── v16.3.1 审查修复 R1: aborted 走 onError（防取消时清空章节文件） ──

describe('chatStream aborted 语义 (R1)', () => {
  beforeEach(() => {
    delete (window as any).electron
  })

  it('主进程返回 stopReason:"aborted"（无 error 字段）→ onError("已停止")、onDone 不调', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '', toolUses: [], stopReason: 'aborted',
    })))
    const onDone = vi.fn()
    const onError = vi.fn()

    anthropicService.chatStream({ messages: [{ role: 'user', content: 'hi' }], configId: 'c1' },
      () => {}, onDone, onError)

    await wait()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].message).toContain('已停止')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('chatWithUsage 收到 aborted → 抛错（非流式防御，防调用方写空文件）', async () => {
    const { api } = setupElectronMock(Promise.resolve(JSON.stringify({
      text: '', toolUses: [], stopReason: 'aborted',
    })))
    await expect(anthropicService.chatWithUsage({
      messages: [{ role: 'user', content: 'hi' }], configId: 'c1',
    })).rejects.toThrow('已停止')
  })
})
