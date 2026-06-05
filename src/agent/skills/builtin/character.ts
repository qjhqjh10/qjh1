// ── 内置技能: 角色管理 ── 自包含完整格式定义
import type { SkillDefinition } from '../types'

export const characterSkill: SkillDefinition = {
  id: 'character-management',
  name: '角色管理',
  description: '创建、读取、修改小说角色。16字段完整角色卡，YAML格式。',
  triggerPatterns: [
    '创建.*角色', '新建.*[人物角色]', '加.*[人物角色]',
    '写.*角色卡', '[人物角色].*创建', '生成.*角色',
    '查看.*角色', '读取.*角色', '角色.*信息',
    '修改.*角色', '更新.*角色', '批量.*角色',
  ],
  category: 'character',
  workflow: {
    description:
      '## 角色 YAML 格式（characters/{中文名}.yaml）\n' +
      '16个字段（15个必填 + image可选），所有字段平铺，禁止嵌套对象。\n\n' +
      '### 必填字段清单\n' +
      '| 字段 | 类型 | 说明 |\n' +
      '|------|------|------|\n' +
      '| id | 字符串 | 拼音唯一ID，如 zhangming |\n' +
      '| name | 字符串 | 角色中文名 |\n' +
      '| role | 枚举 | 男主|女主|男配|女配|反派|其他（严格6选1，不加额外描述）|\n' +
      '| gender | 枚举 | 男|女|其他 |\n' +
      '| age | 字符串 | 年龄，如"22" |\n' +
      '| occupation | 字符串 | 职业/身份 |\n' +
      '| background | 字符串 | 背景故事（多行用 >- 块标量）|\n' +
      '| appearance | 字符串 | 外貌描述 |\n' +
      '| personality | 字符串 | 性格描述 |\n' +
      '| abilities | 字符串 | 能力（纯文本，禁止对象/数组）|\n' +
      '| weaknesses | 字符串 | 弱点 |\n' +
      '| relationships | 字符串 | 角色关系网描述 |\n' +
      '| relationshipTags | 数组 | 关系标签，如 [\"师徒\", \"暗恋\"] |\n' +
      '| arc | 字符串 | 角色成长弧线 |\n' +
      '| importance | 数字 | 重要度 1-100 |\n' +
      '| image | 字符串 | 头像路径（可选，无则留空）|\n\n' +
      '### YAML 格式规则\n' +
      '- 缩进: 2空格，禁止Tab\n' +
      '- 键名直接写（name: 张明），不要加引号\n' +
      '- 多行文本: 用 | (保留换行) 或 >- (折叠换行)\n' +
      '- 列表: 用 - 前缀，每项一行\n' +
      '- 枚举值不加额外描述（role: 男主，不要写成 role: 男主/血煞教内应）\n\n' +
      '### 创建流程\n' +
      '先列出已有角色了解格式 → 读取参考角色 → 逐个创建新角色 → 验证16字段完整性\n\n' +
      '### 批量创建规则\n' +
      '如果用户要求创建多个角色（如"创建3个角色"），按以下流程：\n' +
      '1. 先 list_directory 查看已有角色\n' +
      '2. 读一个参考角色了解格式\n' +
      '3. 为每个角色执行：create_file → 完成后立即检查16字段完整性\n' +
      '4. 完成一个角色的所有质量检查后再处理下一个\n' +
      '5. 全部完成后汇报"X个角色已创建"',
    steps: [
      { order: 1, tool: 'list_directory', purpose: '查看已有角色文件，了解命名和格式', argsTemplate: { path: '${projectId}/characters/' }, optional: false },
      { order: 2, tool: 'read_file', purpose: '读取一个已有角色作为格式参考', argsTemplate: { file_path: '${projectId}/characters/${referenceName}.yaml' }, optional: false },
      { order: 3, tool: 'create_file', purpose: '创建单个角色的16字段完整YAML。如果是批量，重复此步为每个角色创建文件。', argsTemplate: { file_path: '${projectId}/characters/${name}.yaml', content: '${yaml}' }, optional: false },
    ],
    maxIterations: 15,  // v9.5.3: 批量场景需要更多轮次
  },
  qualityChecks: [
    { id: 'qc-all-fields', description: '16字段必须全部填写（id,name,role,gender,age,occupation,background,appearance,personality,abilities,weaknesses,relationships,relationshipTags,arc,importance,image）', severity: 'error', check: '逐字段检查' },
    { id: 'qc-abilities-string', description: 'abilities 必须是纯文本字符串，不能是对象/数组', severity: 'error', check: 'typeof abilities === "string"' },
    { id: 'qc-role-enum', description: 'role 必须是: 男主|女主|男配|女配|反派|其他（不加额外描述）', severity: 'error', check: 'role在枚举值中不含额外描述' },
    { id: 'qc-relationship-tags', description: 'relationshipTags 必须是数组', severity: 'error', check: 'Array.isArray(relationshipTags)' },
    { id: 'qc-importance-number', description: 'importance 必须是数字', severity: 'error', check: 'typeof importance === "number"' },
    { id: 'qc-no-nesting', description: '禁止嵌套对象，所有字段平铺', severity: 'error', check: '无basicInfo/appearance子对象' },
    { id: 'qc-name-match', description: '文件名与角色中文名一致（如 林雨晴.yaml）', severity: 'warn', check: '文件名 === name字段' },
    { id: 'qc-file-extension', description: '文件后缀为 .yaml', severity: 'error', check: 'file_path以.yaml结尾' },
  ],
  inputSchema: {
    fields: [
      { name: 'name', description: '角色中文名', type: 'string', required: true, extractFrom: '(?:创建|新建|加).*?[角色人物]\\s*[:：]?\\s*([\\u4e00-\\u9fff]{2,4})' },
      { name: 'role', description: '男主|女主|男配|女配|反派|其他', type: 'enum', required: true, enumValues: ['男主', '女主', '男配', '女配', '反派', '其他'], extractFrom: '(男主|女主|男配|女配|反派)' },
      { name: 'gender', description: '男|女|其他', type: 'enum', required: true, enumValues: ['男', '女', '其他'], extractFrom: '(男|女)' },
      { name: 'age', description: '年龄', type: 'string', required: true, extractFrom: '(\\d{1,3})\\s*岁' },
      { name: 'occupation', description: '职业/身份', type: 'string', required: true, extractFrom: '(画家|医生|学生|教师|工程师|杀手|修仙者|剑客|法师|大学生|剑修)' },
      { name: 'background', description: '背景故事', type: 'string', required: false },
      { name: 'personality', description: '性格', type: 'string', required: false, extractFrom: '(温柔|冷酷|开朗|内向|暴躁|善良|邪恶|狡猾|正直|清冷|孤傲)' },
    ],
    extractionHint: '提取角色名、类型、性别、年龄、职业、性格。缺失字段用合理默认值填补。',
  },
  examples: [
    { userInput: '创建一个女主，叫林雨晴，22岁，画家，温柔善良', skillOutput: '角色林雨晴已创建，16字段完整', toolCallsExpected: ['list_directory', 'read_file', 'create_file'] },
    { userInput: '批量创建配角：师父陈远山、闺蜜苏小曼、竞争对手顾星河', skillOutput: '3个角色已创建', toolCallsExpected: ['list_directory', 'create_file', 'create_file', 'create_file'] },
  ],
  metadata: { version: '2.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 90, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
