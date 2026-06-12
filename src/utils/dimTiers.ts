/**
 * DIM_TIERS — Dimension applicability tiers for smart style analysis.
 * Single source of truth. Used by styleAnalysis.ts, LibraryView.tsx, V4SystemPrompt.ts.
 *
 * Tier meanings:
 *   core     — Always present in any narrative text. MUST analyze.
 *   evidence — Only analyze if text shows clear evidence (≥2 explicit examples).
 *   erotic   — Only for erotic novels (情色小说). Skip entirely for other types.
 *   genre    — Only for specific novel genres. Check if type matches.
 */

export const DIM_TIERS: Record<string, { tier: 'core' | 'evidence' | 'erotic' | 'genre'; desc: string }> = {
  narrativeTone:       { tier: 'core', desc: '叙事基调（任何文本必有）' },
  sentenceStyle:        { tier: 'core', desc: '句式特征（任何文本必有）' },
  vocabularyStyle:      { tier: 'core', desc: '词汇特征（任何文本必有）' },
  rhetoricStyle:        { tier: 'core', desc: '修辞手法（任何文本必有）' },
  rhythmStyle:          { tier: 'core', desc: '节奏结构（任何文本必有）' },
  dialogueStyle:        { tier: 'core', desc: '对话风格（有对话则分析，无对话如实标注）' },
  moodStyle:            { tier: 'core', desc: '氛围描写（任何文本必有）' },
  perspectiveStyle:     { tier: 'core', desc: '叙事视角（任何文本必有）' },
  bodyLanguageStyle:    { tier: 'core', desc: '身体/动作描写（任何文本必有）' },
  sensoryStyle:         { tier: 'core', desc: '感官描写（任何文本必有）' },
  descriptionPattern:   { tier: 'core', desc: '描写结构模式（任何文本必有）' },
  tensionStyle:         { tier: 'evidence', desc: '心理张力（仅当文本有显著内心冲突时分析）' },
  compoundWordPattern:  { tier: 'evidence', desc: '复合造词模式（仅当有大量自造复合词时分析）' },
  onomatopoeiaSystem:   { tier: 'erotic', desc: '情色声音系统（情色专属）' },
  corruptionArc:        { tier: 'erotic', desc: '人物堕落弧线（情色专属）' },
  degradationRitual:    { tier: 'erotic', desc: '凌辱/调教场景机制（情色专属）' },
  narrativeVoice:       { tier: 'erotic', desc: '叙事声音反差（情色专属）' },
  shameVoyeurLoop:      { tier: 'erotic', desc: '羞耻-窥视循环（情色专属）' },
  sensoryPackFormula:   { tier: 'erotic', desc: '感官打包句型公式（情色专属）' },
  bodyMindBetrayal:     { tier: 'erotic', desc: '身心背离写法（情色专属）' },
  costumeStyle:         { tier: 'erotic', desc: '衣着/装扮描写（情色专属）' },
  humiliationTemplate:  { tier: 'erotic', desc: '羞辱场景结构模板（情色专属）' },
  socialRealism:        { tier: 'genre', desc: '社会现实描写（都市/历史/科幻）' },
  cultivationCombat:    { tier: 'genre', desc: '修炼/战斗描写（修仙/武侠/玄幻）' },
  romanceArc:           { tier: 'genre', desc: '感情线发展（恋爱小说）' },
  archaicStyle:         { tier: 'genre', desc: '古风文言特征（古风/历史/武侠）' },
  suspensePacing:       { tier: 'genre', desc: '悬疑节奏（悬疑/灵异小说）' },
}

