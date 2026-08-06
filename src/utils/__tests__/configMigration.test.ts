// v15.1: 默认模型配置迁移测试——字段级迁移，仅更新仍等于旧默认值的字段
// v15.2.1: 定价默认值改为 1/2/0.02，并新增"v15.1 错位价格三元组修正"用例
import { describe, it, expect } from 'vitest'
import { migrateDefaultConfigs } from '../configMigration'

const OLD_TEMPLATE = {
  id: 'c1',
  name: '默认模板',
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  temperature: 1.0,
  maxTokens: 0,
  contextWindow: 1000000,
  protocol: 'openai' as const,
  enableThinking: true,
  reasoningEffort: 'max' as const,
  toolTemperature: 0.5,
  nativeWebSearch: false,
  inputPricePerM: 2.50,
  outputPricePerM: 10.00,
  cacheHitPricePerM: 1.25,
  imageModel: '',
  imageProvider: '',
  imageApiUrl: '',
  imageApiKey: '',
  imageInputPricePerM: 0,
  imageOutputPricePerM: 0,
  embeddingModel: 'text-embedding-3-small',
  currency: 'USD' as const,
}

describe('migrateDefaultConfigs (v15.1)', () => {
  it('旧默认模板整体迁移为新默认（anthropic/原生联网/CNY/1-2-0.02/DeepSeek）', () => {
    const { configs, changed } = migrateDefaultConfigs([{ ...OLD_TEMPLATE } as any])
    expect(changed).toBe(true)
    const c = configs[0]
    expect(c.protocol).toBe('anthropic')
    expect(c.nativeWebSearch).toBe(true)
    expect(c.currency).toBe('CNY')
    expect(c.mainCurrency).toBe('CNY')
    expect(c.inputPricePerM).toBe(1)      // 输入（缓存未命中）
    expect(c.outputPricePerM).toBe(2)     // 输出
    expect(c.cacheHitPricePerM).toBe(0.02) // 输入（缓存命中）
    expect(c.provider).toBe('deepseek')
    expect(c.apiUrl).toBe('https://api.deepseek.com')
    expect(c.model).toBe('deepseek-v4-flash')
    expect(c.apiKey).toBe('sk-test')  // 密钥不动
  })

  it('用户自定义过的字段保持不动', () => {
    const custom = {
      ...OLD_TEMPLATE,
      id: 'c2',
      name: '自定义模板',
      apiUrl: 'https://custom-proxy.example.com/v1',
      model: 'deepseek-v4-pro',
      inputPricePerM: 5,
    } as any
    const { configs, changed } = migrateDefaultConfigs([custom])
    expect(changed).toBe(true)  // 仍有未自定义字段被迁移
    const c = configs[0]
    expect(c.apiUrl).toBe('https://custom-proxy.example.com/v1')  // 自定义地址保留
    expect(c.model).toBe('deepseek-v4-pro')                        // 自定义模型保留
    expect(c.inputPricePerM).toBe(5)                               // 自定义价格保留
    expect(c.protocol).toBe('anthropic')                           // 未自定义字段迁移
    expect(c.currency).toBe('CNY')
  })

  it('mainCurrency 已自定义时币种不动', () => {
    const custom = { ...OLD_TEMPLATE, id: 'c3', mainCurrency: 'USD' as const } as any
    const { configs, changed } = migrateDefaultConfigs([custom])
    expect(changed).toBe(true)
    expect(configs[0].currency).toBe('USD')
    expect(configs[0].mainCurrency).toBe('USD')
  })

  it('新默认模板（v15.2.1 正确值）迁移后无变化', () => {
    const fresh = {
      ...OLD_TEMPLATE,
      id: 'c4',
      protocol: 'anthropic' as const,
      nativeWebSearch: true,
      currency: 'CNY' as const,
      mainCurrency: 'CNY' as const,
      inputPricePerM: 1,
      outputPricePerM: 2,
      cacheHitPricePerM: 0.02,
      provider: 'deepseek',
      apiUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    } as any
    const { changed } = migrateDefaultConfigs([fresh])
    expect(changed).toBe(false)
  })

  it('v15.1.0 错位定价（0.02/1/2）整体修正为 1/2/0.02', () => {
    const wrong = {
      ...OLD_TEMPLATE,
      id: 'c5',
      protocol: 'anthropic' as const,
      nativeWebSearch: true,
      currency: 'CNY' as const,
      mainCurrency: 'CNY' as const,
      inputPricePerM: 0.02,
      outputPricePerM: 1,
      cacheHitPricePerM: 2,
      provider: 'deepseek',
      apiUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    } as any
    const { configs, changed } = migrateDefaultConfigs([wrong])
    expect(changed).toBe(true)
    expect(configs[0].inputPricePerM).toBe(1)
    expect(configs[0].outputPricePerM).toBe(2)
    expect(configs[0].cacheHitPricePerM).toBe(0.02)
  })

  it('v15.1.0 错位价仅改过其中一个字段时整组不动（尊重自定义）', () => {
    const partial = {
      ...OLD_TEMPLATE,
      id: 'c6',
      protocol: 'anthropic' as const,
      nativeWebSearch: true,
      currency: 'CNY' as const,
      mainCurrency: 'CNY' as const,
      inputPricePerM: 0.02,
      outputPricePerM: 1.5,   // 用户改过输出价
      cacheHitPricePerM: 2,
      provider: 'deepseek',
      apiUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    } as any
    const { configs } = migrateDefaultConfigs([partial])
    expect(configs[0].inputPricePerM).toBe(0.02)
    expect(configs[0].outputPricePerM).toBe(1.5)
    expect(configs[0].cacheHitPricePerM).toBe(2)
  })
})
