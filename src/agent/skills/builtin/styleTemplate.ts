// ── 内置技能: 风格模板 ── 自包含完整 26 维定义
import type { SkillDefinition } from '../types'

export const styleTemplateSkill: SkillDefinition = {
  id: 'style-template', name: '风格模板',
  description: '分析文本的26个文风维度，创建可复用的风格模板(YAML)。',
  triggerPatterns: ['风格.*分析', '文风', 'create_style_template', '分析.*风格', '风格模板', '上传.*分析', '分析.*[文风风格]', '这段.*风格'],
  category: 'style',
  workflow: {
    description:
      '## 风格模板 — 26维完整清单\n\n' +
      '模板为 YAML，存储在 style_templates/。\n' +
      '必填: name, type(17种之一), dimensions, worldType, tone\n\n' +
      '### dimensions 格式\n' +
      '每维度: {"description":"100-300字分析","examples":["原文例句≥3"],"writingRules":["规则≥3"],"vocabularyList":["词≥10"]}\n\n' +
      '### 全部 26 维度（英文key，中文名仅供参考）\n\n' +
      '✅ 必填11维 — 任何小说都必须分析\n' +
      'narrativeTone | 叙事基调 | 情感底色/叙述者态度/语言与内容反差/氛围底色\n' +
      'sentenceStyle | 句式 | 长短句字数范围与功能/交替模式/标点习惯/段落结构\n' +
      'vocabularyStyle | 词汇 | 文白比例/高频词类/成语典故/自造词系统\n' +
      'rhetoricStyle | 修辞 | 比喻类型与频率/排比模式/通感手法\n' +
      'rhythmStyle | 节奏 | 场景切换频率/快慢段落比例/高潮篇幅占比\n' +
      'dialogueStyle | 对话 | 对白占比/语气风格/不同人物语言差异\n' +
      'moodStyle | 氛围 | 情绪基调/色调偏好/环境与心理的映射关系\n' +
      'perspectiveStyle | 视角 | 人称与视角类型/切换频率/内心独白占比\n' +
      'bodyLanguageStyle | 身体描写 | 部位描写频率排序/扫描顺序/解剖精度\n' +
      'sensoryStyle | 感官 | 五感比例/感官打包模式/感官词汇库(气味/触觉/温度/声音/视觉)\n' +
      'descriptionPattern | 描写结构 | 场景描写固定顺序/人物出场模板/描写密度曲线\n\n' +
      '🔍 有证据才填 — 原文找≥2处证据则详析；无证据跳过\n' +
      'tensionStyle | 心理张力 | 内心矛盾核心对立/身体反应展现/张力升级模式\n' +
      'compoundWordPattern | 自造复合词 | 复合形容词公式/造词频率/自造词分类体系\n' +
      'onomatopoeiaSystem | 拟声词 | 拟声词清单/重复模式/段落位置与排版格式\n\n' +
      '🔞 情色专属 — type=情色小说时必填\n' +
      'corruptionArc | 堕落弧线 | 人物演变阶梯\n' +
      'degradationRitual | 调教机制 | 场景结构模板\n' +
      'narrativeVoice | 叙事声音 | 极淫内容平淡叙事反差\n' +
      'shameVoyeurLoop | 羞耻循环 | 羞耻→兴奋的触发与反馈\n' +
      'sensoryPackFormula | 感官打包 | 多感官句标准句型模板\n' +
      'bodyMindBetrayal | 身心背离 | 身体背叛意志的句式/转折点\n' +
      'humiliationTemplate | 羞辱模板 | 递进阶段/各阶段字数/升级方式\n\n' +
      '📖 类型专属 — 仅匹配该类型时分析\n' +
      'cultivationCombat | 修炼战斗 | 修仙/武侠/玄幻\n' +
      'romanceArc | 感情线 | 恋爱发展阶段模板\n' +
      'archaicStyle | 古风文言 | 文白比例与称谓系统\n' +
      'suspensePacing | 悬疑节奏 | 伏笔密度与控制\n' +
      'socialRealism | 社会现实 | 阶层标记/都市/历史/科幻\n\n' +
      '### 信号强度分级\n' +
      '★★★强→详填: description200-400字/examples3-5条/writingRules3-5条/vocabularyList10+词\n' +
      '★★中→标准: description100-200字/examples1-2条/writingRules1-2条/vocabularyList3-5词\n' +
      '★弱→简要: description50-100字\n' +
      '☆无→跳过该维度不填\n' +
      '⚠️ 禁止传空dimensions！有信号必须填！vocabularyList≤80词 writingRules≤30条',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取原文（1次，不重读）', argsTemplate: { file_path: '${file_path}' }, optional: false },
      { order: 2, tool: 'create_style_template', purpose: '创建风格模板', argsTemplate: { name: '${name}', type: '${type}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: '11-required-dims', description: '11必填维全部填写(narrativeTone,sentenceStyle,vocabularyStyle,rhetoricStyle,rhythmStyle,dialogueStyle,moodStyle,perspectiveStyle,bodyLanguageStyle,sensoryStyle,descriptionPattern)', severity: 'error', check: '逐一检查' },
    { id: 'no-empty-dims', description: '禁止传空dimensions对象', severity: 'error', check: 'dimensions非空' },
    { id: 'english-keys', description: '维度key必须用英文（narrativeTone等），不能用中文', severity: 'error', check: 'key全英文' },
    { id: 'vocab-limit', description: 'vocabularyList≤80词 writingRules≤30条', severity: 'warn', check: '长度' },
  ],
  inputSchema: {
    fields: [
      { name: 'file_path', type: 'string', required: true, description: '原文路径' },
      { name: 'name', type: 'string', required: true, description: '模板名' },
      { name: 'type', type: 'enum', required: true, enumValues: ['修仙小说','古风小说','都市小说','奇幻','科幻小说','情色小说','恋爱小说','悬疑小说','历史小说','玄幻小说','灵异小说','轻小说','普通小说','穿越小说','末世小说','游戏小说'], description: '小说类型' },
      { name: 'dimensions', type: 'string', required: true, description: '维度分析对象' },
      { name: 'worldType', type: 'string', required: false, description: '世界观类型' },
      { name: 'tone', type: 'string', required: false, description: '基调' },
    ],
    extractionHint: '提取文件路径、模板名、小说类型。不确定类型先问。',
  },
  examples: [
    { userInput: '分析这段古风武侠的文风，创建风格模板', skillOutput: '模板已创建，26维分析完成', toolCallsExpected: ['read_file', 'create_style_template'] },
  ],
  metadata: { version: '2.1.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
