/**
 * Schema validation for AI-generated structured files.
 *
 * Design: validate BEFORE writing to disk, so invalid AI output never
 * reaches the filesystem. The AI sees the error and can retry via the
 * existing tool loop (up to 8 iterations).
 */

// ── Types ─────────────────────────────────────────────────────────

export interface SchemaError {
  field: string
  message: string
  fix?: string
}

export interface ValidationResult {
  valid: boolean
  errors: SchemaError[]
}

// ── Character schema (14 required fields + 可选 customBlocks) ──────
// v13.x: relationshipTags/image 已从角色卡移除，与 characterService 字段清单对齐

const CHARACTER_ROLES = ['男主', '女主', '男配', '女配', '反派', '其他'] as const

const CHARACTER_FIELDS: { key: string; type: 'string' | 'number' | 'array'; required: boolean }[] = [
  { key: 'id', type: 'string', required: true },
  { key: 'name', type: 'string', required: true },
  { key: 'role', type: 'string', required: true },
  { key: 'gender', type: 'string', required: true },
  { key: 'age', type: 'string', required: true },
  { key: 'occupation', type: 'string', required: true },
  { key: 'background', type: 'string', required: true },
  { key: 'appearance', type: 'string', required: true },
  { key: 'personality', type: 'string', required: true },
  { key: 'abilities', type: 'string', required: true },
  { key: 'weaknesses', type: 'string', required: true },
  { key: 'relationships', type: 'string', required: true },
  { key: 'arc', type: 'string', required: true },
  { key: 'importance', type: 'number', required: true },
]

function validateCharacter(obj: Record<string, unknown>): ValidationResult {
  const errors: SchemaError[] = []

  // Check for nested-object anti-pattern (AI common mistake)
  const nestedKeys = ['basicInfo', 'appearance', 'personality', 'status', 'relationshipWithMC', 'testingNotes']
  const foundNested = nestedKeys.filter(k => typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k]))
  if (foundNested.length > 0) {
    errors.push({
      field: foundNested.join(', '),
      message: `使用了嵌套对象格式（${foundNested.join('、')}），角色JSON必须是14个平铺字段。`,
      fix: `read_file("characters/zhangming.yaml") 查看正确格式，然后用 __FULL_REPLACE__ 重写为平铺结构。`,
    })
    return { valid: false, errors }
  }

  // Check required fields
  for (const field of CHARACTER_FIELDS) {
    if (field.required && !(field.key in obj)) {
      errors.push({ field: field.key, message: `缺少必填字段: ${field.key}`, fix: `添加 "${field.key}": ${field.type === 'string' ? '"..."' : field.type === 'number' ? '0' : '[]'} 到JSON对象中` })
      continue
    }
    const val = obj[field.key]
    if (field.required && (val === null || val === undefined || val === '')) {
      errors.push({ field: field.key, message: `必填字段不能为空: ${field.key}`, fix: `为 "${field.key}" 赋一个非空${field.type === 'string' ? '字符串' : field.type === 'number' ? '数字' : '数组'}值` })
      continue
    }
    // Skip type check for optional fields that are not present
    if (val === undefined || val === null) continue
    // Type check
    if (field.type === 'string' && typeof val !== 'string') {
      errors.push({ field: field.key, message: `${field.key} 必须是字符串，当前是 ${typeof val}` })
    }
    if (field.type === 'number' && typeof val !== 'number') {
      errors.push({ field: field.key, message: `${field.key} 必须是数字，当前是 ${typeof val}` })
    }
    if (field.type === 'array' && !Array.isArray(val)) {
      errors.push({ field: field.key, message: `${field.key} 必须是数组，当前是 ${typeof val}` })
    }
  }

  // Validate role
  if (typeof obj.role === 'string' && !(CHARACTER_ROLES as readonly string[]).includes(obj.role)) {
    errors.push({
      field: 'role',
      message: `"${obj.role}" 不是合法值。role 必须从以下6个中选一: ${CHARACTER_ROLES.join('、')}`,
      fix: `将 role 改为 "男主"、"女主"、"男配"、"女配"、"反派" 或 "其他" 之一`,
    })
  }

  // Validate abilities is not an object (AI common mistake)
  if (typeof obj.abilities === 'object' && obj.abilities !== null && !Array.isArray(obj.abilities)) {
    errors.push({
      field: 'abilities',
      message: 'abilities 必须是纯文本字符串，不能是对象',
      fix: '将 abilities 从对象改为字符串，如 "异能类型：空间系；等级：A级；能力描述：..."',
    })
  }

  return { valid: errors.length === 0, errors }
}

// ── Detailed outline schema ───────────────────────────────────────

const DETAILED_OUTLINE_FIELDS: { key: string; type: string; required: boolean }[] = [
  { key: 'id', type: 'string', required: true },
  { key: 'title', type: 'string', required: true },
  { key: 'order', type: 'number', required: true },
  { key: 'status', type: 'string', required: true },
  { key: 'plotOverview', type: 'string', required: true },
  { key: 'characters', type: 'string', required: true },
  { key: 'location', type: 'string', required: true },
  { key: 'keyEvents', type: 'string', required: true },
  { key: 'eroticContent', type: 'string', required: false },
  { key: 'customContent', type: 'string', required: false },
  { key: 'emotionCurve', type: 'string', required: false },
  { key: 'writingNotes', type: 'string', required: false },
  { key: 'summary', type: 'string', required: false },
]

