// ── v15.1.0 默认模型配置迁移 ──
// 背景：v15.1.0 将 DEFAULT_MODEL_CONFIG 默认值改为 DeepSeek（anthropic 协议 / 原生联网 /
// CNY 定价 / 1M 上下文）。用户要求"新模板 + 现有默认模板"都生效。
// 策略：字段级迁移——仅当某字段仍等于 v15.0.0 旧默认值时才更新为新默认值；
// 用户手动改过的字段保持不变（不覆盖自定义）。
// v15.2.1：v15.1.0 定价字段映射错位（输入 0.02/输出 1/缓存 2），本文件一并修正为新默认 1/2/0.02。
// v16.2.0：image* 六字段彻底改造为 secondary*（副模型多模态）。旧 image* 有值的搬入 secondary*（用户自定义不丢）。
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

// 新默认值（迁移目标，与 DEFAULT_MODEL_CONFIG 一致）
const NEW = {
  provider: 'deepseek',
  apiUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  protocol: 'anthropic' as const,
  nativeWebSearch: true,
  currency: 'CNY' as const,
  inputPricePerM: 1,
  outputPricePerM: 2,
  cacheHitPricePerM: 0.02,
}

// v15.1.0 曾写入的错位价格三元组（输入 0.02/输出 1/缓存 2 → 应为 1/2/0.02）。
// 仅当三个字段全部仍等于错位默认值时才整体修正——任一个被用户改过则整组不动（不覆盖自定义）。
const WRONG_PRICE_TRIPLE = { inputPricePerM: 0.02, outputPricePerM: 1, cacheHitPricePerM: 2 }
const CORRECT_PRICE_TRIPLE = { inputPricePerM: 1, outputPricePerM: 2, cacheHitPricePerM: 0.02 }

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
    // v15.2.1: 修正 v15.1.0 错位定价（仅当三字段仍全等于错位默认值）
    if (c.inputPricePerM === WRONG_PRICE_TRIPLE.inputPricePerM
      && c.outputPricePerM === WRONG_PRICE_TRIPLE.outputPricePerM
      && c.cacheHitPricePerM === WRONG_PRICE_TRIPLE.cacheHitPricePerM) {
      Object.assign(patch, CORRECT_PRICE_TRIPLE)
      changed = true
    }
    // v16.2.0: image* → secondary* 搬移——旧配置中 image 字段有值的搬到副模型字段（用户自定义不丢）；
    // 旧字段以 any 读取（旧持久化数据可能不含新字段），不触发类型错误
    const anyC = c as unknown as Record<string, unknown>
    const oldImage = {
      imageModel: String(anyC.imageModel ?? ''),
      imageProvider: String(anyC.imageProvider ?? ''),
      imageApiUrl: String(anyC.imageApiUrl ?? ''),
      imageApiKey: String(anyC.imageApiKey ?? ''),
      imageInputPricePerM: typeof anyC.imageInputPricePerM === 'number' ? anyC.imageInputPricePerM : 0,
      imageOutputPricePerM: typeof anyC.imageOutputPricePerM === 'number' ? anyC.imageOutputPricePerM : 0,
    }
    if (oldImage.imageModel || oldImage.imageProvider || oldImage.imageApiUrl || oldImage.imageApiKey) {
      if (!c.secondaryModel) { patch.secondaryModel = oldImage.imageModel; changed = true }
      if (!c.secondaryProvider) { patch.secondaryProvider = oldImage.imageProvider; changed = true }
      if (!c.secondaryApiUrl) { patch.secondaryApiUrl = oldImage.imageApiUrl; changed = true }
      if (!c.secondaryApiKey) { patch.secondaryApiKey = oldImage.imageApiKey; changed = true }
      if (oldImage.imageInputPricePerM > 0 && !c.secondaryInputPricePerM) { patch.secondaryInputPricePerM = oldImage.imageInputPricePerM; changed = true }
      if (oldImage.imageOutputPricePerM > 0 && !c.secondaryOutputPricePerM) { patch.secondaryOutputPricePerM = oldImage.imageOutputPricePerM; changed = true }
      // v16.2.0(审查修复 B1): 搬移后清除旧键（patch 置 undefined → 展开覆盖 c 旧键；
      // JSON 序列化丢弃 undefined 字段 → electron-store 不残留）
      ;(patch as unknown as Record<string, unknown>).imageModel = undefined
      ;(patch as unknown as Record<string, unknown>).imageProvider = undefined
      ;(patch as unknown as Record<string, unknown>).imageApiUrl = undefined
      ;(patch as unknown as Record<string, unknown>).imageApiKey = undefined
      ;(patch as unknown as Record<string, unknown>).imageInputPricePerM = undefined
      ;(patch as unknown as Record<string, unknown>).imageOutputPricePerM = undefined
      changed = true
    }
    return Object.keys(patch).length > 0 ? { ...c, ...patch } : c
  })
  return { configs: next, changed }
}
