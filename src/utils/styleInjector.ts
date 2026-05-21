import { styleProjectService, styleTemplateService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import type { StyleProject, StyleProfile, DimAnalysis } from '@/types/story'

// Cache loaded style projects to avoid repeated IPC calls (LRU, max 20)
const MAX_STYLE_CACHE = 20
const styleCache = new Map<string, StyleProject>()

async function getStyleForProject(styleProjectId: string): Promise<StyleProject | null> {
  if (!styleProjectId) return null
  if (styleCache.has(styleProjectId)) {
    const cached = styleCache.get(styleProjectId)!
    styleCache.delete(styleProjectId)
    styleCache.set(styleProjectId, cached)
    return cached
  }
  try {
    const proj = await styleProjectService.loadProject(styleProjectId) as StyleProject
    if (proj?.profile) {
      if (styleCache.size >= MAX_STYLE_CACHE) {
        const firstKey = styleCache.keys().next().value!
        styleCache.delete(firstKey)
      }
      styleCache.set(styleProjectId, proj)
      return proj
    }
  } catch (e) { logError('加载风格项目失败', e) }
  return null
}

// Build the style system prompt addition
export function buildStylePrompt(style: { profile: StyleProfile | null }): string {
  if (!style.profile) return ''
  const f = style.profile.features
  const dims = style.profile.dimAnalyses

  const parts: string[] = []

  // ── V2 Deep Analysis: strict writing constraints (when available) ──
  if (dims && Object.keys(dims).length > 0) {
    // Build vocabulary mandates from all dimension vocabulary lists
    const vocabWords = new Set<string>()
    const writingRules: string[] = []
    const keyDims = ['narrativeTone', 'bodyLanguageStyle', 'sensoryStyle', 'sentenceStyle', 'compoundWordPattern',
                     'onomatopoeiaSystem', 'sensoryPackFormula', 'bodyMindBetrayal', 'humiliationTemplate']

    for (const dk of keyDims) {
      const da: DimAnalysis | undefined = dims[dk]
      if (!da) continue
      if (da.vocabularyList?.length > 0) da.vocabularyList.forEach(w => vocabWords.add(w))
      if (da.writingRules?.length > 0) writingRules.push(...da.writingRules.map(r => `[${dk}] ${r}`))
    }

    if (vocabWords.size > 0) {
      parts.push(`【必须使用的原文词汇库 - 严禁替换为近义词】\n${[...vocabWords].join('、')}`)
    }
    if (writingRules.length > 0) {
      parts.push(`【必须遵守的写作规则 - 逐条执行】\n${writingRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`)
    }
  }

  // ── Scale calibration: explicit extremeness alignment ──
  if (dims && Object.keys(dims).length > 0) {
    // ── Detect world type from vocabulary/sensory patterns ──
    const vocabData = dims?.vocabularyStyle
    const sensoryData = dims?.sensoryStyle
    let worldType = ''
    const fullText = [vocabData?.description||'', sensoryData?.description||''].join(' ')
    if (/教堂|教皇|修女|骑士|神圣|魔法|神教/.test(fullText)) worldType = '西幻（西方奇幻/宗教）'
    else if (/驿站|宰相|剑妃|蛮越|大虞|太和殿/.test(fullText)) worldType = '古代（东方古典/宫廷江湖）'
    else if (/豪车|别墅|直播间|网红|公司|社畜|JK|泳装|情趣/.test(fullText)) worldType = '现代（都市/职场/日常）'
    else if (/妈妈|主人|宝贝|～/.test(fullText) || fullText.includes('♥') || fullText.includes('♪')) worldType = '日系（二次元/萌系/ACG）'

    const calibrationLines: string[] = []
    calibrationLines.push(`【风格尺度校准 - 必须达到的描写密度和极端程度】`)
    if (worldType) calibrationLines.push(`世界观类型: ${worldType}。你的描写必须符合这个世界观的设定逻辑（空间/器物/服饰/社会关系）。`)
    calibrationLines.push(`原文风格已经达到极高的描写密度和内容尺度。你的输出必须做到:`)
    calibrationLines.push(`1. 身体描写密度: 每200字至少包含1次身体部位特写(3种以上感官同时描写)`)
    calibrationLines.push(`2. 拟声词密度: 每300字至少15个拟声/呻吟字符(哦噫齁呜噗卟咕叽)，必须连续重复出现`)
    calibrationLines.push(`3. 体液描写: 每次体液出现必须附带颜色+温度+黏稠度+气味的完整感官信息`)
    calibrationLines.push(`4. 心理描写: 禁止\"她感到羞耻\"等概括句，必须用具象的身体反应(痉挛/喷水/翻眼/吐舌)展示`)
    calibrationLines.push(`5. 用词: 严格使用原文词汇库中的自造复合词，禁止用中性医学词汇替代`)
    calibrationLines.push(`6. 句式: 极长身体描写句(50字+)与极短拟声/动作句(2-5字)交替，每段至少3次交替`)
    calibrationLines.push(`7. 尺度: 你的输出必须在情色淫靡程度上不低于原文——可以更极端、更浓稠、更密集，但绝对不允许比原文更收敛、更含蓄、更素淡。如果你不确定该写到什么程度，就再往前推一步`)
    calibrationLines.push(`8. 禁缩: 禁止在场景结尾"收束"或"降调"——高潮之后可以直接结束，但不可以回到"温馨/温情/清醒"的基调。让读者始终停留在淫靡的氛围中`)
    calibrationLines.push(`9. 段落格式: 正文必须用空行（双换行）分隔自然段。段落长度根据内容需要自由决定——动作/对话可以短到一行，描写/心理可以连写数行。唯一铁律: 禁止全文一堆到底。场景切换、对话轮换、动作转换时必须分段。无需刻意控制每段字数，只求自然的呼吸感`)
    parts.push(calibrationLines.join('\n'))

    // ── Tone enforcement: two-tier architecture (erotic base + analyzed layer) ──
    const toneAnalysis = dims?.narrativeTone
    if (toneAnalysis?.description) {
      const toneWord = toneAnalysis.description.match(/基调[：:]\s*"?([^"\n，。]{2,12})"?/) || []
      const detectedTone = toneWord[1] || ''
      const toneLines: string[] = []
      toneLines.push(`【叙事基调强制约束 - 情色小说双层基调架构】`)
      toneLines.push(`情色小说的基调是双层的：`)
      toneLines.push(`  底层（不可动摇的底色）: 色情淫靡——所有描写必须浸润在淫靡、肉欲、感官过载的氛围中。这不是风格选择，而是类型铁律。`)
      toneLines.push(`  上层（风格辨识度）: ${detectedTone || toneAnalysis.description.slice(0, 120)}`)
      toneLines.push(`写作时：先用色情淫靡的底色铺满每一个段落，然后在上层叠加风格特征。`)
      toneLines.push(`具体规则:`)
      toneLines.push(`1. 每一个场景段落必须同时满足两层：色情淫靡的肉体描写 + ${detectedTone || '分析出的风格'}的叙事语气`)
      toneLines.push(`2. 如果色情淫靡和风格发生冲突——色情淫靡优先。宁可让风格让步，不能让情色描写变素变淡`)
      toneLines.push(`3. 叙述者的语气必须在全文中保持${detectedTone || '分析出的基调'}——不能突然切换成其他语调`)
      toneLines.push(`原文的叙事基调已被分析确定为:`)
      toneLines.push(`  ${toneAnalysis.description.slice(0, 400)}`)
      if (toneAnalysis.writingRules?.length > 0) {
        toneLines.push(`基调维持规则:`)
        toneAnalysis.writingRules.slice(0, 5).forEach((r: string, i: number) => {
          toneLines.push(`  ${i + 1}. ${r}`)
        })
      }
      parts.push(toneLines.join('\n'))
    }

    // ── Expansion mandate: word count + slow-down pacing ──
    const expansionLines: string[] = []
    expansionLines.push(`【篇幅与展开要求 - 用大篇幅详细描写提升模仿程度】`)
    expansionLines.push(`原文风格的核心特征之一是"不疾不徐"——对每个身体部位、每个动作都充分展开，不压缩、不跳跃。你必须做到:`)
    expansionLines.push(`【字数硬约束 - 置于所有写作指令之上】`)
    expansionLines.push(`1. 绝对底线: 总字数不得少于 4500 字。4500 字以下是废稿，直接重写。力争 6000-10000 字。`)
    expansionLines.push(`2. 写完自查: 写完后自己数一下——如果不足 4500 字，必须继续写，追加更多身体特写段落直到达标。每追加一个身体部位特写至少 200 字。`)
    expansionLines.push(`3. 字数只能多不能少。6000 字比 4500 字好，8000 字比 6000 字好，10000 字比 8000 字好。永远不要担心"写太多"。`)
    expansionLines.push(`4. 禁止以下凑字数手段: 重复对话、无意义的呻吟拟声词堆砌、完全相同的形容词循环。多出来的字数必须来自新的身体细节、新的视角切换、新的环境情色化描写。`)
    expansionLines.push(`---`)
    expansionLines.push(`6. 角色展开: 每个出场角色至少用200-300字逐层描写其身体(整体轮廓→局部特写→微观细节)。不同角色必须有差异化的身体特征(年龄/体型/疤痕/纹路/毛发)`)
    expansionLines.push(`7. 动作展开: 每个身体接触动作必须写触感+温度+力度+持续时长，禁止\"她舔了他\"这种概括句`)
    expansionLines.push(`8. 微观解剖: 口腔内部/皮肤纹理/毛发细节/分泌物等日常写作不会触及的层面，至少各展开150字`)
    expansionLines.push(`9. 节奏控制: 每段身体描写后插入50-100字的纯叙述过渡(环境描写/心理活动/对话)，模拟原文从容不迫的呼吸感`)
    expansionLines.push(`10. 禁止跳过: 禁止用\"其他修女也……\"\"等等\"\"之类的\"等概括句式跳过细节——每个角色、每个动作都必须单独展开描写`)
    expansionLines.push(`11. 身体描写长句: 全文至少包含5处150字以上的纯身体描写长句，每句堆叠3-5种感官`)
    parts.push(expansionLines.join('\n'))

    // ── Character architecture: per-character differentiation (multi-person scenes) ──
    const charLines: string[] = []
    charLines.push(`【角色构架要求 - 多人场景必须逐人展开】`)
    charLines.push(`多人场景是检验风格模仿的关键考场。你必须做到:`)
    charLines.push(`1. 人物名片: 每个出场角色必须有独立的"身体名片"——年龄/体型/毛发颜色与状态/皮肤质感/疤痕或痣/独特体味。不同角色之间的身体特征必须有显著差异，不能重复`)
    charLines.push(`2. 出场顺序: 按身体特征从温和到极端依次展开（最普通的先出场，最夸张的压轴），形成递进式冲击`)
    charLines.push(`3. 差异化描写: 同一身体部位在不同角色身上必须用不同的形容词。如果A的乳房是"腻白乳肉肥硕花白"，B的就应该是"褐色巨乳布满青筋"。禁止使用相同形容词描述不同人物`)
    charLines.push(`4. 年龄梯度: 如果有多个角色，必须涵盖至少两个年龄层（如熟女+少女/老妇+少妇），形成身体衰老或发育的对比`)
    charLines.push(`5. 每个角色至少获得200字专属描写空间，禁止合并描写("她们都……")`)
    parts.push(charLines.join('\n'))

    // ── Costume as erotic prop: clothing/undressing requirements ──
    const costumeLines: string[] = []
    costumeLines.push(`【服装情色功能要求 - 服装不是背景，是情色道具】`)
    costumeLines.push(`原文中服装承担重要的情色叙事功能。你必须做到:`)
    costumeLines.push(`1. 服装描述: 每个角色的服装至少用100字描写（材质/颜色/剪裁/开衩位置/透明程度/如何勾勒身体曲线）`)
    costumeLines.push(`2. 脱衣仪式: 脱衣过程必须逐件、逐层描写（第一颗纽扣→肩带滑落→布料垂坠→肌肤渐露），禁止"她脱掉了衣服"这种概括句。每脱一件至少50字`)
    costumeLines.push(`3. 服装与身体的互动: 描写布料如何勒入皮肤、蕾丝边缘如何在肌肤上留下印痕、紧绷处如何透出肉色、汗湿后布料如何变得半透明`)
    costumeLines.push(`4. 服装的情色功能化: 丁字裤/胯帘/开档/皮扣项圈/Y字开叉/透明蕾丝等服装必须作为"性行为的道具"而非单纯衣着来描写`)
    costumeLines.push(`5. 高跟鞋/丝袜/手套: 这些配饰必须获得独立描写段落（白丝勒出的腿根肉痕、高跟鞋的细跟踩地的声音、手套指尖的触感传递）`)
    parts.push(costumeLines.join('\n'))

    // ── Micro-movement decomposition: ban summary verbs ──
    const microLines: string[] = []
    microLines.push(`【动作微观分解要求 - 禁止概括动词，必须逐帧展开】`)
    microLines.push(`原文的"色情感"来源于对每一个微小动作的极致放大。你必须做到:`)
    microLines.push(`1. 禁止概括动词: 禁止"她舔了他""她含住""她插进去"等一笔带过的概括句。每个动作必须分解为: 起始姿态→接近过程→接触瞬间的触感(温度/湿度/软硬)→力度变化→持续时长→对方的身体反应`)
    microLines.push(`2. 口腔内部描写: 口交场景必须描写: 嘴唇的触感→舌头探出的动作→舌尖触碰的精确位置→唾液分泌量→口腔温度→舌下腺/舌面纹理→喉咙深度→对方在口腔内的感官体验。至少300字`)
    microLines.push(`3. 性器官接触描写: 插入场景必须描写: 对准的姿态→龟头碰触阴唇/肛口的第一触感→逐寸撑开的过程(每一寸的紧度和湿润度)→完全没入的包裹感→抽送时内壁褶皱的摩擦细节→分泌物的颜色/黏稠度/温度/气味。至少400字`)
    microLines.push(`4. 手指/手掌动作: 每个抚摸动作必须写: 用哪根手指→触碰哪个精确位置→力度(轻如羽毛还是重如碾压)→手指停留的时长→移动的轨迹→对方的皮肤反应(起鸡皮/颤抖/收缩)`)
    microLines.push(`5. 全身同时描写: 多人场景中必须交替描写不同角色在同一时刻的不同动作，形成"同时性"的感官交叠——A在做什么的同时B在做什么，两种触感叠加在同一人身上`)
    microLines.push(`6. 禁止跳过快感: 每个动作必须跟随后续的身体反应描写，不能只写动作不写感受`)
    microLines.push(`7. 情色程度只增不减: 场景从头到尾，描写密度和淫靡程度必须持续攀升或至少维持峰值，禁止出现\"逐渐平静\"\"慢慢缓过来\"\"回到现实\"等降调段落。最极端的高潮之后直接戛然而止，好过用温馨收尾稀释淫靡感`)
    parts.push(microLines.join('\n'))
  }

  // ── V1 String descriptions (always included for backward compat) ──
  parts.push(`【写作风格要求 - 优先级高于角色设定】\n${style.profile.fullDescription}`)

  if (!dims || Object.keys(dims).length === 0) {
    // Old format: just list string descriptions
    parts.push(`\n详细特征:\n- 句式: ${f.sentenceStyle}\n- 词汇: ${f.vocabularyStyle}\n- 修辞: ${f.rhetoricStyle}\n- 节奏: ${f.rhythmStyle}\n- 对话: ${f.dialogueStyle}\n- 氛围: ${f.moodStyle}\n- 视角: ${f.perspectiveStyle}\n- 身体: ${f.bodyLanguageStyle}\n- 感官: ${f.sensoryStyle}\n- 张力: ${f.tensionStyle}\n- 暗示: ${f.subtextStyle}`)
  }

  // If description pattern exists, add structural constraints
  const dp = style.profile?.features?.descriptionPattern
  if (dp && dp.bodyOrder?.length > 0) {
    const s: string[] = [`【描写结构要求 - 必须严格遵守】`]
    s.push(`女性角色首次出场时，按以下顺序扫描描写: ${dp.bodyOrder.join(' → ')}`)
    if (dp.sections?.length > 0) {
      const rules = dp.sections.filter(x => x.part && x.details?.length > 0).map(x => `${x.part}(至少${x.sentenceCount || '1-2句'}: ${x.details.join('、')})`)
      if (rules.length > 0) s.push(`各部位要求: ${rules.join('; ')}`)
    }
    if (dp.detailFingerprints?.length > 0) s.push(`指纹细节: ${dp.detailFingerprints.join('、')}`)
    if (dp.stockingDetail) s.push(`丝袜描写: ${dp.stockingDetail}`)
    if (dp.characterVisualProfile) s.push(`角色视觉配置: ${dp.characterVisualProfile}`)
    parts.push(s.join('\n'))
  }

  // Corruption arc
  const ca = style.profile?.features?.corruptionArc
  if (ca && ca.overallTrajectory) {
    const s: string[] = [`【角色堕落弧线 - 必须遵守的进展阶梯】`]
    s.push(`整体轨迹: ${ca.overallTrajectory}`)
    if (ca.characterStates?.length > 0) {
      ca.characterStates.forEach(cs => {
        s.push(`${cs.characterName}: ${cs.originalState} → ${cs.currentState} (${(cs.progressionSteps || []).join(' → ')})`)
      })
    }
    s.push(`注意：角色状态必须随章节推进沿弧线变化，不能跳跃式堕落`)
    parts.push(s.join('\n'))
  }

  // Degradation ritual
  const dr = style.profile?.features?.degradationRitual
  if (dr && (dr.sceneTemplate?.length > 0 || dr.authorityEntryPattern)) {
    const s: string[] = [`【羞辱场景剧本 - 必须使用此叙事结构】`]
    if (dr.sceneTemplate?.length > 0) s.push(`场景步骤: ${dr.sceneTemplate.join(' → ')}`)
    if (dr.authorityEntryPattern) s.push(`权威入场: ${dr.authorityEntryPattern}`)
    if (dr.punishmentTools?.length > 0) s.push(`惩罚工具: ${dr.punishmentTools.join('、')}`)
    if (dr.audienceInvolvement) s.push(`观众介入: ${dr.audienceInvolvement}`)
    if (dr.surrenderConfirmation) s.push(`屈服确认句式: ${dr.surrenderConfirmation}`)
    parts.push(s.join('\n'))
  }

  // Narrative voice
  const nv = style.profile?.features?.narrativeVoice
  if (nv && (nv.toneContrast || nv.internalMonologueRatio)) {
    const s: string[] = [`【叙事声音要求 - 决定整体阅读感受】`]
    if (nv.toneContrast) s.push(`语态反差: ${nv.toneContrast}`)
    if (nv.internalMonologueRatio) s.push(`内心独白: ${nv.internalMonologueRatio}`)
    if (nv.worldBuildingStyle) s.push(`世界设定交代方式: ${nv.worldBuildingStyle}`)
    if (nv.routineCatalog) s.push(`日常编目: ${nv.routineCatalog}`)
    if (nv.powerResignation) s.push(`面对压迫/无力时的心理模式: ${nv.powerResignation}`)
    parts.push(s.join('\n'))
  }

  // Scene mechanics
  const sm = style.profile?.features?.sceneMechanics
  if (sm && (sm.sensoryCounterpoint || sm.symbolicTool)) {
    const s: string[] = [`【场景装置要求】`]
    if (sm.sensoryCounterpoint) s.push(`感官对位: ${sm.sensoryCounterpoint}`)
    if (sm.symbolicTool) s.push(`象征工具: ${sm.symbolicTool}`)
    if (sm.recurringVisualFormula) s.push(`视觉定型模板: ${sm.recurringVisualFormula}`)
    parts.push(s.join('\n'))
  }

  // Identity dissolution (merged into corruptionArc or standalone)
  const idis = style.profile?.features?.identityDissolution
  if (idis && (idis.replacementIdentity || idis.correctionFrame || idis.hierarchyStructure)) {
    const s: string[] = [`【身份系统与等级层级】`]
    if (idis.preExistingIdentity) s.push(`旧身份: ${idis.preExistingIdentity}`)
    if (idis.replacementIdentity) s.push(`新身份: ${idis.replacementIdentity}`)
    if (idis.selfGaslightingPattern) s.push(`自我合理化: ${idis.selfGaslightingPattern}`)
    if (idis.competitiveAbasement) s.push(`竞相自贬: ${idis.competitiveAbasement}`)
    if (idis.correctionFrame) s.push(`管教框架: ${idis.correctionFrame}`)
    if (idis.hierarchyStructure) s.push(`等级层级: ${idis.hierarchyStructure}`)
    parts.push(s.join('\n'))
  }

  // Shame-voyeur loop
  const svl = style.profile?.features?.shameVoyeurLoop
  if (svl && svl.triggerPattern) {
    const s: string[] = [`【羞耻-窥视心理循环 - 情感引擎】`]
    if (svl.triggerPattern) s.push(`触发: ${svl.triggerPattern}`)
    if (svl.excitementResponse) s.push(`兴奋: ${svl.excitementResponse}`)
    if (svl.shameLayer) s.push(`羞耻: ${svl.shameLayer}`)
    if (svl.feedbackAmplification) s.push(`闭环: ${svl.feedbackAmplification}`)
    parts.push(s.join('\n'))
  }

  return parts.join('\n')
}

