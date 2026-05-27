// AI prompt builders for novel continuation analysis pipeline

export function buildChapterAnalysisPrompt(
  chapterTitle: string,
  chapterContent: string,
  chapterNumber: number,
  enabledDims?: Set<string>,
): string {
  const dims = enabledDims ?? new Set(CONTINUATION_DIM_KEYS)
  const has = (key: string) => dims.has(key)

  const jsonFields: string[] = []
  if (has('charactersAppeared')) jsonFields.push(`  "charactersAppeared": [{"name":"角色名","role":"男主|女主|男配|女配|反派|其他","importance":100,"action":"本章做了什么","newInfo":"本章新增的信息（无则空）"}]`)
  if (has('plotEvents')) jsonFields.push(`  "plotEvents": ["关键事件1","关键事件2",...]`)
  if (has('foreshadowingPlanted')) jsonFields.push(`  "foreshadowingPlanted": ["本章新埋的伏笔（无则[]）"]`)
  if (has('foreshadowingResolved')) jsonFields.push(`  "foreshadowingResolved": ["本章回收的前文伏笔（无则[]）"]`)
  if (has('worldbuildingRevealed')) jsonFields.push(`  "worldbuildingRevealed": ["本章揭示的新世界观信息（无则[]）"]`)
  if (has('powerSystemMentions')) jsonFields.push(`  "powerSystemMentions": [{"name":"等级体系名称","levels":"涉及的等级","detail":"本章揭示的等级相关信息"}]`)
  if (has('itemsMentioned')) jsonFields.push(`  "itemsMentioned": [{"name":"道具名称","type":"武器|法宝|丹药|功法|道具|其他","ability":"能力/效果","owner":"持有者"}]`)
  if (has('factionsMentioned')) jsonFields.push(`  "factionsMentioned": [{"name":"势力名称","type":"正道|邪道|中立|皇朝|其他","detail":"本章涉及的势力信息"}]`)
  if (has('locationsMentioned')) jsonFields.push(`  "locationsMentioned": [{"name":"地点名称","type":"门派|城池|秘境|自然|其他","detail":"本章涉及的地点信息"}]`)
  if (has('emotionalTone')) jsonFields.push(`  "emotionalTone": "本章情绪基调"`)
  if (has('timelinePosition')) jsonFields.push(`  "timelinePosition": "时间线定位"`)
  if (has('chapterRole')) jsonFields.push(`  "chapterRole": "setup|development|climax|resolution|transition"`)
  if (has('unresolvedQuestions')) jsonFields.push(`  "unresolvedQuestions": ["本章提出但未解答的问题"]`)
  // Snapshots always included if any character/item/faction dimension is enabled
  if (has('charactersAppeared')) jsonFields.push(`  "characterSnapshots": [{"name":"角色名","alive":true,"powerLevel":"当前等级(无则'')","location":"所在位置"}] // alive默认true，仅确认死亡时写false；无状态信息的不输出该角色的snapshot`)
  if (has('itemsMentioned')) jsonFields.push(`  "itemSnapshots": [{"name":"道具名","status":"完好|损坏|丢失|传承|毁灭","owner":"持有者"}]`)
  if (has('factionsMentioned')) jsonFields.push(`  "factionSnapshots": [{"name":"势力名","status":"活跃|削弱|覆灭|转型","leader":"首领(无则'')}"}]`)
  if (has('locationsMentioned')) jsonFields.push(`  "locationSnapshots": [{"name":"地点名","status":"存在|毁灭|废弃","significance":"重要性"}]`)

  const requirements: string[] = []
  if (has('plotEvents')) requirements.push('1. plotEvents 按实际发生的事件列出（过渡章/内心独白章可能仅1-2个事件甚至为空）')
  if (has('charactersAppeared')) requirements.push('2. 角色role+importance标准: 男主=100, 女主=90(可多名), 重要男配=75-85, 重要女配=70-80, 反派按威胁程度=60-90, 其他配角=0-50')
  if (has('charactersAppeared')) requirements.push('3. characterSnapshots: 本章出场或提及的所有角色,标注当前生死状态和等级')
  if (has('itemsMentioned')) requirements.push('4. itemSnapshots: 本章出现或提及的所有道具,标注当前状态')
  if (has('factionsMentioned')) requirements.push('5. factionSnapshots: 本章出现或提及的所有势力,标注当前状态')
  requirements.push('6. 后续章节出现前面的角色/道具/势力时必须继承前面的状态')
  requirements.push('7. 只提取文中明确写出或强烈暗示的信息')

  return `你是一位专业的小说分析师。请分析以下章节，聚焦于"剧情理解"和"设定提取"。输出JSON（不要markdown）：

{
${jsonFields.join(',\n')}
}

要求:
${requirements.join('\n')}

【第${chapterNumber}章】${chapterTitle}
${chapterContent.slice(0, 15000)}`
}

