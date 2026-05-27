// AI prompt builders for novel continuation analysis pipeline


export function buildConflictDetectionPrompt(chapterAnalyses: string[], totalChapters: number): string {
  return `你是小说一致性审查专家。以下是${totalChapters}章小说的逐章分析摘要。请检测以下8类冲突：

1. 角色生死冲突: 前面已死亡/重伤濒死的角色在后面章节中又正常出现
2. 等级倒退: 角色升级后在没有合理解释的情况下等级下降
3. 道具状态矛盾: 已损坏/丢失/毁灭的道具在后面章节中又被使用
4. 势力存亡矛盾: 已覆灭/解散的势力在后面章节中又出现运作
5. 时间线矛盾: 时间倒流或不合理的跳跃
6. 角色关系矛盾: 关系变化缺乏因果逻辑
7. 伏笔未回收: 明确埋设的伏笔从未被回收
8. 情绪断裂: 情绪基调突变不自然

输出JSON:
{
  "conflicts": [
    {
      "type": "character_death|level_regression|item_status|faction_status|timeline|relationship|foreshadowing|emotion",
      "severity": "critical|warning|info",
      "chapterA": 涉及章号,
      "chapterB": 矛盾章号,
      "summary": "一句话冲突描述",
      "evidence": "具体证据（引用原文分析）",
      "suggestion": "修改建议"
    }
  ],
  "summary": "整体一致性评价（100字内）"
}

要求:
1. critical = 严重影响剧情逻辑(死而复生/等级倒退等)
2. warning = 可能有问题但需要核实
3. info = 轻微不一致或建议补充
4. 只报告确实存在的冲突，不要虚构
5. 每条冲突必须引用具体章节编号和证据

【逐章分析摘要】
${chapterAnalyses.join('\n\n---\n\n')}`
}

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
