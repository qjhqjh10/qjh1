// ── 内置技能: 场景模板 ── 自包含完整格式定义
import type { SkillDefinition } from '../types'

export const sceneTemplateSkill: SkillDefinition = {
  id: 'scene-template', name: '场景模板',
  description: '分析场景结构特征，创建可复用的场景模板(YAML)。通用字段+情色专属字段。',
  triggerPatterns: ['场景.*分析', '场景模板', 'create_scene_template', '分析.*场景', '场景.*提取'],
  category: 'scene',
  workflow: {
    description:
      '## 场景模板格式（scene_templates/{name}.yaml，YAML）\n' +
      '### 必填\n' +
      '- name: 模板名称\n' +
      '- type: 小说类型（17种之一）\n\n' +
      '### 通用字段（从原文提取，有则填、无则留空）\n' +
      '- sceneType: 日常|战斗|对话|内心独白|过渡|高潮|情色\n' +
      '- conflictType: 冲突类型\n' +
      '- scenePurpose: 场景目的数组\n' +
      '- characters: 出场角色（如"赵亮:掌控得意; 重玲:抗拒→羞耻"）\n' +
      '- location: 地点+环境描述\n' +
      '- time/weather/atmosphere: 时间/天气/氛围\n' +
      '- wordTarget: 目标字数（数字）\n' +
      '- narrativePOV: 叙事视角\n' +
      '- pacing: 节奏控制\n' +
      '- bodyLanguage: 肢体语言描写重点\n' +
      '- sensoryAnchors: 感官锚点\n' +
      '- dominantEmotion: 主导情绪\n' +
      '- emotionCurveInput: 情绪曲线\n' +
      '- plotOverview: 场景剧情概述(200-500字)\n' +
      '- sceneTurningPoint: 转折点描述\n' +
      '- props/appearance/detail/extraNote: 道具/外貌/详情/备注\n\n' +
      '### 情色专属字段（仅type=情色小说）\n' +
      '- intensity(1-5) selectedKinks[] opening[]/climax[]/aftermath[]\n' +
      '- soundDensity moanStyle degradeLangs[]\n' +
      '- bodyFluidFocus[] bodyPartFocus[] tactileFocus[]\n\n' +
      '### autoFields 规则\n' +
      '- 不确定的字段名列入 autoFields 数组（≤10个）\n' +
      '- 能推断的必须填，禁止全部标autoFields\n' +
      '- 无参考材料→拒绝创建，让用户先提供原文',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取要分析的场景原文', argsTemplate: { file_path: '${file_path}' }, optional: false },
      { order: 2, tool: 'create_scene_template', purpose: '创建场景模板', argsTemplate: { name: '${name}', type: '${type}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'required-fields', description: '必填: name, type, sceneType, plotOverview(200-500字)', severity: 'error', check: '逐字段检查' },
    { id: 'auto-fields-limit', description: '不确定字段列入autoFields(≤10个)，不要强填', severity: 'warn', check: 'autoFields数量检查' },
    { id: 'no-empty-config', description: 'ploOverview 和 sceneType 不能为空', severity: 'error', check: '内容检查' },
  ],
  inputSchema: {
    fields: [
      { name: 'name', type: 'string', required: true, description: '模板名称' },
      { name: 'type', type: 'string', required: true, description: '小说类型' },
      { name: 'sceneType', type: 'string', required: false, description: '场景类型' },
      { name: 'plotOverview', type: 'string', required: false, description: '剧情概述' },
      { name: 'characters', type: 'string', required: false, description: '出场角色' },
    ],
    extractionHint: '提取模板名、小说类型、场景类型。',
  },
  examples: [{ userInput: '分析这个雨夜对峙场景的结构，创建场景模板', skillOutput: '场景模板已创建', toolCallsExpected: ['read_file', 'create_scene_template'] }],
  metadata: { version: '2.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
