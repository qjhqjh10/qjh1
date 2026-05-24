import type { EroticSceneConfig, NovelSceneConfig } from '@/types/story'

export const NOVEL_SCENE_TYPES = ['日常','战斗','对话','内心独白','过渡','高潮','追逐','逃亡','潜入','对峙','宴会/社交','仪式/典礼','训练/修炼','无偏好']
export const NOVEL_PURPOSES = ['推进剧情','展示角色','埋伏笔','回收伏笔','制造悬念','情感转折','世界构建','人物登场']
export const NOVEL_CONFLICTS = ['人vs人','人vs人(近身)','人vs人(智斗)','人vs社会','人vs自我','人vs自然','人vs宿命','无冲突']
export const NOVEL_DIALOGUES = ['稀疏(10%)','少量(25%)','适量(30%)','较多(50%)','密集(60%)','大量(70%)','纯对话','纯叙述(0%)']
export const NOVEL_SENTENCES = ['极短句','短句','中长句','长句','超长句','混合','长短交替']
export const NOVEL_DENSITIES = ['极稀疏','稀疏','适中','密集','极密集']
export const NOVEL_WEATHERS = ['晴','阴','多云','小雨','暴雨','雪','暴雪','风','狂风','雾','浓雾','雷暴','沙尘暴','不限']
export const NOVEL_SUBTEXTS = ['直白','浅层暗示','深层暗线','多层嵌套','反讽/讽刺']
export const NOVEL_GENRE_ELEMENTS: Record<string, string[]> = {
  '修仙': ['战斗描写','境界突破','法宝展示','丹药炼制','洞府探索','宗门日常','渡劫飞升','灵脉争夺'],
  '都市': ['职场场景','商圈社交','现代科技','消费细节','都市场景','互联网元素'],
  '恋爱': ['暧昧互动','甜蜜日常','虐心转折','告白分手','修罗场','助攻路人','同居日常'],
  '古风': ['礼仪描写','称谓系统','古物细节','诗词引用','宫闱斗争','江湖规矩'],
  '悬疑': ['线索铺设','红鲱鱼','信息揭露','反转设置','嫌疑人轮换','不在场证明'],
  '科幻': ['高科技装置','未来世界观','外星文明','赛博朋克','AI伦理','时间悖论'],
  '武侠': ['内力运转','轻功展示','门派恩怨','正邪对决','武器对决'],
  '历史': ['历史典故','朝代风俗','官职体系','战役描写'],
  '奇幻': ['魔法系统','幻兽/精灵','异界探索','种族冲突','预言/宿命'],
  '末世': ['资源争夺','变异生物','幸存者营地','道德困境','废土求生'],
}

export const WORLD_RULES = ['高潮会发光','精液呈金色','倒刺结构','口交可传功','心灵感应','处子之力','精液修炼资源','高潮定等级','体液有特殊功效','双修提升境界','触碰可读心','痛苦转化快感']
export const PROP_LIST = ['束缚套装(手铐+口球+绳索)','调教套装(皮鞭+蜡烛+项圈)','玩具套装(跳蛋+振动棒+肛塞)','感官剥夺(眼罩+降噪耳机)','公开露出(遥控跳蛋+分腿器)','悬挂束缚(吊环+安全绳)','温度玩法(低温蜡烛+温感润滑)','电击刺激(低压棒+凝胶)','木马/三角架','扩张器套装','充气/注水玩具','宠物套装(尾巴+耳朵)','真空床/乳胶衣','拘束椅/刑架']
export const COSTUME_LIST = ['旗袍+吊带袜','校服+过膝袜','护士服+白丝','女仆装+猫耳','泳装+薄纱','紧身皮衣+高跟靴','透明睡衣+蕾丝内衣','兔女郎装+网袜','JK制服+大腿袜','OL套装+黑丝','水手服+泡泡袜','花魁和服+足袋','运动短裤+白袜','绷带缠身','全裸+项圈']
export const STRENGTH_LABELS = ['1 轻度:暗示为主','2 适中:有动作不详细','3 标准:完整适度','4 深入:大量细节','5 极限:极尽细致']

export const SENSORY_ANCHORS = ['檀香与汗水','皮革与铁锈','消毒水气味','青草与泥土','海水咸腥','烟草与酒精','体香与荷尔蒙','硝烟与铁锈','雨后泥土','书页墨香','茶香与熏香','烧烤与烟火','樟脑丸与旧衣柜','花香与蜜糖']

export const NOVEL_NARRATIVE_STYLES = ['沉浸式长镜','旁观式扫射','蒙太奇快切','慢镜头特写','意识流','多视角拼图']
export const NOVEL_TIME_COMPRESSION = ['实时','压缩','拉长','倒叙','跳跃','预叙']
export const NOVEL_INTROSPECTION = ['无','低','中','高']
export const NOVEL_DOMINANT_EMOTIONS = ['紧张','悲伤','愤怒','喜悦','恐惧','厌恶','惊讶','平静','期待','绝望','愧疚','嫉妒','羞耻','释然']
export const NOVEL_PACINGS = ['慢热','渐进','紧凑','爆发','喘息','波浪式','加速推进','弛缓交替']
export const NOVEL_FORESHADOW_USE = ['埋设','回收','暗示','回收+新埋','双线伏笔','无']
export const NOVEL_BODY_LANGUAGES = ['微表情','手势','姿态','眼神','距离感','呼吸节奏','脚步声','沉默/停顿']
export const NOVEL_PROPS_PRESETS = ['信件/密函','武器/暗器','食物/酒水','照片/画像','钥匙/锁','毒药/解药','书籍/日记','首饰/信物','手机/通讯器','地图/线索','药物/针剂','符箓/卷轴']
export const NOVEL_APPEARANCE_PRESETS = ['日常装束','正装','伤痕/血迹','疲惫状态','伪装/变装','湿透/泥泞','破损衣物','战斗装束','庆典盛装']

export const EROTIC_PACINGS = ['慢挑逗','渐进升温','急风骤雨','间歇起伏','持续高潮','粗爆冲击','温柔缠绵','支配征服']
export const EROTIC_BODY_LANGUAGES = ['眼神交流','手指缠绕','呼吸同步','身体依偎','嘴唇微张','颈侧暴露','膝盖顶入','锁骨吮吻','耳垂轻咬','腹部绷紧','脚趾蜷曲']
export const EROTIC_CONSENT_DYNAMICS = ['明确同意','半推半就','角色扮演抗拒','TPE全权委托','从抗拒到迎合','醉酒/药物影响','催眠/精神控制','交易/契约']
export const EROTIC_AFTERCARE = ['无','简单清理','温存安抚','深度护理','事后调教延续','温柔对话','共同洗浴']

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