const CONTINUATION_DIM_KEYS = ['charactersAppeared', 'plotEvents', 'foreshadowingPlanted', 'foreshadowingResolved', 'worldbuildingRevealed', 'powerSystemMentions', 'itemsMentioned', 'factionsMentioned', 'locationsMentioned', 'emotionalTone', 'timelinePosition', 'chapterRole', 'unresolvedQuestions']

export function buildAggregationPrompt(chapterAnalyses: string[], totalChapters: number): string {
  return `你是顶级的小说故事分析师。以下是${totalChapters}章小说逐章分析结果的摘要。请基于这些信息，进行全局故事理解。输出JSON：

{
  "characterArcs": [{"name":"角色名","role":"男主|女主|男配|女配|反派|其他","importance":100,"firstAppearance":章号,"lastAppearance":章号,"arcType":"growth|fall|flat|redemption|corruption|unknown","currentState":"当前状态","unresolved":true/false,"predictedDirection":"你的预测走向","personality":"性格特征总结","relationships":"与其他人物的关系"}],
  "mainPlot": "主线一句话概括",
  "subPlots": ["支线1","支线2",...],
  "foreshadowingChain": [{"id":"f_001","description":"伏笔描述","plantedChapter":章号,"resolvedChapter":null或章号,"resolved":true/false,"predictedResolution":"预测回收方式"}],
  "worldRules": ["世界规则1","世界规则2",...],
  "powerSystemFinal": {"name":"等级体系名称","levels":"截至原作结尾已知的等级范围","description":"截至原作结尾的修炼规则"},
  "keyItemsFinal": [{"name":"道具名","type":"类型","ability":"能力","owner":"持有者","status":"截至原作结尾的状态(完好/损坏/丢失/传承等)"}],
  "factionsFinal": [{"name":"势力名","type":"类型","status":"截至原作结尾的状态","relationships":"势力关系"}],
  "locationsFinal": [{"name":"重要地点名","type":"类型","significance":"剧情意义"}],
  "foreshadowingUnresolved": [{"description":"仍未回收的伏笔","plantedChapter":章号,"predictedResolution":"预测如何回收"}],
  "timeline": [{"chapter":章号,"event":"事件","type":"main|sub|character|worldbuilding"}],
  "unresolvedQuestions": ["未解答问题1",...],
  "storyStructure": "threeAct|fiveAct|episodic|other",
  "currentStage": "当前处于故事的哪个阶段",
  "continuationSuggestions": ["续写方向1","方向2","方向3"]
}

【逐章分析摘要】
${chapterAnalyses.join('\n\n')}

要求: 只基于以上摘要中明确存在的信息填写。对于没有数据的字段（如原文无明确势力/道具/地点等），返回空数组[]。不要编造不存在的信息。`}

