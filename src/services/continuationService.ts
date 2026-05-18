// AI prompt builders for novel continuation analysis pipeline

export function buildChapterAnalysisPrompt(chapterTitle: string, chapterContent: string, chapterNumber: number): string {
  return `你是一位专业的小说分析师。请分析以下章节，聚焦于"剧情理解"而非风格。输出JSON（不要markdown）：

{
  "charactersAppeared": [{"name":"角色名","action":"本章做了什么","newInfo":"本章新增的信息（无则空）"}],
  "plotEvents": ["关键事件1","关键事件2",...],
  "foreshadowingPlanted": ["本章新埋的伏笔（无则[]）"],
  "foreshadowingResolved": ["本章回收的前文伏笔（无则[]）"],
  "worldbuildingRevealed": ["本章揭示的新世界观信息（无则[]）"],
  "emotionalTone": "本章情绪基调",
  "timelinePosition": "时间线定位",
  "chapterRole": "setup|development|climax|resolution|transition",
  "unresolvedQuestions": ["本章提出但未解答的问题"]
}

要求:
1. plotEvents 至少列出3-8个关键事件，按重要性排序
2. foreshadowingPlanted 判断标准: 文中提到但未完全解释的=planted
3. foreshadowingResolved 判断标准: 之前planted的在本章得到解释的=resolved
4. 只提取文中明确写出或强烈暗示的信息

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
