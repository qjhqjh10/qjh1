import type { ToolDefinition } from '../ToolRegistry'
import type { StyleTemplate } from '@/types/styleTemplate'
import type { DimAnalysis } from '@/types/story'

export const templateTools: ToolDefinition[] = [
  {
    schema: {
      name: 'create_style_template',
      description: '创建风格模板并保存到模板库。使用前必须先 read_file 读取原文内容，逐段分析后提取各维度特征。dimensions 必须使用精确的英文维度key（见下方分层清单），每个维度含 description(100-300字)/examples(≥3个原文摘录)/writingRules(≥3条)/vocabularyList(≥10词)。原文有信号→必须详填；无信号→跳过不填。\n\n【维度分层清单-仅用这些key】\n✅必填: narrativeTone sentenceStyle vocabularyStyle rhetoricStyle rhythmStyle dialogueStyle moodStyle perspectiveStyle bodyLanguageStyle sensoryStyle descriptionPattern\n🔍有证据则填: tensionStyle compoundWordPattern onomatopoeiaSystem\n🔞情色专属(情色小说必填): corruptionArc degradationRitual narrativeVoice shameVoyeurLoop sensoryPackFormula bodyMindBetrayal humiliationTemplate\n📖类型专属: socialRealism cultivationCombat romanceArc archaicStyle suspensePacing',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '小说类型(17种之一)' },
          worldType: { type: 'string', description: '世界观类型(可选)' },
          description: { type: 'string', description: '简短描述(可选)' },
          fullDescription: { type: 'string', description: '完整风格综述(可选)' },
          dimensions: { type: 'object', description: '各维度分析。格式: {"维度key":{"description":"100-300字分析","examples":["原文例句"...],"writingRules":["规则"...],"vocabularyList":["词"...]}}。vocabularyList和writingRules必须在每个维度内部，不要放在顶层！' },
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
        if (typeof dims === 'string') { try { dims = JSON.parse(dims) } catch { return { status: 'error', summary: 'dimensions JSON 格式错误' } } }
        if (!dims || typeof dims !== 'object' || Array.isArray(dims)) {
          return { status: 'error', summary: 'dimensions 必须是一个对象。格式: {"维度key":{"description":"...","examples":[...],"writingRules":[...],"vocabularyList":[...]}}' }
        }
        // Validate each dimension has the required sub-fields
        for (const [key, val] of Object.entries(dims as Record<string,any>)) {
          if (!val || typeof val !== 'object') {
            return { status: 'error', summary: `维度 ${key} 的值必须是对象{description,examples,writingRules,vocabularyList}` }
          }
        }

        // Collect vocabulary and rules from ALL dimensions (for template-level aggregation)
        const allVocab: string[] = []
        const allRules: string[] = []
        for (const val of Object.values(dims as Record<string,any>)) {
          if (Array.isArray(val.vocabularyList)) allVocab.push(...val.vocabularyList.map(String))
          if (Array.isArray(val.writingRules)) allRules.push(...val.writingRules.map(String))
        }

        const tmpl: StyleTemplate = {
          name: String(args.name || '未命名模板'),
          type: String(args.type || '普通小说') as StyleTemplate['type'],
          worldType: String(args.worldType || ''),
          description: String(args.description || ''),
          fullDescription: String(args.fullDescription || args.description || ''),
          dimensions: dims as Record<string, DimAnalysis>,
          vocabularyList: allVocab,
          writingRules: allRules,
          tone: {} as any,
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
      description: '创建场景模板并保存到场景工坊。根据细纲或上传文件分析创建。能推断的字段直接填值，无法确定的字段名列入 autoFields。先 read_file 读细纲JSON了解需求。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '小说类型。有效值: 情色小说|奇幻|都市小说|修仙小说|武侠小说|恋爱小说|古风小说|悬疑小说|历史小说|科幻小说|玄幻小说|灵异小说|轻小说|普通小说|穿越小说|末世小说|游戏小说' },
          // 通用场景字段
          sceneType: { type: 'string', description: '日常|战斗|对话|内心独白|过渡|高潮|情色' },
          conflictType: { type: 'string', description: '冲突类型' },
          scenePurpose: { type: 'array', items: { type: 'string' }, description: '场景目的' },
          characters: { type: 'array', items: { type: 'object', properties: { characterId: {type:'string'}, characterName: {type:'string'}, emotion: {type:'string'} } }, description: '出场角色及情绪。每项: {characterId,characterName,emotion}' },
          location: { type: 'string', description: '场景地点+描述' },
          time: { type: 'string', description: '时间' },
          weather: { type: 'string', description: '天气' },
          atmosphere: { type: 'string', description: '氛围描述' },
          wordTarget: { type: 'number', description: '目标字数' },
          narrativePOV: { type: 'string', description: '叙事视角' },
          pacing: { type: 'string', description: '节奏控制' },
          bodyLanguage: { type: 'string', description: '肢体语言描写重点' },
          detail: { type: 'string', description: '详细场景配置(Markdown)' },
          extraNote: { type: 'string', description: '额外要求' },
          autoFields: { type: 'array', items: { type: 'string' }, description: '把握不好、无法确定的字段名列表。这些字段将显示AI自动按钮，用户可一键自动填充。不确定的字段优先列入此数组，不要强行填值。' },
          // 情色场景字段（情色类型时填写）
          intensity: { type: 'number', description: '情色浓度1-5' },
          selectedKinks: { type: 'array', items: { type: 'string' }, description: '玩法标签' },
          opening: { type: 'array', items: { type: 'string' }, description: '开场阶段动作/心理描写要点' },
          climax: { type: 'array', items: { type: 'string' }, description: '高潮阶段描写要点' },
          aftermath: { type: 'array', items: { type: 'string' }, description: '余韵阶段描写要点' },
          soundDensity: { type: 'string', description: '声音密度: 低|中|高|极高' },
          moanStyle: { type: 'string', description: '呻吟风格描述' },
          degradeLangs: { type: 'array', items: { type: 'string' }, description: '羞辱语言清单' },
          bodyFluidFocus: { type: 'array', items: { type: 'string' }, description: '体液描写重点' },
          bodyPartFocus: { type: 'array', items: { type: 'string' }, description: '身体部位描写重点' },
          tactileFocus: { type: 'array', items: { type: 'string' }, description: '触觉描写重点' },
          sensoryAnchors: { type: 'string', description: '感官锚点描述' },
          dominantEmotion: { type: 'string', description: '主导情绪' },
          emotionCurveInput: { type: 'string', description: '情绪曲线描述' },
          // 场景剧情字段
          plotOverview: { type: 'string', description: '场景剧情概述(200-500字)' },
          sceneTurningPoint: { type: 'string', description: '场景转折点描述' },
          props: { type: 'string', description: '场景道具清单' },
          appearance: { type: 'string', description: '人物外貌描述' },
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
        const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(x => String(x)) : []
        const str = (v: unknown, d = ''): string => typeof v === 'string' ? v : (v ? String(v) : d)
        // Full config with ALL fields the GUI expects (matches EroticSceneConfig)
        const config: Record<string, unknown> = {
          sceneType: str(args.sceneType, '日常'),
          scenePurpose: arr(args.scenePurpose),
          conflictType: str(args.conflictType, '无冲突'),
          povCharacterId: '', povCharacterName: '',
          // characters: array of {characterId,characterName,emotion} or convert from string
          characters: (() => {
            const c = args.characters
            if (Array.isArray(c)) return c.map((x: any) => typeof x === 'object' ? x : { characterId: '', characterName: String(x), emotion: '' })
            if (typeof c === 'string' && c.trim()) return c.split(/[；;]/).map(s => s.trim()).filter(Boolean).map(s => {
              const m = s.match(/^(.+?)[:：](.+)$/)
              return m ? { characterId: '', characterName: m[1], emotion: m[2] } : { characterId: '', characterName: s, emotion: '' }
            })
            return []
          })(),
          location: str(args.location),
          time: str(args.time, '不限'),
          weather: str(args.weather, '不限'),
          atmosphere: str(args.atmosphere, '不限'),
          publicity: '私密',
          wordTarget: Number(args.wordTarget) || 3000,
          narrativePOV: str(args.narrativePOV, '第三人称'),
          pacing: str(args.pacing, '渐进'),
          bodyLanguage: str(args.bodyLanguage),
          detail: str(args.detail),
          extraNote: str(args.extraNote),
          autoFields: (() => { const f = arr(args.autoFields); if (f.length === 0) return {}; const o: Record<string,boolean> = {}; for (const x of f) o[x] = true; return o })(),
          intensity: Number(args.intensity || args.eroticIntensity || 0),
          selectedKinks: arr(args.selectedKinks),
          kinkNote: '',
          opening: arr(args.opening),
          mainPose: '', mainRhythm: '', poseChanges: '',
          climax: arr(args.climax),
          aftermath: arr(args.aftermath),
          soundDensity: str(args.soundDensity),
          moanStyle: str(args.moanStyle),
          degradeLangs: arr(args.degradeLangs),
          streamMode: true, replaceMode: true, useStyleProfile: true, useChapterOutline: true,
          kinkIntensities: {}, customKink: '', customCharacters: [],
          customLocation: '', customTime: '', customAtmosphere: '', customPublicity: '',
          extraPhases: [], customInsults: '', bannedWords: '',
          customPoses: [], customRhythms: [], customPOVs: '',
          customOpening: [], customClimax: [], customAftermath: [], customDegradeLangs: [],
          bodyFluidFocus: arr(args.bodyFluidFocus),
          bodyPartFocus: arr(args.bodyPartFocus),
          tactileFocus: arr(args.tactileFocus),
          narrativeStyle: '', timeCompression: '', introspection: '',
          sensoryAnchors: str(args.sensoryAnchors),
          dominantEmotion: str(args.dominantEmotion),
          emotionCurveInput: str(args.emotionCurveInput),
          triggerWords: '', worldRules: '', propList: '', costumeList: '',
          customExtraNotes: '', customEmotions: '', customCurves: '', customTriggers: '',
          customWorldRules: '', customPropLists: '', customCostumeLists: '',
          customPoseChanges: '', customSoundDensity: '', customMoanStyle: '',
          consentDynamic: '', aftercareDetail: '',
          senses: arr(args.senses || ['视觉','听觉','触觉']),
          dialogueRatio: '', subtextLevel: '', sentenceStyle: '', paragraphDensity: '',
          emotionStart: '', emotionEnd: '', props: '', appearance: '',
          foreshadowUse: '', sceneTurningPoint: '', plotOverview: str(args.plotOverview),
        }
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
