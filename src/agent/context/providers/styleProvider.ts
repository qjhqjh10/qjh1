import type { ContextProvider } from '../ContextAssembler'

export const styleProvider: ContextProvider = {
  domain: 'style',
  relevance: (userMessage) => {
    if (/风格|文风|笔风|写作风格|style|风格分析|语调|叙事/.test(userMessage)) return 0.9
    if (/创建.*风格模板|分析.*风格|提取.*风格/.test(userMessage)) return 1.0
    return 0.2
  },

  buildContext: async () => ({
    domain: 'style',
    priority: 75,
    estimatedTokens: 550,
    content: [
      '## 风格分析 (26 维度)',
      '风格模板存储在 style_templates/ 目录，使用 create_style_template 工具创建。',
      '',
      '26 个分析维度:',
      '视角(第几人称)/叙事距离/句式风格/段落密度/节奏/',
      '对话占比/内心描写/感官侧重/词汇丰富度/修辞手法/',
      '幽默类型/悲剧氛围/悬疑营造/恐怖手法/动作描写/',
      '景物描写/情感表达/角色刻画/世界观融入/口语化程度/',
      '古风词频/现代词频/诗文化用/典故密度/留白程度/细节描写量/',
      '',
      '创建模板流程:',
      '1. 先 read_file 查看原作文本',
      '2. 逐维度分析，有信号则填写 analysis + examples + writingRules',
      '3. 无信号的维度跳过（不要编造）',
      '4. 调用 create_style_template(name, type, worldType, description, dimensions, ...)',
      '',
      'dimensions 格式: {"维度名":{"description":"...","examples":["例句"],"writingRules":["规则"]}}',
    ].join('\n'),
  }),
}
