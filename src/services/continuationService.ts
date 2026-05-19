// AI prompt builders for novel continuation analysis pipeline

export function buildChapterAnalysisPrompt(chapterTitle: string, chapterContent: string, chapterNumber: number): string {
  return `你是一位专业的小说分析师。请分析以下章节，聚焦于"剧情理解"和"设定提取"。输出JSON（不要markdown）：

{
  "charactersAppeared": [{"name":"角色名","action":"本章做了什么","newInfo":"本章新增的信息（无则空）"}],
  "plotEvents": ["关键事件1","关键事件2",...],
  "foreshadowingPlanted": ["本章新埋的伏笔（无则[]）"],
  "foreshadowingResolved": ["本章回收的前文伏笔（无则[]）"],
  "worldbuildingRevealed": ["本章揭示的新世界观信息（无则[]）"],
  "powerSystemMentions": [{"name":"等级体系名称","levels":"涉及的等级","detail":"本章揭示的等级相关信息（修炼方式/晋升条件/实力对比等）"}],
  "itemsMentioned": [{"name":"道具名称","type":"武器|法宝|丹药|功法|道具|其他","ability":"能力/效果","owner":"持有者"}],
  "factionsMentioned": [{"name":"势力名称","type":"正道|邪道|中立|皇朝|其他","detail":"本章涉及的势力信息"}],
  "locationsMentioned": [{"name":"地点名称","type":"门派|城池|秘境|自然|其他","detail":"本章涉及的地点信息"}],
  "emotionalTone": "本章情绪基调",
  "timelinePosition": "时间线定位",
  "chapterRole": "setup|development|climax|resolution|transition",
  "unresolvedQuestions": ["本章提出但未解答的问题"]
}

要求:
1. plotEvents 至少列出3-8个关键事件，按重要性排序
2. powerSystemMentions/itemsMentioned/factionsMentioned/locationsMentioned 只要文中明确提到或强烈暗示就提取，本章未涉及则填[]
3. 道具的type从提供的分类中选最匹配的，不确定填"其他"
4. 势力的type从提供的分类中选最匹配的，不确定填"其他"
5. 只提取文中明确写出或强烈暗示的信息

【第${chapterNumber}章】${chapterTitle}
${chapterContent.slice(0, 15000)}`
}

export function buildAggregationPrompt(chapterAnalyses: string[], totalChapters: number): string {
  return `你是顶级的小说故事分析师。以下是${totalChapters}章小说逐章分析结果的摘要。请基于这些信息，进行全局故事理解。输出JSON：

{
  "characterArcs": [{"name":"角色名","firstAppearance":章号,"lastAppearance":章号,"arcType":"growth|fall|flat|redemption|corruption|unknown","chapters":[{"chapter":章号,"state":"角色在该章结束时的状态","change":"变化"}],"currentState":"当前状态","unresolved":true/false,"predictedDirection":"你的预测走向"}],
  "mainPlot": "主线一句话概括",
  "subPlots": ["支线1","支线2",...],
  "foreshadowingChain": [{"id":"f_001","description":"伏笔描述","plantedChapter":章号,"resolvedChapter":null或章号,"resolved":true/false,"predictedResolution":"预测回收方式"}],
  "worldRules": ["世界规则1","世界规则2",...],
  "timeline": [{"chapter":章号,"event":"事件","type":"main|sub|character|worldbuilding"}],
  "unresolvedQuestions": ["未解答问题1",...],
  "storyStructure": "threeAct|fiveAct|episodic|other",
  "currentStage": "当前处于故事的哪个阶段",
  "continuationSuggestions": ["续写方向1","方向2","方向3"]
}

【逐章分析摘要】
${chapterAnalyses.join('\n\n')}`
}

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
${chapterSummaries.join('\n\n')}`
}

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
  "characterArcs": [...],
  "mainPlot": "主线一句话概括",
  "subPlots": [...],
  "foreshadowingChain": [...],
  "worldRules": [...],
  "powerSystemSummary": {"systems":[{"name":"体系名","levels":"等级范围","rules":"晋升/修炼规则","currentState":"截至最后的等级分布"}],"globalRules":"跨体系通用规则"},
  "itemsSummary": {"keyItems":[{"name":"道具名","type":"类型","ability":"能力","owner":"持有者","significance":"在剧情中的重要性"}],"unresolvedItems":["去向不明或未回收的道具"]},
  "factionsSummary": {"factions":[{"name":"势力名","type":"类型","currentStatus":"当前状态/立场","relationships":["与其他势力的关系"],"agenda":"当前目标"}],"landscape":"势力格局概述"},
  "locationsSummary": {"keyLocations":[{"name":"地点名","type":"类型","significance":"剧情意义","currentRelevance":"当前相关性"}],"worldMap":"世界地理概述"},
  "timeline": [...],
  "unresolvedQuestions": [...],
  "storyStructure": "threeAct|fiveAct|episodic|other",
  "currentStage": "当前处于故事的哪个阶段",
  "continuationSuggestions": ["基于最后20章态势+全局脉络的续写方向（需考虑等级/道具/势力/地点现状）"]
}

要求:
1. 续写建议必须基于最后20章的剧情态势，不能偏离原作走向
2. 伏笔链优先关注仍未解决的，给出预测回收方式
3. 角色弧线根据各阶段发展完整追踪，标记关键转折
4. 世界观规则汇总去重

【各阶段剧情摘要】
${batchSummaries.join('\n\n---\n\n')}

【最后20章详细分析】
${lastChaptersDetail}`
}