// v12.5.1: Dimension priority by novel type for focused style analysis.
// Higher tier = higher priority, more token budget.
// Tier 1: 情色核心（400字）  Tier 2: 情色支撑（300字）
// Tier 3: 辅助（200字）       Tier 4: 有证据才写（100字）
export const DIM_PRIORITY: Record<string, Record<string, { tier: 0 | 1 | 2 | 3; minChars: number; maxChars: number }>> = {
  '情色小说': {
    // Tier 0 — 总基调层：几十到两百字，决定全文走向
    narrativeTone:       { tier: 0, minChars: 100, maxChars: 300 },  // 叙事语气态度：叙述者"用什么眼神看这个场景"
    perspectiveStyle:    { tier: 0, minChars: 30,  maxChars: 100 },  // 视角类型：第一/第三人称、叙述距离
    descriptionPattern:  { tier: 0, minChars: 30,  maxChars: 100 },  // 描写推进顺序：从外到内/从衣着到裸体/从远到近

    // Tier 1 — 技法核心（5个）：直接决定情色文本的感官质地
    vocabularyStyle:      { tier: 1, minChars: 200, maxChars: 500 },  // 选词+造词：词库分类/构造公式/降格链/定语堆叠
    costumeStyle:         { tier: 1, minChars: 150, maxChars: 350 },  // 衣着作为情色装置：勒痕/开档/半透明/权力差异
    sensoryStyle:         { tier: 1, minChars: 200, maxChars: 500 },  // 感官：体液脏化/气味/触感阶梯
    rhetoricStyle:        { tier: 1, minChars: 200, maxChars: 400 },  // 用词效果：比喻来源领域/借代压缩/排比清单化/反问羞辱
    onomatopoeiaSystem:   { tier: 1, minChars: 150, maxChars: 350 },  // 叫床/淫叫声：动作-声音编码/密度/排版

    // Tier 2 — 结构支撑（5个）：情色场景骨架
    bodyLanguageStyle:    { tier: 2, minChars: 100, maxChars: 250 },  // 身体姿势语法（从T1降）
    dialogueStyle:        { tier: 2, minChars: 100, maxChars: 250 },  // 对话（从T1降）
    degradationRitual:    { tier: 2, minChars: 150, maxChars: 400 },  // 场景机制：空间倒置/可见性分层/推进模板
    bodyMindBetrayal:     { tier: 2, minChars: 150, maxChars: 350 },  // 身心背离：背德张力/堕落路径/堕落后心理
    humiliationTemplate:  { tier: 2, minChars: 150, maxChars: 400 },  // 羞辱：外部递进序列 + 内部羞耻→快感循环（含shameVoyeurLoop）

    // Tier 3 — 辅助（3个）：简短交代即可
    moodStyle:            { tier: 3, minChars: 30,  maxChars: 100 },  // 氛围底色
    narrativeVoice:       { tier: 3, minChars: 30,  maxChars: 100 },  // 叙事声音反差
    shameVoyeurLoop:      { tier: 3, minChars: 30,  maxChars: 100 },  // 羞耻循环（已合并入humiliationTemplate，此处仅作简述）
  },
  '通用小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    }
  },
  '都市小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "socialRealism": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '修仙小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "cultivationCombat": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    }
  },
  '武侠小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "cultivationCombat": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 350
    },
    "archaicStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '恋爱小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "romanceArc": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    }
  },
  '古风小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "archaicStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '悬疑小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "suspensePacing": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    }
  },
  '历史小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "archaicStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    },
    "socialRealism": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '穿越小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "socialRealism": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    },
    "cultivationCombat": {
      "tier": 2,
      "minChars": 150,
      "maxChars": 300
    }
  },
  '科幻小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "socialRealism": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '玄幻小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "cultivationCombat": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "archaicStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    },
    "compoundWordPattern": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '奇幻小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "socialRealism": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 180
    },
    "cultivationCombat": {
      "tier": 2,
      "minChars": 150,
      "maxChars": 300
    },
    "compoundWordPattern": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '灵异小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "suspensePacing": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    }
  },
  '游戏小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "suspensePacing": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    }
  },
  '末世小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "socialRealism": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    },
    "suspensePacing": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "compoundWordPattern": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 200
    }
  },
  '轻小说': {
    "narrativeTone": {
      "tier": 0,
      "minChars": 100,
      "maxChars": 250
    },
    "perspectiveStyle": {
      "tier": 0,
      "minChars": 30,
      "maxChars": 80
    },
    "sentenceStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "vocabularyStyle": {
      "tier": 1,
      "minChars": 200,
      "maxChars": 400
    },
    "rhetoricStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "dialogueStyle": {
      "tier": 1,
      "minChars": 150,
      "maxChars": 300
    },
    "descriptionPattern": {
      "tier": 1,
      "minChars": 100,
      "maxChars": 200
    },
    "rhythmStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "bodyLanguageStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "sensoryStyle": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    },
    "tensionStyle": {
      "tier": 2,
      "minChars": 80,
      "maxChars": 200
    },
    "moodStyle": {
      "tier": 3,
      "minChars": 30,
      "maxChars": 80
    },
    "compoundWordPattern": {
      "tier": 2,
      "minChars": 100,
      "maxChars": 250
    }
  }
}

export interface ClassifiedDims {
  mustAnalyze: string[]
  checkFirst: string[]
  skipHint: string[]
}

/**
 * Classify a list of dimension keys by their applicability tier.
 * @param dimKeys — The dimension keys to classify
 * @param novelType — Optional novel type for erotic/genre tier checking
 */
export function classifyDimTiers(dimKeys: string[], novelType?: string): ClassifiedDims {
  const mustAnalyze: string[] = []
  const checkFirst: string[] = []
  const skipHint: string[] = []

  const isErotic = novelType === '情色小说' || novelType === 'erotic'
  // For erotic novels, T1/T2 dims in DIM_PRIORITY override DIM_TIERS tier
  const eroticPriority = isErotic ? DIM_PRIORITY['情色小说'] : null

  for (const dk of dimKeys) {
    const info = DIM_TIERS[dk] || { tier: 'evidence' as const, desc: '' }
    // Erotic T1/T2 override: promote evidence-tier dims that are high priority for erotic
    if (eroticPriority && (eroticPriority[dk]?.tier === 1 || eroticPriority[dk]?.tier === 2)) {
      mustAnalyze.push(dk)
      continue
    }
    if (info.tier === 'core') {
      mustAnalyze.push(dk)
    } else if (info.tier === 'erotic') {
      if (isErotic) {
        mustAnalyze.push(dk)
      } else {
        skipHint.push(dk)
      }
    } else if (info.tier === 'genre') {
      checkFirst.push(dk)
    } else {
      checkFirst.push(dk)
    }
  }

  return { mustAnalyze, checkFirst, skipHint }
}
