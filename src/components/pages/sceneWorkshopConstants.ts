import type { EroticSceneConfig, NovelSceneConfig } from '@/types/story'

export const NOVEL_SCENE_TYPES = ['日常','战斗','对话','内心独白','过渡','高潮','无偏好']
export const NOVEL_PURPOSES = ['推进剧情','展示角色','埋伏笔','回收伏笔','制造悬念','情感转折']
export const NOVEL_CONFLICTS = ['人vs人','人vs社会','人vs自我','无冲突']
export const NOVEL_DIALOGUES = ['稀疏(10%)','适量(30%)','密集(60%)','纯对话']
export const NOVEL_SENTENCES = ['短句','中长句','长句','混合']
export const NOVEL_DENSITIES = ['稀疏','适中','密集']
export const NOVEL_WEATHERS = ['晴','阴','雨','雪','风','雾','雷暴','不限']
export const NOVEL_SUBTEXTS = ['直白','浅层暗示','深层暗线','多层嵌套']
export const NOVEL_GENRE_ELEMENTS: Record<string, string[]> = {
  '修仙': ['战斗描写','境界突破','法宝展示','丹药炼制'],
  '都市': ['职场场景','商圈社交','现代科技','消费细节'],
  '恋爱': ['暧昧互动','甜蜜日常','虐心转折','告白分手'],
  '古风': ['礼仪描写','称谓系统','古物细节','诗词引用'],
  '悬疑': ['线索铺设','红鲱鱼','信息揭露','反转设置'],
}

export const WORLD_RULES = ['高潮会发光','精液呈金色','倒刺结构','口交可传功','心灵感应','处子之力','精液修炼资源','高潮定等级']
export const PROP_LIST = ['束缚套装(手铐+口球+绳索)','调教套装(皮鞭+蜡烛+项圈)','玩具套装(跳蛋+振动棒+肛塞)','感官剥夺(眼罩+降噪耳机)','公开露出(遥控跳蛋+分腿器)','悬挂束缚(吊环+安全绳)','温度玩法(低温蜡烛+温感润滑)','电击刺激(低压棒+凝胶)']
export const COSTUME_LIST = ['旗袍+吊带袜','校服+过膝袜','护士服+白丝','女仆装+猫耳','泳装+薄纱','紧身皮衣+高跟靴','透明睡衣+蕾丝内衣','兔女郎装+网袜']
export const STRENGTH_LABELS = ['1 轻度:暗示为主','2 适中:有动作不详细','3 标准:完整适度','4 深入:大量细节','5 极限:极尽细致']

export const SENSORY_ANCHORS = ['檀香与汗水','皮革与铁锈','消毒水气味','青草与泥土','海水咸腥','烟草与酒精','体香与荷尔蒙']

export const NOVEL_NARRATIVE_STYLES = ['沉浸式长镜','旁观式扫射','蒙太奇快切','慢镜头特写','意识流']
export const NOVEL_TIME_COMPRESSION = ['实时','压缩','拉长','倒叙']
export const NOVEL_INTROSPECTION = ['无','低','中','高']
export const NOVEL_DOMINANT_EMOTIONS = ['紧张','悲伤','愤怒','喜悦','恐惧','厌恶','惊讶','平静']
export const NOVEL_PACINGS = ['慢热','渐进','紧凑','爆发','喘息']
export const NOVEL_FORESHADOW_USE = ['埋设','回收','暗示','无']
export const NOVEL_BODY_LANGUAGES = ['微表情','手势','姿态','眼神','距离感']
export const NOVEL_PROPS_PRESETS = ['信件/密函','武器/暗器','食物/酒水','照片/画像','钥匙/锁','毒药/解药','书籍/日记','首饰/信物']
export const NOVEL_APPEARANCE_PRESETS = ['日常装束','正装','伤痕/血迹','疲惫状态','伪装/变装','湿透/泥泞']

export const EROTIC_PACINGS = ['慢挑逗','渐进升温','急风骤雨','间歇起伏','持续高潮']
export const EROTIC_BODY_LANGUAGES = ['眼神交流','手指缠绕','呼吸同步','身体依偎','嘴唇微张','颈侧暴露']
export const EROTIC_CONSENT_DYNAMICS = ['明确同意','半推半就','角色扮演抗拒','TPE全权委托']
export const EROTIC_AFTERCARE = ['无','简单清理','温存安抚','深度护理']

