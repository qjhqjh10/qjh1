// ── YAML 工具 ──
// 为 JSON → YAML 格式迁移提供解析/序列化/双格式读取支持。
// 使用 js-yaml 库，提供安全的解析和统一的错误处理。

import * as yaml from 'js-yaml'

/**
 * 解析 YAML 字符串。
 * 使用安全 schema，不执行任何代码。
 */
export function yamlParse(text: string): unknown {
  try {
    return yaml.load(text, {
      schema: yaml.JSON_SCHEMA,       // 只支持 JSON 兼容的子集，安全
      json: false,                     // 不强制 JSON 模式
    })
  } catch (e) {
    throw new Error(`YAML 解析失败: ${e instanceof Error ? e.message : '未知错误'}`)
  }
}

/**
 * 将对象序列化为 YAML 字符串。
 * 选项适合 LLM 输出场景：不折行、无引用标记、保持字段顺序。
 */
export function yamlStringify(obj: unknown, options?: { lineWidth?: number }): string {
  return yaml.dump(obj, {
    lineWidth: options?.lineWidth ?? -1,   // 不自动折行
    noRefs: true,                           // 不使用锚点引用
    sortKeys: false,                        // 保持字段原始顺序
    quotingType: '"',                       // 必要时用双引号
    forceQuotes: false,                     // 不强制引号
    indent: 2,                              // 2 空格缩进
    noCompatMode: true,                     // 不使用兼容模式
  })
}

/**
 * 尝试解析 JSON 或 YAML。
 * 先试 JSON.parse（快），失败再试 yamlParse。
 * 返回解析结果和格式标识，两者都失败则返回 null。
 *
 * @param preferFormat 优先使用哪种格式。'json' 时只试 JSON，'yaml' 时只试 YAML，不传则两者都试。
 */
export function tryParseJsonOrYaml(content: string, preferFormat?: 'json' | 'yaml'): { obj: unknown; format: 'json' | 'yaml' } | null {
  if (preferFormat === 'json') {
    try { return { obj: JSON.parse(content), format: 'json' } } catch { return null }
  }
  if (preferFormat === 'yaml') {
    try {
      const obj = yamlParse(content)
      if (typeof obj === 'string' && !content.includes(':')) return null
      return { obj, format: 'yaml' }
    } catch { return null }
  }

  // Auto-detect: try JSON first, then YAML
  try { return { obj: JSON.parse(content), format: 'json' } } catch {}
  try {
    const obj = yamlParse(content)
    if (typeof obj === 'string' && !content.includes(':')) return null
    return { obj, format: 'yaml' }
  } catch {}
  return null
}

/**
 * 根据格式序列化数据。
 */
export function stringifyData(obj: unknown, format: 'json' | 'yaml'): string {
  if (format === 'yaml') {
    return yamlStringify(obj)
  }
  return JSON.stringify(obj, null, 2)
}