// Batch aggregation: summarize a group of up to 50 chapters
export function buildBatchSummaryPrompt(
  chapterSummaries: string[],
  batchIndex: number,
  totalBatches: number,
  firstChapter: number,
  lastChapter: number,
  prevEndingState: string,
): string {
  return `你是小说剧情分析专家。以下是一部小说第${firstChapter}-${lastChapter}章的逐章分析摘要（共${totalBatches}批中的第${batchIndex}批）。请对该阶段剧情进行概括。输出JSON：

{
  "stagePlot": "该阶段核心剧情（起因→发展→高潮→阶段结尾，500字内）",
  "characterDevelopment": [{"name":"角色名","firstInStage":章号,"lastInStage":章号,"arcProgress":"该角色在此阶段的弧线推进","statusAtEnd":"阶段结束时角色状态","goalAtEnd":"阶段结束时角色目标"}],
  "majorEvents": ["事件1","事件2",...],
  "foreshadowingSummary": {"newlyPlanted": ["新伏笔"],"resolvedInStage": ["本阶段回收的前文伏笔"],"stillPending": ["仍未解决的伏笔"]},
  "worldbuildingProgress": ["该阶段新增或展开的世界观设定"],
  "powerSystemEvolution": {"systems": [{"name":"体系名","currentLevels":"当前涉及的等级范围","changes":"该阶段的变化"}],"summary":"该阶段等级体系发展概述"},
  "itemsEvolution": {"items": [{"name":"道具名","type":"类型","ability":"能力","owner":"持有者","status":"该阶段状态变化"}],"summary":"该阶段重要道具流转概述"},
  "factionsEvolution": {"factions": [{"name":"势力名","type":"类型","status":"该阶段状态/立场变化","detail":"补充信息"}],"summary":"该阶段势力格局变化概述"},
  "locationsEvolution": {"locations": [{"name":"地点名","type":"类型","role":"该阶段的作用"}],"summary":"该阶段重要地点概述"},
  "emotionalArc": "该阶段整体情绪走向（如：压抑→爆发→平静）",
  "endingCharacterStates": [{"name":"角色名","status":"状态","location":"位置","goal":"当前目标"}],
  "stageTheme": "该阶段的核心主题"
}

${prevEndingState ? `【前一批次结束时的角色状态】\n${prevEndingState}\n` : ''}
【第${firstChapter}-${lastChapter}章逐章摘要】
${chapterSummaries.join('\n\n')}

要求: 只基于摘要中明确存在的信息填写。对于没有数据的字段（如无道具/势力/地点变化），返回空数组[]。不要编造。`}

// Global aggregation: synthesize all batch summaries + deep-dive last 20 chapters
export function buildGlobalAggregationPrompt(
  batchSummaries: string[],
  lastChaptersDetail: string,
  totalChapters: number,
): string {
  return `你是顶级的小说故事分析师。以下是一部${totalChapters}章小说的完整分析资料：

1. 【各阶段剧情摘要】- 覆盖全篇脉络
2. 【最后20章详细分析】- 用于精准把握当前剧情态势

请基于以上信息，进行全局故事理解，并给出续写建议。输出JSON：

{
  "characterArcs": [{"name":"角色名","role":"男主|女主|男配|女配|反派|其他","importance":100,"firstAppearance":章号,"lastAppearance":章号,"arcType":"growth|fall|flat|redemption|corruption|unknown","keyTurningPoints":[{"chapter":章号,"event":"转折事件"}],"currentState":"当前状态","unresolved":true/false,"predictedDirection":"预测走向","personality":"性格特征","relationships":"与其他人物的关系"}],
  "mainPlot": "主线一句话概括",
  "subPlots": ["支线1",...],
  "foreshadowingChain": [...],
  "worldRules": [...],
  "powerSystemFinal": {"name":"体系名","levels":"截至原作结尾的等级范围","description":"截至原作结尾的修炼规则"},
  "keyItemsFinal": [{"name":"道具名","type":"类型","ability":"能力","owner":"持有者","status":"截至原作结尾(完好/损坏/丢失/传承)"}],
  "factionsFinal": [{"name":"势力名","type":"类型","status":"截至原作结尾的状态","relationships":"势力关系"}],
  "locationsFinal": [{"name":"重要地点名","type":"类型","significance":"剧情意义"}],
  "foreshadowingUnresolved": [{"description":"仍未回收的伏笔","plantedChapter":章号,"predictedResolution":"预测回收方式"}],
  "timeline": [...],
  "unresolvedQuestions": [...],
  "storyStructure": "threeAct|fiveAct|episodic|other",
  "currentStage": "当前处于故事的哪个阶段",
  "continuationSuggestions": ["续写方向"]
}

要求:
1. 续写建议必须基于最后20章的剧情态势，不能偏离原作走向
2. 伏笔链优先关注仍未解决的，给出预测回收方式
3. 角色弧线根据各阶段发展完整追踪，标记关键转折，区分主配反
4. 设定总结必须准确反映原作结尾时的状态（已毁道具标记损坏、已灭势力标记消亡、已死角色不可复活）
5. 世界观规则汇总去重

【各阶段剧情摘要】
${batchSummaries.join('\n\n---\n\n')}

【最后20章详细分析】
${lastChaptersDetail}`
}

