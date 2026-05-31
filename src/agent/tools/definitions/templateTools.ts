import type { ToolDefinition } from '../ToolRegistry'
import type { StyleTemplate } from '@/types/styleTemplate'
import type { DimAnalysis } from '@/types/story'

export const templateTools: ToolDefinition[] = [
  {
    schema: {
      name: 'create_style_template',
      description: '创建风格模板并保存到模板库。何时使用：分析完文本的26个文风维度后，将结果保存为模板。dimensions 是各维度的分析结果对象，每个维度含 description/examples/writingRules/vocabularyList。有信号的维度详填，无信号的跳过。tone 含 word/description/attitude。不确定时先 read_file 参考已有模板。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '小说类型' },
          worldType: { type: 'string', description: '世界观类型' },
          description: { type: 'string', description: '简短描述' },
          fullDescription: { type: 'string', description: '完整风格综述（可选）' },
          dimensions: { type: 'object', description: '各维度分析结果' },
          vocabularyList: { type: 'array', items: { type: 'string' }, description: '词汇清单' },
          writingRules: { type: 'array', items: { type: 'string' }, description: '写作规则' },
          tone: { type: 'object', description: '叙事基调' },
        },
        required: ['name', 'type', 'dimensions'],
      },
    },
    permission: 'READ_ASK',
    category: 'template',
    availableInPlanMode: true,
    executor: async (args) => {
      try {
        const { styleTemplateService } = await import('@/services/fileService')
        let dims = args.dimensions || {}
        if (typeof dims === 'string') { try { dims = JSON.parse(dims) } catch { /* keep */ } }
        let tone = args.tone || {}
        if (typeof tone === 'string') { try { tone = JSON.parse(tone) } catch { /* keep */ } }
        const rules = ((args.writingRules as unknown[]) || []).map((r: unknown) => Array.isArray(r) ? (r as string[])[0] || '' : String(r))

        const tmpl: StyleTemplate = {
          name: String(args.name || '未命名模板'),
          type: String(args.type || '普通小说') as StyleTemplate['type'],
          worldType: String(args.worldType || ''),
          description: String(args.description || ''),
          fullDescription: String(args.fullDescription || args.description || ''),
          dimensions: dims as Record<string, DimAnalysis>,
          vocabularyList: (Array.isArray(args.vocabularyList) ? args.vocabularyList : []) as string[],
          writingRules: rules,
          tone: tone as { word: string; description: string; attitude: string },
          source: 'ai-generated',
          createdAt: '', updatedAt: '',
          id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        } as StyleTemplate
        const saved = await styleTemplateService.save(tmpl)
        return { status: 'success', summary: `已创建风格模板: ${saved.name || tmpl.name}`, detail: `模板ID: ${saved.id}` }
      } catch (e) { return { status: 'error', summary: `创建风格模板失败: ${e instanceof Error ? e.message : '未知错误'}` } }
    },
  },
  {
    schema: {
      name: 'create_scene_template',
      description: '创建场景模板并保存到场景工坊。何时使用：根据细纲或上传文件分析创建场景配置时。能推断的字段直接填值，无法确定的字段名列入 autoFields 数组（不超过10个）。先 read_file 读细纲JSON了解场景需求。与风格模板的区别：场景模板管"这一章怎么写"，风格模板管"整体用什么文风"。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '小说类型' },
          plotOverview: { type: 'string', description: '剧情概述（150-300字）' },
          sceneType: { type: 'string', description: '场景类型: 日常/战斗/对话/内心独白/过渡/高潮/情色' },
          conflictType: { type: 'string', description: '冲突类型' },
          scenePurpose: { type: 'array', items: { type: 'string' }, description: '场景目的' },
          characters: { type: 'string', description: '出场角色及情绪状态' },
          location: { type: 'string', description: '场景地点' },
          time: { type: 'string', description: '时间' },
          weather: { type: 'string', description: '天气' },
          atmosphere: { type: 'string', description: '氛围' },
          wordTarget: { type: 'number', description: '目标字数' },
          narrativePOV: { type: 'string', description: '叙事视角' },
          pacing: { type: 'string', description: '节奏' },
          detail: { type: 'string', description: '详细场景配置（Markdown）' },
          autoFields: { type: 'array', items: { type: 'string' }, description: '设为 AI 自动的字段名列表' },
          extraNote: { type: 'string', description: '额外要求' },
          // Erotic-specific fields
          eroticIntensity: { type: 'number', description: '情色浓度 1-5' },
          selectedKinks: { type: 'array', items: { type: 'string' }, description: '玩法标签' },
          intensity: { type: 'number', description: '浓度（别名）' },
        },
        required: ['name', 'type'],
      },
    },
    permission: 'READ_ASK',
    category: 'template',
    availableInPlanMode: true,
    executor: async (args) => {
      try {
        const { templateService } = await import('@/services/fileService')
        const name = String(args.name || '未命名场景模板')
        const type = String(args.type || '普通小说')
        const config: Record<string, unknown> = {
          sceneType: String(args.sceneType || '日常'),
          conflictType: String(args.conflictType || '无冲突'),
          characters: String(args.characters || ''),
          location: String(args.location || ''),
          time: String(args.time || '不限'),
          weather: String(args.weather || '不限'),
          atmosphere: String(args.atmosphere || '不限'),
          wordTarget: Number(args.wordTarget || 3000),
          narrativePOV: String(args.narrativePOV || '第三人称'),
          pacing: String(args.pacing || '渐进'),
          detail: String(args.detail || ''),
          autoFields: Array.isArray(args.autoFields) ? args.autoFields : [],
        }
        if (args.eroticIntensity) config.intensity = args.eroticIntensity
        if (args.selectedKinks) config.selectedKinks = args.selectedKinks
        const tmpl = {
          id: `sc_${Date.now().toString(36)}`,
          name,
          type,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          config,
          source: 'ai-generated' as const,
        }
        await templateService.save(tmpl as any)
        return { status: 'success', summary: `已创建场景模板: ${name}`, detail: `模板ID: ${tmpl.id}` }
      } catch (e) { return { status: 'error', summary: `创建场景模板失败: ${e instanceof Error ? e.message : '未知错误'}` } }
    },
  },
]
