import type { ContextProvider } from '../ContextAssembler'

export const sceneProvider: ContextProvider = {
  domain: 'scene',
  relevance: (userMessage) => {
    if (/场景|scene|情色|erotic|场景模板|场景配置/.test(userMessage)) return 0.9
    if (/创建.*场景|配置.*场景|场景.*卡/.test(userMessage)) return 1.0
    return 0.2
  },

  buildContext: async () => ({
    domain: 'scene',
    priority: 75,
    estimatedTokens: 600,
    content: [
      '## 场景模板',
      '场景模板存储在 scene_templates/ 目录，使用 create_scene_template 工具创建。',
      '',
      '通用字段 (普通小说 + 情色通用):',
      'name, type(小说类型), plotOverview(剧情概述), sceneType(日常/战斗/对话/内心独白/过渡/高潮/情色),',
      'conflictType, scenePurpose, characters(出场角色及情绪), location, time, weather, atmosphere,',
      'senses(感官侧重), dialogueRatio, subtextLevel, sentenceStyle, paragraphDensity,',
      'wordTarget, narrativePOV, narrativeStyle, timeCompression, introspection,',
      'emotionStart, emotionEnd, dominantEmotion, pacing,',
      'foreshadowUse(伏笔), sceneTurningPoint(转折点),',
      'props, appearance, bodyLanguage, sensoryAnchors,',
      '',
      '情色专属字段:',
      'eroticIntensity(1-5)/intensity, selectedKinks, opening, mainPose, climax, aftermath,',
      'soundDensity, moanStyle, degradeLangs, bannedWords, mainRhythm, poseChanges,',
      'consentDynamic, aftercareDetail, bodyFluidFocus, bodyPartFocus, tactileFocus,',
      'emotionCurveInput, triggerWords, publicity, kinkNote,',
      'propList, worldRules, costumeList,',
      '',
      '不确定的字段放入 autoFields 数组，设为 "AI自动" 由系统生成时决定。',
    ].join('\n'),
  }),
}