// Step 4: Plot direction — narrative prose, not JSON structure
export function buildPlotDirectionPrompt(storyUnderstanding: string, lastChaptersDetail: string): string {
  return `你是一位资深的小说续写策划。以下是原作的故事理解和最后章节的详细分析。

请以叙事方式写出续写的整体剧情走向。这不是大纲，不要用分点或结构化的方式。就像作者在笔记本上勾勒后续剧情一样，用连贯的叙事文字描述故事将如何发展。

要求：
1. 从原作结尾处自然衔接，写出8000-12000字的剧情走向
2. 追踪每个主要角色的发展：男主如何→女主如何→反派如何→结局，明确写出每个角色的最终归宿
3. 回收所有未解决的伏笔，明确写出何时、如何回收
4. 严格遵循世界观规则和等级体系：已毁道具不可再使用、已死角色不可复活、等级不可倒退
5. 道具去向明确（损坏的标记为已毁、丢失的不能再出现）
6. 势力关系变化必须有因果逻辑
7. 新增角色/道具/势力必须与原作设定体系兼容
8. 最后一段总结结局方向

【故事理解】
${storyUnderstanding}

【最后20章详细分析】
${lastChaptersDetail}`
}

// Step 4b: Continue plot direction — extend from existing plot
export function buildContinuationPlotPrompt(
  storyUnderstanding: string,
  existingPlot: string,
  lastChaptersDetail: string,
): string {
  return `你是一位资深的小说续写策划。以下是原作的故事理解、最后章节的详细分析，以及已经写好的前半部分剧情走向。

请基于已有的剧情走向**继续向后**写出后续剧情。自然衔接，不要重复已有内容。

要求：
1. 从已有剧情走向的结尾处自然衔接，继续写出8000-12000字的后续剧情
2. 追踪尚未完成的角色弧线，继续向前推进直到各自结局
3. 继续回收剩余的未解决伏笔
4. 严格遵循世界观规则和等级体系
5. 如果已有剧情走向已经接近结局，则写出结局后的收尾内容（如后日谈、角色归宿等）
6. 新增内容与已有剧情走向保持一致的叙事语气和节奏

【故事理解】
${storyUnderstanding}

【已有剧情走向（请从结尾处续写）】
${existingPlot}

【最后20章详细分析】
${lastChaptersDetail}`
}

// Step 5: Outline merge — extend the original 10-tab outline with continuation content
export function buildOutlineMergePrompt(plotDirection: string, storyUnderstanding: string): string {
  return `你是一位小说设定策划专家。以下是原作故事理解和续写剧情走向。

请基于续写剧情走向，为续写部分设计新的大纲元素。这些元素将与原著大纲合并，形成完整的"新大纲"供续写参考。

输出JSON：
{
  "basicSettingUpdate": "续写部分的基础设定描述（承接原作，描述续写开篇时的世界状态）",
  "newWorldRules": ["续写部分新增的世界规则"],
  "existingWorldRules": ["续写中继续适用的原世界规则（简述）"],
  "characters": [
    {"name":"角色名","role":"男主|女主|男配|女配|反派|其他","originalStatus":"原作结尾时状态","newStatus":"续写中的新状态","arc":"续写弧线","ending":"角色结局"}
  ],
  "items": [
    {"name":"道具名","type":"武器|法宝|丹药|功法|道具|其他","ability":"能力","owner":"持有者","previousStatus":"原作结束时的状态","newStatus":"续写中的变化","newAbility":"续写中的新能力（如有）"}
  ],
  "factions": [
    {"name":"势力名","type":"正道|邪道|中立|皇朝|其他","previousStatus":"原作结束时状态","newStatus":"续写中的变化","agenda":"续写中的目标"}
  ],
  "newLocations": [
    {"name":"地点名","type":"门派|城池|秘境|自然|其他","description":"地点描述","significance":"在续写中的剧情意义"}
  ],
  "powerSystem": [
    {"name":"等级体系名","originalLevels":"原作中的等级范围","newLevels":"续写中的新等级","newRules":"续写中的新规则"}
  ],
  "newForeshadowing": [
    {"description":"新伏笔","plantChapter":"续第X章埋设","predictedResolution":"预测如何回收"}
  ],
  "newPlotThreads": [
    {"name":"故事线名","type":"main|sub|hidden","description":"故事线描述"}
  ]
}

约束：
1. 绝不可违反原作设定：已死角色不出现在角色列表中、已毁道具不出现在道具列表中
2. 等级体系只能向上发展（不可倒退），新规则与原规则兼容
3. 道具状态必须准确反映剧情走向中的变化
4. 新增势力或势力变化必须有剧情逻辑支撑

【原作故事理解】
${storyUnderstanding}

【续写剧情走向】
${plotDirection}`
}

