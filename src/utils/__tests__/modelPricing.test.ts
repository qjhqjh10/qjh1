// v15.2.1: 模型价格参考表测试——内置价匹配（精确/前缀/大小写）+ OpenRouter 实时价解析/匹配
import { describe, it, expect } from 'vitest'
import { lookupModelPrice, parseOpenRouterModels, matchLiveModel, MODEL_PRICE_PRESETS } from '../modelPricing'

describe('lookupModelPrice（内置参考价匹配）', () => {
  it('DeepSeek V4-Flash 命中正确映射：输入 1 / 输出 2 / 缓存命中 0.02（CNY）', () => {
    const p = lookupModelPrice('deepseek-v4-flash')
    expect(p?.currency).toBe('CNY')
    expect(p?.input).toBe(1)
    expect(p?.output).toBe(2)
    expect(p?.cacheHit).toBe(0.02)
    expect(p?.contextWindow).toBe(1000000)
  })

  it('大小写/首尾空白归一化', () => {
    const p = lookupModelPrice('  DeepSeek-V4-Pro  ')
    expect(p?.input).toBe(3)
    expect(p?.output).toBe(6)
    expect(p?.cacheHit).toBe(0.025)
  })

  it('前缀匹配：claude-sonnet-4-20250514 → 4.x 标准价 3/15/0.3', () => {
    const p = lookupModelPrice('claude-sonnet-4-20250514')
    expect(p?.input).toBe(3)
    expect(p?.output).toBe(15)
    expect(p?.cacheHit).toBe(0.3)
  })

  it('claude-sonnet-5 命中更精确的促销价条目（2/10）而非通用 claude-sonnet（3/15）', () => {
    const p = lookupModelPrice('claude-sonnet-5')
    expect(p?.input).toBe(2)
    expect(p?.output).toBe(10)
  })

  it('最长前缀优先：gpt-4.1-mini 不误命中 gpt-4.1 / gpt-4o', () => {
    const p = lookupModelPrice('gpt-4.1-mini')
    expect(p?.input).toBe(0.4)
    expect(p?.output).toBe(1.6)
    const p2 = lookupModelPrice('gpt-4o-mini')
    expect(p2?.input).toBe(0.15)
    expect(p2?.output).toBe(0.6)
  })

  it('deepseek 未知名变体回退到通用 deepseek 条目（v4-flash 价）', () => {
    const p = lookupModelPrice('deepseek-v3.5-x')
    expect(p?.input).toBe(1)
    expect(p?.output).toBe(2)
  })

  it('未收录/空模型返回 undefined', () => {
    expect(lookupModelPrice('unknown-model-xyz')).toBeUndefined()
    expect(lookupModelPrice('')).toBeUndefined()
    expect(lookupModelPrice('  ')).toBeUndefined()
  })

  it('内置表覆盖主流厂商（OpenAI/Anthropic/Gemini/智谱/千问/Kimi）', () => {
    expect(MODEL_PRICE_PRESETS.length).toBeGreaterThanOrEqual(25)
    expect(lookupModelPrice('gpt-4.1')).toBeDefined()
    expect(lookupModelPrice('claude-opus-5')).toBeDefined()
    expect(lookupModelPrice('gemini-2.5-flash')).toBeDefined()
    expect(lookupModelPrice('glm-4-plus')).toBeDefined()
    expect(lookupModelPrice('qwen3-max')).toBeDefined()
    expect(lookupModelPrice('kimi-k2.6')).toBeDefined()
  })
})

describe('parseOpenRouterModels（实时价解析）', () => {
  it('标准条目：每 token 美元价 ×1e6 转每百万，缓存命中优先 input_cache_read', () => {
    const json = {
      data: [
        { id: 'deepseek/deepseek-chat', pricing: { prompt: 0.0000003, completion: 0.00000088, request: 0 }, context_length: 128000 },
        { id: 'openai/gpt-4o', pricing: { prompt: 0.0000025, completion: 0.00001, input_cache_read: 0.00000025 }, context_length: 128000 },
      ],
    }
    const map = parseOpenRouterModels(json)
    expect(map['deepseek/deepseek-chat'].input).toBe(0.3)
    expect(map['deepseek/deepseek-chat'].output).toBe(0.88)
    expect(map['deepseek/deepseek-chat'].contextWindow).toBe(128000)
    // 无 input_cache_read 时按输入 10% 估算
    expect(map['deepseek/deepseek-chat'].cacheHit).toBeCloseTo(0.03, 10)
    // 有 input_cache_read 用官方值（0.25/M），不受 10% 估算影响
    expect(map['openai/gpt-4o'].cacheHit).toBeCloseTo(0.25, 10)
    expect(map['openai/gpt-4o'].currency).toBe('USD')
  })

  it('缺 pricing/缺 id 的条目跳过；非数组响应返回空表', () => {
    const map = parseOpenRouterModels({ data: [{ id: 'x' }, { id: 'y', pricing: {} }, null, 42] })
    expect(Object.keys(map)).toHaveLength(0)
    expect(parseOpenRouterModels(null)).toEqual({})
    expect(parseOpenRouterModels({ data: 'not-array' })).toEqual({})
  })

  it('字符串价格也可解析', () => {
    const map = parseOpenRouterModels({ data: [{ id: 'a/b', pricing: { prompt: '0.000001', completion: '0.000004' } }] })
    expect(map['a/b'].input).toBe(1)
    expect(map['a/b'].output).toBe(4)
  })
})

describe('matchLiveModel（联网结果匹配）', () => {
  const map = parseOpenRouterModels({
    data: [
      { id: 'openai/gpt-4o', pricing: { prompt: 0.0000025, completion: 0.00001 } },
      { id: 'deepseek/deepseek-chat', pricing: { prompt: 0.0000003, completion: 0.00000088 } },
      { id: 'google/gemini-2.5-flash', pricing: { prompt: 0.0000003, completion: 0.0000025 } },
    ],
  })

  it('完整 OpenRouter id 精确匹配', () => {
    expect(matchLiveModel(map, 'openai/gpt-4o')?.input).toBe(2.5)
  })

  it('仅模型名（无服务商前缀）也能匹配', () => {
    expect(matchLiveModel(map, 'deepseek-chat')?.output).toBe(0.88)
    expect(matchLiveModel(map, 'gpt-4o')?.input).toBe(2.5)
  })

  it('未收录模型返回 undefined', () => {
    expect(matchLiveModel(map, 'foo/bar-unknown')).toBeUndefined()
    expect(matchLiveModel(map, '')).toBeUndefined()
  })
})