export function buildContinuationOutlinePrompt(storyUnderstanding: string): string {
  return `你是小说续写结构专家。以下是原作的故事理解。请为续写设计整体结构。输出JSON：

{
  "structure": "三幕/五幕/单元剧",
  "estimatedChapters": 续写预估总章数,
  "acts": [{"name":"幕/卷名","chapterRange":"续第X-Y章","summary":"该幕概要","keyEvents":["该幕关键事件"]}],
  "majorTurningPoints": [{"name":"转折点名","chapter": 章号(相对续写),"description":"描述"}],
  "ending": {"type":"happy|tragic|open|bittersweet","description":"结局描述"}
}

要求:
1. 优先回收原作未解决的伏笔
2. 角色弧线必须完整收束
3. 世界观规则不可违反
4. 结构合理，幕与幕之间有清晰的因果关系

【故事理解】
${storyUnderstanding}`
}

export function buildOutlineInferencePrompt(storyUnderstanding: string, totalChapters: number): string {
  return `你是小说结构分析专家。以下是${totalChapters}章小说的故事理解。请反推原作的大纲结构。输出JSON：

{
  "structure": "三幕/五幕/单元剧",
  "currentStage": "当前处于结构的哪个位置",
  "estimatedTotalChapters": 预估总章节数,
  "remainingChapters": 预估剩余章节数,
  "acts": [{"name":"幕/卷名","chapterRange":"第X-Y章","summary":"该幕概要"}],
  "keyTurningPoints": [{"name":"转折点名","chapter":章号,"description":"描述"}]
}

【故事理解】
${storyUnderstanding}`
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
  plan: { plotPoints: string[]; characterFocus: string[]; foreshadowToResolve: string[]; foreshadowToPlant: string[]; wordTarget?: number },
  previousChapterSummary: string,
  characterStates: string,
  worldRules: string,
  chapterNumber: number,
): string {
  return `你是小说续写专家。请根据以下约束续写第 ${chapterNumber} 章。

【本章必须推进的剧情点】
${plan.plotPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

【本章重点角色】
${plan.characterFocus.join('、')}

【本章要回收的伏笔】
${plan.foreshadowToResolve.length > 0 ? plan.foreshadowToResolve.join('\n') : '无特定伏笔需要回收'}

${plan.foreshadowToPlant.length > 0 ? `【本章可以埋的新伏笔】\n${plan.foreshadowToPlant.join('\n')}` : ''}

【前章概要】
${previousChapterSummary}

【当前角色状态】
${characterStates}

【不可违反的世界观规则】
${worldRules}

【写作要求】
1. 保持原文的叙事语气和风格（参考风格模板）
2. 角色的说话方式、行为逻辑与前文一致
3. 不要引入与前文矛盾的新设定
4. 剧情推进自然，不要跳脱
5. 字数目标: ${plan.wordTarget || 3000} 字
6. 正文用空行分隔自然段，段落长度自由，禁止全文一堆到底`
}