function validateDetailedOutline(obj: Record<string, unknown>): ValidationResult {
  const errors: SchemaError[] = []

  for (const field of DETAILED_OUTLINE_FIELDS) {
    if (field.required && !(field.key in obj)) {
      errors.push({ field: field.key, message: `缺少必填字段: ${field.key}。参考格式: read_file("detailed_outline/chapter1.yaml")` })
      continue
    }
    const val = obj[field.key]
    if (field.required && (val === null || val === undefined || val === '')) {
      errors.push({ field: field.key, message: `必填字段不能为空: ${field.key}` })
    }
    if (val !== undefined && val !== null && field.type === 'number' && typeof val !== 'number') {
      errors.push({ field: field.key, message: `${field.key} 必须是数字` })
    }
  }

  if (typeof obj.status === 'string' && !['incomplete', 'completed'].includes(obj.status)) {
    errors.push({ field: 'status', message: `status 必须是 incomplete 或 completed，当前: ${obj.status}`, fix: '将 status 改为 "incomplete" 或 "completed"' })
  }

  // Detect .md file being used as detailed_outline (AI anti-pattern)
  if (!obj.id || !obj.title || typeof obj.order !== 'number') {
    errors.push({
      field: '(整体)',
      message: '细纲必须是 JSON 或 YAML 格式（.json / .yaml），禁止创建 .md / .txt 文件',
      fix: 'read_file("detailed_outline/chapter1.yaml") 查看正确格式，用 create_file 创建 .yaml 文件',
    })
  }

  return { valid: errors.length === 0, errors }
}

// ── List JSON schemas (items, locations, factions) ─────────────────