// Convert a StyleTemplate to the internal format buildStylePrompt expects
export function convertTemplateToProfile(template: {
  fullDescription?: string
  tone?: { word: string; description: string; attitude: string }
  dimensions?: Record<string, any>
}): { profile: StyleProfile } {
  const dims = template.dimensions || {}
  const features = {
    sentenceStyle: '', vocabularyStyle: '', rhetoricStyle: '', rhythmStyle: '',
    dialogueStyle: '', moodStyle: '', perspectiveStyle: '', bodyLanguageStyle: '',
    sensoryStyle: '', tensionStyle: '', subtextStyle: '',
    descriptionPattern: null as any, corruptionArc: null as any,
    degradationRitual: null as any, narrativeVoice: null as any,
    sceneMechanics: null as any, somaticTension: null as any,
    identityDissolution: null as any, shameVoyeurLoop: null as any,
  }
  for (const [k, v] of Object.entries(dims)) {
    (features as any)[k] = (v as any)?.description || ''
  }

  // Inject tone into narrativeTone if present
  const dimAnalyses = { ...dims }
  if (template.tone?.word && !dimAnalyses['narrativeTone']) {
    dimAnalyses['narrativeTone'] = {
      description: `基调: ${template.tone.word} — ${template.tone.description || ''}`,
      examples: [],
      writingRules: [`维持"${template.tone.word}"的叙事基调`, `叙事态度: ${template.tone.attitude}`],
      vocabularyList: [],
    }
  }

  const profile: StyleProfile = {
    features,
    fullDescription: template.fullDescription || template.tone?.description || '',
    dimAnalyses: Object.keys(dimAnalyses).length > 0 ? dimAnalyses : undefined,
    excerpts: [],
    analyzedAt: '',
    analyzedChapterCount: 1,
  }
  return { profile }
}

// Get style injection from a template ID (replacement for old getStyleInjection)
export async function getTemplateInjection(templateId: string): Promise<string | null> {
  if (!templateId) return null
  try {
    const template = await styleTemplateService.read(templateId) as any
    if (!template) return null
    const profileWrapper = convertTemplateToProfile(template)
    return buildStylePrompt(profileWrapper)
  } catch { return null }
}

/** @deprecated — Use getTemplateInjection or direct template selection instead */
export async function getStyleInjection(targetProjectId: string, styleAssignments: Record<string, string>): Promise<string | null> {
  const styleId = styleAssignments[targetProjectId]
  if (!styleId) {
    logError('风格注入跳过: 当前项目未绑定风格档案', { targetProjectId })
    return null
  }
  const style = await getStyleForProject(styleId)
  if (!style) {
    logError('风格注入跳过: 风格档案加载失败或未完成AI总结', { styleId })
    return null
  }
  return buildStylePrompt(style)
}
