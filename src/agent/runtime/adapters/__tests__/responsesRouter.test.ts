// ── v15.5: shouldUseResponses 路由判定单测（两路：DeepSeek V4 原生联网 / OpenCode Go responses 模型） ──

import { describe, it, expect } from 'vitest'
import { shouldUseResponses } from '../responsesRouter'

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
