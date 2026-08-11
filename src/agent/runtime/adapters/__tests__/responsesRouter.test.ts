// ── v15.5: shouldUseResponses 路由判定单测（两路：DeepSeek V4 原生联网 / OpenCode Go responses 模型）
// ── v16.3.0: + resolveNativeEnabled 会话级覆盖判定（三态循环不改模型配置） ──

import { describe, it, expect } from 'vitest'
import { shouldUseResponses, resolveNativeEnabled } from '../responsesRouter'

describe('shouldUseResponses', () => {
  it('DeepSeek V4 + 原生联网 + OpenAI 协议 → Responses', () => {
    expect(shouldUseResponses({
      protocol: 'openai',
      nativeWebSearch: true,
      model: 'deepseek-v4-flash',
      apiUrl: 'https://api.deepseek.com',
    })).toBe(true)
  })

  it('DeepSeek V4 + 原生联网 + Anthropic 协议 → 不走 Responses（走 anthropic 端点）', () => {
    expect(shouldUseResponses({
      protocol: 'anthropic',
      nativeWebSearch: true,
      model: 'deepseek-v4-flash',
      apiUrl: 'https://api.deepseek.com',
    })).toBe(false)
  })

  it('DeepSeek V4 未勾选原生联网 → 不走 Responses', () => {
    expect(shouldUseResponses({
      protocol: 'openai',
      nativeWebSearch: false,
      model: 'deepseek-v4-flash',
    })).toBe(false)
  })

  it('非 deepseek 模型（GLM 等）即使勾选原生联网 → 不走 Responses（走 DDG）', () => {
    expect(shouldUseResponses({
      protocol: 'openai',
      nativeWebSearch: true,
      model: 'glm-5.2',
      apiUrl: 'https://api.deepseek.com',
    })).toBe(false)
  })

  it('OpenCode Go + gpt-5.6-luna → 走 Responses（官方 /zen/go/v1/responses 端点）', () => {
    expect(shouldUseResponses({
      protocol: 'openai',
      nativeWebSearch: false,
      model: 'gpt-5.6-luna',
      apiUrl: 'https://opencode.ai/zen/go/v1',
    })).toBe(true)
  })

  it('OpenCode Go + 非 responses 模型（deepseek-v4-flash 走 chat/completions）→ 不走 Responses', () => {
    expect(shouldUseResponses({
      protocol: 'openai',
      nativeWebSearch: false,
      model: 'deepseek-v4-flash',
      apiUrl: 'https://opencode.ai/zen/go/v1',
    })).toBe(false)
  })

  it('OpenCode Go + 未勾选原生联网 + qwen3.7-max（Anthropic 端点模型）→ 不走 Responses', () => {
    expect(shouldUseResponses({
      protocol: 'openai',
      nativeWebSearch: false,
      model: 'qwen3.7-max',
      apiUrl: 'https://opencode.ai/zen/go/v1',
    })).toBe(false)
  })

  it('OpenCode Go + gpt-5.6-luna + Anthropic 协议 → 不走 Responses', () => {
    expect(shouldUseResponses({
      protocol: 'anthropic',
      nativeWebSearch: false,
      model: 'gpt-5.6-luna',
      apiUrl: 'https://opencode.ai/zen/go/v1',
    })).toBe(false)
  })

  it('null / undefined 配置 → false', () => {
    expect(shouldUseResponses(null)).toBe(false)
    expect(shouldUseResponses(undefined)).toBe(false)
  })
})

// ── v16.3.0: resolveNativeEnabled（联网会话级三态覆盖——聊天窗切换不改模型配置勾选） ──
describe('resolveNativeEnabled', () => {
  const cfg = { protocol: 'openai', nativeWebSearch: true, model: 'deepseek-v4-flash', apiUrl: 'https://api.deepseek.com' }

  it('无覆盖（null/undefined）→ 跟随配置勾选', () => {
    expect(resolveNativeEnabled(cfg, null)).toBe(true)
    expect(resolveNativeEnabled(cfg, undefined)).toBe(true)
    expect(resolveNativeEnabled(cfg)).toBe(true)
  })

  it("覆盖 'builtin' / 'off' → 原生临时关闭（配置勾选不动）", () => {
    expect(resolveNativeEnabled(cfg, 'builtin')).toBe(false)
    expect(resolveNativeEnabled(cfg, 'off')).toBe(false)
  })

  it('配置未勾选 + 无覆盖 → false', () => {
    expect(resolveNativeEnabled({ ...cfg, nativeWebSearch: false }, null)).toBe(false)
  })

  it('null 配置 → false（不抛错）', () => {
    expect(resolveNativeEnabled(null, null)).toBe(false)
    expect(resolveNativeEnabled(undefined, 'builtin')).toBe(false)
  })
})