export function buildContinuationPlanPrompt(
  storyUnderstanding: string,
  inferredOutline: string,
  targetChapterCount: number,
): string {
  return `你是小说续写规划专家。基于以下故事理解和大纲反推，为续写制定逐章计划。输出JSON：

{
  "estimatedRemainingChapters": 数字,
  "chapterPlans": [
    {
      "relativeChapterNumber": 1,
      "tentativeTitle": "暂定章节标题",
      "plotPoints": ["本章剧情点1","剧情点2",...],
      "characterFocus": ["重点角色1",...],
      "foreshadowToResolve": ["本章要回收的伏笔",...],
      "foreshadowToPlant": ["本章新埋的伏笔",...],
      "wordTarget": 预估字数
    }
  ],
  "overallDirection": "整体续写方向描述",
  "majorTwists": ["重大转折1",...],
  "endingType": "happy|tragic|open|bittersweet|undetermined"
}

要求:
1. 生成 ${targetChapterCount} 章的续写计划
2. 每章 planPoints 至少 3-5 个
3. 优先回收未解决的伏笔
4. 角色弧线必须完整收束
5. 世界观规则不可违反

【故事理解】
${storyUnderstanding}

【大纲反推】
${inferredOutline}`
}

export function buildContinuationWritingPrompt(
  plan: { plotPoints: string[]; characterFocus: { name: string; role: string; personality: string; state: string }[]; foreshadowToResolve: string[]; foreshadowToPlant: string[]; wordTarget?: number },
  previousChapterSummary: string,
  characterStates: string,
  worldRules: string,
  chapterNumber: number,
  constraints: string,
  styleInjection?: string,
  sceneInjection?: string,
): string {
  const focusNames = plan.characterFocus.map(c => c.name).join('、')
  const charProfiles = plan.characterFocus.map(c => `【${c.name}】角色类型:${c.role} | 性格:${c.personality} | 当前状态:${c.state}`).join('\n')

  return `${styleInjection ? `【风格模板注入 — 必须严格遵循以下风格要求】\n${styleInjection}\n\n` : ''}${sceneInjection ? `【场景模板注入 — 本章场景配置】\n${sceneInjection}\n\n` : ''}你是小说续写专家。请根据以下约束续写第 ${chapterNumber} 章。

【本章必须推进的剧情点】
${plan.plotPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

【本章重点角色】
${focusNames}

【角色详细档案】
${charProfiles}

【本章要回收的伏笔】
${plan.foreshadowToResolve.length > 0 ? plan.foreshadowToResolve.join('\n') : '无特定伏笔需要回收'}

${plan.foreshadowToPlant.length > 0 ? `【本章可以埋的新伏笔】\n${plan.foreshadowToPlant.join('\n')}` : ''}

【前章概要】
${previousChapterSummary}

【当前角色状态】
${characterStates}

【不可违反的世界观规则】
${worldRules}

【设定约束 — 绝对不可违反】
${constraints}

【写作要求】
1. 保持原文的叙事语气和风格
2. 角色的说话方式、行为逻辑必须与角色详细档案一致
3. 严格遵循设定约束：已死角色不可出现、已毁道具不可使用、等级不可倒退
4. 剧情推进自然，不要跳脱
5. 字数目标: ${plan.wordTarget || 3000} 字
6. 正文用空行分隔自然段，段落长度自由，禁止全文一堆到底`
}

// Segment → chapter plans: split ~10000字 plot direction into N chapters
export function buildSegmentChapterPlansPrompt(segmentContent: string, chapterCount: number = 10): string {
  return `你是小说细纲策划专家。以下是一段续写剧情走向（约${segmentContent.length}字）。请将其合理分为 ${chapterCount} 章细纲。输出JSON：

{
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "章节标题",
      "summary": "本章剧情摘要（100字内）",
      "plotPoints": ["本章剧情点1","剧情点2","剧情点3"],
      "characterFocus": ["重点角色1","重点角色2"],
      "wordTarget": 预估字数
    }
  ]
}

要求：
1. 每章字数合理分配（总约${segmentContent.length}字÷${chapterCount}章≈${Math.round(segmentContent.length / chapterCount)}字/章），可以有差异但不要差太多
2. 章节之间剧情连贯，每章有明确的起承转合
3. 角色弧线持续发展，不出现角色无故消失或突然出现
4. 伏笔合理分布，不要集中在某几章
5. 章节标题简洁有吸引力

【剧情走向】
${segmentContent}`
}

// Story Map conflict detection: find continuity errors across chapters