export const DEFAULT_EROTIC: EroticSceneConfig = {
  characters: [], location: '卧室', time: '深夜', atmosphere: '羞辱', publicity: '私密',
  selectedKinks: [], kinkNote: '', opening: ['口交'], mainPose: '无偏好', mainRhythm: '无偏好',
  poseChanges: '2-3次转换', climax: ['体内射精'], aftermath: ['清理侍奉'],
  soundDensity: '密集', moanStyle: '哭喊破音', degradeLangs: ['母狗','精壶'],
  intensity: 4, wordTarget: 3000, streamMode: true, replaceMode: true,
  useStyleProfile: true, useChapterOutline: true, extraNote: '',
  kinkIntensities: {}, customKink: '', customCharacters: [],
  customLocation: '', customTime: '', customAtmosphere: '', customPublicity: '',
  extraPhases: [], customInsults: '', bannedWords: '', narrativePOV: '第三人称',
  customPoses: [], customRhythms: [], customPOVs: '',
  customOpening: [], customClimax: [], customAftermath: [],
  customDegradeLangs: [],
  bodyFluidFocus: [], bodyPartFocus: [], tactileFocus: [],
  narrativeStyle: '沉浸式长镜', timeCompression: '实时', introspection: '中', sensoryAnchors: '',
  dominantEmotion: '', emotionCurveInput: '', triggerWords: '',
  worldRules: '', propList: '', costumeList: '',
  customExtraNotes: '', customEmotions: '', customCurves: '', customTriggers: '',
  customWorldRules: '', customPropLists: '', customCostumeLists: '',
  customPoseChanges: '', customSoundDensity: '', customMoanStyle: '',
  pacing: '渐进升温', bodyLanguage: '', consentDynamic: '明确同意', aftercareDetail: '温存安抚',
  autoFields: {},
}

export const DEFAULT_NOVEL: NovelSceneConfig = {
  sceneType: '日常', scenePurpose: ['推进剧情'], conflictType: '无冲突',
  povCharacterId: '', povCharacterName: '', characters: [],
  location: '客厅', customLocation: '', weather: '不限', time: '不限', atmosphere: '不限',
  senses: ['视觉'], genreElements: [], dialogueRatio: '适量(30%)', subtextLevel: '一般',
  sentenceStyle: '混合', paragraphDensity: '适中',
  emotionStart: '', emotionEnd: '', wordTarget: 3000, narrativePOV: '第三人称',
  useStyleProfile: true, useChapterOutline: true, extraNote: '',
  narrativeStyle: '沉浸式长镜', timeCompression: '实时', introspection: '中',
  sensoryAnchors: '', dominantEmotion: '', emotionCurveInput: '', pacing: '渐进',
  props: '', appearance: '', bodyLanguage: '',
  foreshadowUse: '无', sceneTurningPoint: '',
  autoFields: {},
}

export type EditorType = 'erotic' | 'novel' | null

export const SECTIONS = [
  { id: 1, label: '1. 角色' }, { id: 2, label: '2. 地点' }, { id: 3, label: '3. 时间' },
  { id: 4, label: '4. 氛围' }, { id: 5, label: '5. 公开度' }, { id: 6, label: '6. 性癖' },
  { id: 7, label: '7. 流程' }, { id: 8, label: '8. 性爱流程' },
  { id: 9, label: '9. 声音' }, { id: 10, label: '10. 强度&字数' }, { id: 11, label: '11. 额外说明' },
  { id: 12, label: '12. 叙事视角' }, { id: 13, label: '13. 身体焦点' }, { id: 14, label: '14. 叙事风格' }, { id: 15, label: '15. 时间' }, { id: 16, label: '16. 内省' }, { id: 17, label: '17. 感官锚点' },
  { id: 18, label: '18. 情绪心理' }, { id: 19, label: '19. 世界规则' }, { id: 20, label: '20. 道具清单' }, { id: 21, label: '21. 服装清单' }, { id: 22, label: '22. 场景字数' },
  { id: 23, label: '23. 节奏' }, { id: 24, label: '24. 肢体语言' }, { id: 25, label: '25. 同意动态' }, { id: 26, label: '26. 事后关怀' },
]
