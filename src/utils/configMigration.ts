// ── v15.1.0 默认模型配置迁移 ──
// 背景：v15.1.0 将 DEFAULT_MODEL_CONFIG 默认值改为 DeepSeek（anthropic 协议 / 原生联网 /
// CNY 定价 0.02-1-2 / 1M 上下文）。用户要求"新模板 + 现有默认模板"都生效。
// 策略：字段级迁移——仅当某字段仍等于 v15.0.0 旧默认值时才更新为新默认值；
// 用户手动改过的字段保持不变（不覆盖自定义）。
import type { ModelConfig } from '@/types/settings'

// v15.0.0 旧默认值（迁移源，仅识别"未自定义"字段）
const OLD = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  protocol: 'openai' as const,
  nativeWebSearch: false,
  currency: 'USD' as const,
  inputPricePerM: 2.50,
  outputPricePerM: 10.00,
  cacheHitPricePerM: 1.25,
}

// v15.1.0 新默认值（迁移目标，与 DEFAULT_MODEL_CONFIG 一致）
const NEW = {
  provider: 'deepseek',
  apiUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  protocol: 'anthropic' as const,
  nativeWebSearch: true,
  currency: 'CNY' as const,
  inputPricePerM: 0.02,
  outputPricePerM: 1,
  cacheHitPricePerM: 2,
}

export function migrateDefaultConfigs(configs: ModelConfig[]): { configs: ModelConfig[]; changed: boolean } {
  let changed = false
  const next = configs.map(c => {
    const patch: Partial<ModelConfig> = {}
    if (c.provider === OLD.provider) { patch.provider = NEW.provider; changed = true }
    if (c.apiUrl === OLD.apiUrl) { patch.apiUrl = NEW.apiUrl; changed = true }
    if (c.model === OLD.model) { patch.model = NEW.model; changed = true }
    if (c.protocol === OLD.protocol) { patch.protocol = NEW.protocol; changed = true }
    if (c.nativeWebSearch === OLD.nativeWebSearch) { patch.nativeWebSearch = NEW.nativeWebSearch; changed = true }
    // 币种：仅当 mainCurrency 未自定义且 currency 仍为旧默认 USD 时迁移（用户改过币种则不动）
    if (!c.mainCurrency && c.currency === OLD.currency) {
      patch.currency = NEW.currency
      patch.mainCurrency = NEW.currency
      changed = true
    }
    if (c.inputPricePerM === OLD.inputPricePerM) { patch.inputPricePerM = NEW.inputPricePerM; changed = true }
    if (c.outputPricePerM === OLD.outputPricePerM) { patch.outputPricePerM = NEW.outputPricePerM; changed = true }
    if (c.cacheHitPricePerM === OLD.cacheHitPricePerM) { patch.cacheHitPricePerM = NEW.cacheHitPricePerM; changed = true }
    return Object.keys(patch).length > 0 ? { ...c, ...patch } : c
  })
  return { configs: next, changed }
}