function validateListJson(obj: Record<string, unknown>, listKey: string, itemRequiredFields: string[]): ValidationResult {
  const errors: SchemaError[] = []

  if (!Array.isArray(obj[listKey])) {
    errors.push({ field: listKey, message: `${listKey} 必须是数组` })
    return { valid: false, errors }
  }

  const arr = obj[listKey] as Record<string, unknown>[]
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'object' || arr[i] === null) {
      errors.push({ field: `${listKey}[${i}]`, message: `第${i + 1}项必须是对象` })
      continue
    }
    for (const f of itemRequiredFields) {
      if (!(f in arr[i]) || arr[i][f] === null || arr[i][f] === undefined) {
        errors.push({ field: `${listKey}[${i}].${f}`, message: `第${i + 1}项缺少字段: ${f}` })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ── Power system schema ────────────────────────────────────────────

function validatePowerSystem(obj: Record<string, unknown>): ValidationResult {
  const errors: SchemaError[] = []
  if (typeof obj.name !== 'string' || !obj.name) errors.push({ field: 'name', message: '缺少体系名称' })
  if (!Array.isArray(obj.levels)) {
    errors.push({ field: 'levels', message: 'levels 必须是数组' })
  } else {
    const levels = obj.levels as Record<string, unknown>[]
    for (let i = 0; i < levels.length; i++) {
      if (typeof levels[i]?.name !== 'string' || !levels[i].name) {
        errors.push({ field: `levels[${i}].name`, message: `第${i + 1}级缺少名称` })
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

// ── Outline meta schema (foreshadowing + plot threads) ────────────

function validateOutlineMeta(obj: Record<string, unknown>): ValidationResult {
  const errors: SchemaError[] = []

  if (!Array.isArray(obj.foreshadowing)) {
    errors.push({ field: 'foreshadowing', message: 'foreshadowing 必须是数组' })
  } else {
    const items = obj.foreshadowing as Record<string, unknown>[]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.id) errors.push({ field: `foreshadowing[${i}].id`, message: `第${i + 1}条伏笔缺少 id` })
      if (!item.description) errors.push({ field: `foreshadowing[${i}].description`, message: `第${i + 1}条伏笔缺少 description` })
      if (item.status && !['planted', 'resolved'].includes(String(item.status))) {
        errors.push({ field: `foreshadowing[${i}].status`, message: `status 必须是 planted 或 resolved` })
      }
    }
  }

  if (!Array.isArray(obj.plotThreads)) {
    errors.push({ field: 'plotThreads', message: 'plotThreads 必须是数组' })
  } else {
    const items = obj.plotThreads as Record<string, unknown>[]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.id) errors.push({ field: `plotThreads[${i}].id`, message: `第${i + 1}条故事线缺少 id` })
      if (!item.name) errors.push({ field: `plotThreads[${i}].name`, message: `第${i + 1}条故事线缺少 name` })
      if (item.type && !['main', 'sub', 'hidden'].includes(String(item.type))) {
        errors.push({ field: `plotThreads[${i}].type`, message: `type 必须是 main|sub|hidden` })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ── Emotion curve schema ──────────────────────────────────────────

function validateEmotion(obj: Record<string, unknown>): ValidationResult {
  const errors: SchemaError[] = []

  if (!Array.isArray(obj.segments)) {
    errors.push({ field: 'segments', message: 'segments 必须是数组' })
  } else {
    const items = obj.segments as Record<string, unknown>[]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (typeof item.chapterStart !== 'number') errors.push({ field: `segments[${i}].chapterStart`, message: `第${i + 1}段缺少数字 chapterStart` })
      if (typeof item.chapterEnd !== 'number') errors.push({ field: `segments[${i}].chapterEnd`, message: `第${i + 1}段缺少数字 chapterEnd` })
      if (typeof item.dominantEmotion !== 'string' || !item.dominantEmotion) errors.push({ field: `segments[${i}].dominantEmotion`, message: `第${i + 1}段缺少 dominantEmotion` })
    }
  }

  return { valid: errors.length === 0, errors }
}

// ── Main dispatcher ────────────────────────────────────────────────

/**
 * Validate AI-generated content against the schema implied by the file path.
 * Returns structured errors so the AI can retry with corrections.
 */
export function validateFileContent(filePath: string, content: string): ValidationResult {
  const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml')
  const isJson = filePath.endsWith('.json')

  // Parse content (JSON or YAML)
  let obj: unknown
  if (isYaml) {
    // YAML parsing
    try {
      const yaml = require('js-yaml')
      obj = yaml.load(content, { schema: yaml.JSON_SCHEMA, json: false })
    } catch (e: any) {
      return {
        valid: false,
        errors: [{ field: '(整个文件)', message: `YAML 格式错误: ${e.message}。请检查缩进（2空格）、多行文本用 | 或 >-、列表用 - 前缀。` }],
      }
    }
  } else {
    // JSON parsing with repair fallback
    try {
      obj = JSON.parse(content)
    } catch (e: any) {
      const repaired = tryRepairJson(content)
      if (repaired) {
        try { obj = JSON.parse(repaired) } catch { /* still broken */ }
      }
      if (!obj) {
        return {
          valid: false,
          errors: [{ field: '(整个文件)', message: `JSON 格式错误: ${e.message}。请检查：所有键用双引号、无尾随逗号。建议使用 YAML 格式（.yaml）替代 JSON。` }],
        }
      }
    }
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { valid: false, errors: [{ field: '(根)', message: '文件内容必须是 JSON 对象' }] }
  }

  const record = obj as Record<string, unknown>

  // Route to correct validator based on path
  const normalized = filePath.replace(/\\/g, '/')

  if (normalized.startsWith('characters/') || normalized.includes('/characters/')) {
    return validateCharacter(record)
  }

  if (normalized.startsWith('detailed_outline/') || normalized.includes('/detailed_outline/')) {
    return validateDetailedOutline(record)
  }

  const OUTLINE_TAB_FILES = ['items', 'locations', 'factions', 'power_system', 'outline_meta', 'emotion']
  for (const tab of OUTLINE_TAB_FILES) {
    const matchJson = normalized === `outline/${tab}.json` || normalized.endsWith(`/outline/${tab}.json`)
    const matchYaml = normalized === `outline/${tab}.yaml` || normalized.endsWith(`/outline/${tab}.yaml`)
    const matchYml  = normalized === `outline/${tab}.yml` || normalized.endsWith(`/outline/${tab}.yml`)
    if (matchJson || matchYaml || matchYml) {
      switch (tab) {
        case 'items':      return validateListJson(record, 'items', ['id', 'name', 'type'])
        case 'locations':  return validateListJson(record, 'locations', ['id', 'name', 'description'])
        case 'factions':   return validateListJson(record, 'factions', ['id', 'name'])
        case 'power_system': return validatePowerSystem(record)
        case 'outline_meta': return validateOutlineMeta(record)
        case 'emotion':    return validateEmotion(record)
      }
    }
  }

  // Unknown file type — accept as-is
  return { valid: true, errors: [] }
}

// ── JSON repair (minimal, mirrors chapterService.repairJson) ───────

function tryRepairJson(raw: string): string | null {
  // Fix unescaped newlines in strings
  let fixed = ''
  let inString = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"' && (i === 0 || raw[i - 1] !== '\\')) {
      inString = !inString
      fixed += ch
    } else if (inString && ch === '\n') {
      fixed += '\\n'
    } else {
      fixed += ch
    }
  }

  try { JSON.parse(fixed); return fixed } catch { /* continue */ }

  // Try auto-closing braces (strip trailing comma at end first)
  const openBraces = (raw.match(/{/g) || []).length
  const closeBraces = (raw.match(/}/g) || []).length
  if (openBraces > closeBraces) {
    let closed = fixed.trimEnd()
    // Remove trailing comma if present (would cause ,} or ,\n})
    closed = closed.replace(/,(\s*)$/, '$1')
    closed += '\n' + '}'.repeat(openBraces - closeBraces)
    try { JSON.parse(closed); return closed } catch { /* continue */ }
  }

  return null
}
