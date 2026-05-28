import type { ContextProvider } from '../ContextAssembler'

export const characterProvider: ContextProvider = {
  domain: 'characters',
  relevance: (userMessage) => {
    const score = /角色|人物|男主|女主|配角|反派|character/i.test(userMessage) ? 0.9 : 0.6
    if (/创建.*角色|添加.*人物|新建.*角色|写.*角色/.test(userMessage)) return 1.0
    return score
  },

  buildContext: async () => ({
    domain: 'characters',
    priority: 80,
    estimatedTokens: 500,
    content: [
      '## 角色 JSON Schema',
      '角色文件存储在 characters/{拼音id}.json，每个角色一个文件，必须是 16 个平铺字段（禁止嵌套对象）：',
      '',
      '必填字段 (15个):',
      '- id: string — 拼音ID，如 "zhangsan"',
      '- name: string — 角色名',
      '- role: string — 必须从 [男主|女主|男配|女配|反派|其他] 中选一',
      '- gender: string — 男/女',
      '- age: string — 年龄',
      '- occupation: string — 职业/身份',
      '- background: string — 背景故事',
      '- appearance: string — 外貌描述（纯文本，非对象）',
      '- personality: string — 性格描述',
      '- abilities: string — 能力（纯文本，非对象）',
      '- weaknesses: string — 弱点',
      '- relationships: string — 人物关系描述',
      '- relationshipTags: string[] — 关系标签数组，如 ["恋人","师徒"]',
      '- arc: string — 角色弧光',
      '- importance: number — 重要度 (0-100)',
      '',
      '可选字段:',
      '- image: string — 形象图路径（可选）',
      '',
      '创建角色前，先用 read_file 查看已有角色文件了解格式。不要使用 basicInfo/appearance/personality 等嵌套对象。',
      '',
      '常见错误（必须避免）:',
      '- 使用嵌套对象如 {"基本属性":{"姓名":"张三"}} — 所有字段必须平铺',
      '- role 写成"男主角"、"女主角" — 必须严格用男主/女主/男配/女配/反派/其他',
      '- abilities 写成对象如 {"异能":"xxx"} — 必须是纯文本字符串',
      '- relationshipTags 写成字符串 — 必须是数组如 ["恋人","师徒"]',
      '- 角色文件必须放在 characters/{拼音id}.json，不要放在 characters_test/，不要用中文名作为文件名',
    ].join('\n'),
  }),
}
