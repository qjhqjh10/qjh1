// AI prompt builders for novel continuation analysis pipeline

// Rewrite analysis: lightweight chapter analysis (plot summary + characters + key events)
export function buildRewriteAnalysisPrompt(chapterTitle: string, chapterContent: string, chapterNumber: number): string {
  return `你是一位专业的小说分析师。请分析以下章节。输出JSON（不要markdown）：

{
  "plotSummary": "本章剧情概述（200-350字，涵盖起因经过结果）",
  "characters": [{"name":"角色名","gender":"男|女|其他","identity":"身份/职业","traits":"性格特征和外貌特征"}],
  "keyEvents": ["关键事件1（一句话概括）","事件2","事件3","事件4","事件5"]
}

要求:
1. plotSummary: 200-350字，完整概括本章情节
2. characters: 列出本章出场或提及的主要角色,标注性别/身份/特征
3. keyEvents: 列出3-6个关键事件,按时间顺序排列
4. 只提取文中明确写出的信息

【第${chapterNumber}章】${chapterTitle}
${chapterContent.slice(0, 12000)}`
}
