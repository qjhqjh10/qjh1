// ── 内置技能: 角色管理 ──
import type { SkillDefinition } from '../types'

export const characterSkill: SkillDefinition = {
  id: 'character-management',
  name: '角色管理',
  description: '创建、读取、修改小说角色。支持16字段完整角色卡，自动参考已有格式。',
  triggerPatterns: [
    '创建.*角色', '新建.*[人物角色]', '加.*[人物角色]',
    '写.*角色卡', '[人物角色].*创建', '生成.*角色',
    '查看.*角色', '读取.*角色', '角色.*信息',
    '修改.*角色', '更新.*角色', '批量.*角色',
  ],
  category: 'character',
  workflow: {
    description: '先列出已有角色了解格式 → 读取参考角色 → 创建/编辑新角色 → 验证16字段完整性',
    steps: [
      { order: 1, tool: 'list_directory', purpose: '查看已有角色文件，了解命名和格式', argsTemplate: { path: '${projectId}/characters/' }, optional: false },
      { order: 2, tool: 'read_file', purpose: '读取一个已有角色作为格式参考', argsTemplate: { file_path: '${projectId}/characters/${referenceName}.yaml' }, optional: false },
      { order: 3, tool: 'create_file', purpose: '创建新角色的16字段完整YAML', argsTemplate: { file_path: '${projectId}/characters/${name}.yaml', content: '${characterYAML}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'qc-all-fields', description: '16个字段必须全部填写（id,name,role,gender,age,occupation,background,appearance,personality,abilities,weaknesses,relationships,relationshipTags,arc,importance,image）', severity: 'error', check: '逐字段检查，缺一不可' },
    { id: 'qc-abilities-string', description: 'abilities 必须是纯文本字符串，不能是对象/数组', severity: 'error', check: 'typeof abilities === "string"' },
    { id: 'qc-role-enum', description: 'role 必须是: 男主|女主|男配|女配|反派|其他', severity: 'error', check: 'role 在枚举值中' },
    { id: 'qc-relationship-tags', description: 'relationshipTags 必须是数组', severity: 'error', check: 'Array.isArray(relationshipTags)' },
    { id: 'qc-importance-number', description: 'importance 必须是数字', severity: 'error', check: 'typeof importance === "number"' },
    { id: 'qc-no-nesting', description: '禁止嵌套对象（如 {"basicInfo":{...}}），所有字段平铺', severity: 'error', check: '检查 JSON 结构无嵌套' },
    { id: 'qc-name-match', description: '文件名必须与角色中文名一致（如 林雨晴.json）', severity: 'warn', check: '文件名 === name 字段值' },
  ],
  inputSchema: {
    fields: [
      { name: 'name', description: '角色中文名', type: 'string', required: true, extractFrom: '(?:创建|新建|加).*?[角色人物]\\s*[:：]?\\s*([\\u4e00-\\u9fff]{2,4})' },
      { name: 'role', description: '角色类型', type: 'enum', required: true, enumValues: ['男主', '女主', '男配', '女配', '反派', '其他'], extractFrom: '(男主|女主|男配|女配|反派)' },
      { name: 'gender', description: '性别', type: 'enum', required: true, enumValues: ['男', '女'], extractFrom: '(男|女)' },
      { name: 'age', description: '年龄', type: 'string', required: true, extractFrom: '(\\d{1,3})\\s*岁' },
      { name: 'occupation', description: '职业', type: 'string', required: true, extractFrom: '(画家|医生|学生|教师|工程师|杀手|修仙者|剑客|法师)' },
      { name: 'background', description: '背景故事', type: 'string', required: false },
      { name: 'personality', description: '性格描述', type: 'string', required: false, extractFrom: '(温柔|冷酷|开朗|内向|暴躁|善良|邪恶|狡猾|正直)' },
    ],
    extractionHint: '从用户消息中提取角色名、角色类型、性别、年龄、职业、性格等信息。缺失的字段用合理的默认值填补。',
  },
  examples: [
    {
      userInput: '创建一个女主，叫林雨晴，22岁，画家，温柔善良',
      skillOutput: '角色林雨晴已创建，16字段完整',
      toolCallsExpected: ['list_directory', 'read_file', 'create_file'],
    },
    {
      userInput: '批量创建三个配角：师父陈远山、闺蜜苏小曼、竞争对手顾星河',
      skillOutput: '3个角色已创建',
      toolCallsExpected: ['list_directory', 'create_file', 'create_file', 'create_file'],
    },
  ],
  metadata: {
    version: '1.0.0',
    author: '青剑内置',
    source: 'builtin',
    enabled: true,
    priority: 90,
    createdAt: '2026-06-03',
    updatedAt: '2026-06-03',
  },
}
