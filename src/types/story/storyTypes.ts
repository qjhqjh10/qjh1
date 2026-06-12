// ---- Story Map System ----

export interface StoryEvent {
  id: string
  type: 'event' | 'foreshadowing' | 'payoff'
  timeLabel: string
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  characters: string[]
  location: string
  summary: string
  quote: string
  source: 'ai' | 'manual'
  createdAt: string
}

export interface StoryLink {
  id: string
  sourceEventId: string
  targetEventId: string
  type: 'foreshadowing' | 'causality' | 'reference'
  note: string
}

export interface CharacterSnapshot {
  characterId: string
  characterName: string
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  traits: Record<string, string>
}

// ---- Emotions ----

export interface ChapterEmotion {
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  scores: {
    tension: number
    warmth: number
    sadness: number
    excitement: number
    lightness: number
  }
  summary: string
}

// ---- Character Presence ----

export interface CharacterPresence {
  chapterId: string; chapterOrder: number; chapterTitle: string
  characters: {
    characterId: string; characterName: string
    mentionCount: number
    role: 'primary' | 'secondary' | 'mentioned'
  }[]
}

// ---- Chapter Rhythm ----

export interface ChapterRhythm {
  chapterId: string; chapterOrder: number; chapterTitle: string
  metrics: {
    dialogueRatio: number
    descriptionRatio: number
    actionRatio: number
    paceScore: number
    infoDensity: number
    wordCount: number
  }
}

// ---- Plotlines ----

export interface Plotline {
  id: string; name: string; color: string; description: string; order: number
}

export interface ChapterPlotline {
  chapterId: string; chapterOrder: number; chapterTitle: string
  plotlines: {
    plotlineId: string; plotlineName: string
    intensity: number
  }[]
}

// ---- POV ----

export interface ChapterPOV {
  chapterId: string; chapterOrder: number; chapterTitle: string
  primaryPOV: { characterId: string; characterName: string }
  secondaryFocalPoints: { characterId: string; characterName: string }[]
  povType: 'first' | 'third-close' | 'third-omniscient' | 'mixed'
  hasHeadHopping: boolean
  note: string
}

// ---- Character Growth ----

export interface GrowthTrack {
  id: string; label: string; icon: string; order: number
}

export interface GrowthEntry {
  id: string
  characterId: string; characterName: string
  chapterId: string; chapterOrder: number; chapterTitle: string
  trackId: string; trackLabel: string
  value: string
  change: 'new' | 'upgrade' | 'downgrade' | 'lost' | 'same'
  note: string
  source: 'ai' | 'manual'
  createdAt: string
}

// Outline metadata
export interface ForeshadowItem {
  id: string
  description: string
  plantChapterId: string
  payoffChapterId: string
  status: 'planted' | 'resolved'
}

export interface PlotThread {
  id: string
  name: string
  type: 'main' | 'sub' | 'hidden'
  color: string
  chapterIds: string[]
}

export interface OutlineMeta {
  foreshadowing: ForeshadowItem[]
  plotThreads: PlotThread[]
  updatedAt: string
}

export const NOVEL_TYPES = ['通用','都市','修仙','武侠','恋爱','古风','悬疑','历史','穿越','科幻','玄幻','奇幻','灵异','游戏','末世','轻小说','情色','自定义']

export const NOVEL_TYPE_LABELS: Record<string, string> = {
  '普通小说': '普通', '情色小说': '情色', '玄幻小说': '玄幻', '奇幻小说': '奇幻', '灵异小说': '灵异',
  '游戏小说': '游戏', '末世小说': '末世', '轻小说': '轻小说', '都市小说': '都市', '修仙小说': '修仙',
  '武侠小说': '武侠', '恋爱小说': '恋爱', '古风小说': '古风', '悬疑小说': '悬疑', '历史小说': '历史',
  '科幻小说': '科幻', '穿越小说': '穿越',
}

export const NOVEL_TYPE_DIMS: Record<string, string[]> = {
  '通用': ['narrativeTone','sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern'],
  '都市': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','socialRealism'],
  '修仙': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','cultivationCombat'],
  '武侠': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','cultivationCombat','archaicStyle'],
  '恋爱': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','romanceArc'],
  '古风': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','archaicStyle'],
  '悬疑': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','suspensePacing'],
  '历史': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','archaicStyle','socialRealism'],
  '穿越': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','socialRealism','cultivationCombat'],
  '科幻': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','socialRealism'],
  '玄幻': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','cultivationCombat','archaicStyle','compoundWordPattern','onomatopoeiaSystem'],
  '奇幻': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','socialRealism','cultivationCombat','compoundWordPattern'],
  '灵异': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','suspensePacing','onomatopoeiaSystem'],
  '游戏': ['sentenceStyle','vocabularyStyle','rhetoricStyle','moodStyle','dialogueStyle','perspectiveStyle','tensionStyle','descriptionPattern','suspensePacing'],
  '末世': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','socialRealism','suspensePacing','compoundWordPattern'],
  '轻小说': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','compoundWordPattern','onomatopoeiaSystem'],
  '情色': ['narrativeTone','vocabularyStyle','costumeStyle','rhetoricStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','descriptionPattern','degradationRitual','narrativeVoice','shameVoyeurLoop','onomatopoeiaSystem','bodyMindBetrayal','humiliationTemplate'],
}

export const DIMENSION_META: Record<string, { label: string; category: string; prompt: string }> = {
  narrativeTone:   { label: '叙事基调', category: '叙事基调', prompt: `"narrativeTone": {"description":"这是统领所有写作特征的元维度。叙事基调是一篇小说的'底色'——同样的身体描写，在幽默基调下荒诞搞笑，在沉重基调下压抑窒息，在温柔基调下治愈放松。你必须分析: 1)情感基调:从哪些对立的情绪轴中确定这篇小说落在哪个位置(沉重压抑↔轻快放松/冷酷残忍↔温柔母性/严肃庄严↔滑稽戏谑/冷静疏离↔热血沉浸) 2)叙事者的态度:叙述者对故事中发生的极端内容持什么态度(冷漠旁观/暗爽欣赏/讽刺挖苦/温柔包容/神圣庄严) 3)语言与内容的反差:是否存在'极淫内容用极平淡语气写'或'极温柔语气写极暴力内容'等反差效果 4)故事世界的氛围底色:读者合上书后留下的情绪是什么(治愈/压抑/亢奋/空虚/满足/恶心) 5)如果限定只用一个词概括这篇小说的基调，那个词是什么。每个结论必须引用原文段落作为证据。","examples":["最能体现叙事基调的5个原文段落"],"writingRules":["可操作的基调维持规则，如'描写极端暴力时保持叙述者的冷漠不评判语气'或'在每次羞辱描写后插入温情对话来维持反差基调'"],"vocabularyList":["基调相关的关键词汇/语气标记词"]}"` },
  sentenceStyle:    { label: '句式', category: '基础文风', prompt: `"sentenceStyle": {"description":"分析句式特征。指出: 1)长句的典型字数范围和功能(描写/心理/叙事) 2)短句的典型字数和功能(动作/拟声/命令) 3)长短句交替模式(比例+节奏切换点) 4)标点使用习惯(感叹号/省略号/逗号的密度和功能) 5)段落结构(每段行数+首尾句特征)。每个结论引用原文例句。","examples":["原文摘录的5个代表性句子"],"writingRules":["可操作的写作规则，如'每段以3-5字短句开头，后接30-50字长句展开描写'"],"vocabularyList":["句式相关的关键词汇"]}"` },
  costumeStyle:  { label: '衣着/装扮', category: '情色专属', prompt: `分析衣着如何成为情色装置：衣服与身体的互动关系（勒/绷/透/露/遮）、衣物的正常功能与情色化使用之间的张力、不同角色衣着的差异如何体现身份/权力` },
  vocabularyStyle:  { label: '物化命名词', category: '基础文风', prompt: `"vocabularyStyle": {"description":"分析词汇特征。指出: 1)文白比例(书面语vs口语vs粗俗语的比例) 2)高频词类列表(名词/动词/形容词各自的高频词) 3)成语和典故的使用频率 4)独特的自造词/复合词系统(如果有) 5)词藻的浓稠度(每百字形容词数量)。引用原文具体词汇作为证据。","examples":["原文摘录的5个代表性用词段落"],"writingRules":["可操作的用词规则，如'描写身体部位时每句使用3-5个形容词堆叠'"],"vocabularyList":["必须使用的高频/特色词汇清单"]}"` },
  rhetoricStyle:    { label: '修辞暗示', category: '基础文风', prompt: `"rhetoricStyle": {"description":"分析修辞特征。指出: 1)主要的比喻类型和频率(明喻/暗喻/借代) 2)排比的使用模式和触发场景 3)通感手法(哪种感官之间的映射最常用) 4)留白/省略的使用 5)反讽/夸张的使用模式。引用原文例句。","examples":["5个代表性修辞例句"],"writingRules":["可操作的修辞规则，如'每次写体液时用食物比喻(如浆糊/面膜)'"],"vocabularyList":["修辞相关的关键词汇"]}"` },
  rhythmStyle:      { label: '节奏结构', category: '基础文风', prompt: `"rhythmStyle": {"description":"分析节奏特征。指出: 1)场景切换的频率和方式(空行/过渡句/直接跳切) 2)快慢段落的长度比例 3)是否存在多线叙事及其切换模式 4)高潮场景和过渡场景的篇幅比例 5)每段落的'呼吸节奏'(铺垫→推进→爆发→余韵)。引用原文段落。","examples":["5个代表性节奏段落"],"writingRules":["可操作的节奏规则，如'每300字插入一个2-3字的拟声/动作短句打破长描写'"],"vocabularyList":["节奏标记词/过渡词清单"]}"` },
  dialogueStyle:    { label: '对话', category: '基础文风', prompt: `"dialogueStyle": {"description":"分析对话特征。指出: 1)对白占总字数的比例 2)对话的语气风格(粗俗/文雅/简洁/啰嗦) 3)不同身份人物的语言差异 4)对话与动作描写的配合方式 5)方言/粗话/口头禅的使用。引用原文对话片段。","examples":["5个代表性对话片段"],"writingRules":["可操作的对话规则，如'身份高者用短命令句+粗话，身份低者用省略号和结巴'"],"vocabularyList":["对话高频词/口头禅清单"]}"` },
  moodStyle:        { label: '氛围', category: '基础文风', prompt: `简述整体情绪基调、色调偏好、环境与心理的映射关系` },
  perspectiveStyle: { label: '视角', category: '进阶技法', prompt: `简述主要视角类型、叙述距离（冷眼/沉浸/交替）、视角切换触发条件` },
  bodyLanguageStyle:{ label: '身体描写', category: '进阶技法', prompt: `"bodyLanguageStyle": {"description":"分析身体描写的特征。这是最重要的维度之一。必须分析: 1)哪些身体部位被反复描写及其出现频率排序 2)描写每个部位时使用的修辞模式(比喻/借代/拟人等) 3)身体描写的'扫描顺序'(如从上到下:头发→脸→胸部→腰→臀部→腿→脚) 4)身体反应(颤抖/痉挛/收缩/湿润/硬挺等)触发的上下文 5)解剖描写的精度(粗略/细致/科学术语vs自造词) 6)身材体型的固定形容词组合 7)皮肤质感的描写频率和用词。对每个发现引用原文例句。","examples":["10个身体描写的代表性片段(覆盖不同部位)"],"writingRules":["可操作的身体描写规则，列出描写顺序模板和每个部位必须使用的形容词"],"vocabularyList":["身体各部位的专用形容词/复合词清单，必须完整列出原文中出现的所有词汇"]}"` },
  sensoryStyle:     { label: '感官', category: '进阶技法', prompt: `"sensoryStyle": {"description":"分析感官描写的特征。这是最重要的维度之一。必须分析: 1)五感的使用比例(视觉%/触觉%/嗅觉%/听觉%/味觉%) 2)每种感官的具体描写手法 3)单一句子中同时触发多种感官的频率和模式(感官打包) 4)嗅觉描写的词汇库(所有气味词) 5)触觉描写的词汇库(温度/黏度/硬度/湿度) 6)体液描写的完整分类体系(种类+每种的颜色/气味/温度/黏稠度/分泌量)。引用原文。","examples":["10个感官描写的代表性片段"],"writingRules":["可操作的感官规则，如'每个身体描写句必须同时包含视觉(形状/颜色)+触觉(温度/黏度)+嗅觉(气味形容词)'"],"vocabularyList":["完整的感官词汇库:气味词/触觉词/温度词/声音词/视觉形态词"]}"` },
  tensionStyle:     { label: '心理张力', category: '进阶技法', prompt: `"tensionStyle": {"description":"分析心理张力特征。指出: 1)内心矛盾的核心对立(羞耻vs兴奋/恐惧vs渴望/高贵vs堕落) 2)矛盾如何通过身体反应展现(不用心理概括句) 3)张力如何在场景中升级(每个阶段的触发词和身体信号) 4)读者被如何卷入角色的内心冲突(通过感官描写还是直接独白) 5)张力的释放方式(高潮/排泄/放弃/崩溃)。引用原文。","examples":["5个心理张力描写的代表性段落"],"writingRules":["可操作的张力规则，如'每段羞辱必须包含:外部刺激→身体反应→羞耻→身体反叛兴奋→更羞耻→更兴奋的循环'"],"vocabularyList":["心理状态关键词汇和身体信号词汇清单"]}"` },
  descriptionPattern:{ label: '描写结构', category: '进阶技法', prompt: `简述场景描写的典型推进顺序和段落密度分布` },
  corruptionArc:    { label: '人物演变', category: '情色专属', prompt: `"corruptionArc": {"description":"分析人物堕落/演变的书写模式。指出: 1)角色从初始状态到当前状态的阶梯步骤(每步的触发事件) 2)自我合理化的句式(角色如何说服自己接受堕落) 3)身份消解的过程(旧身份词汇如何被替换为新身份词汇) 4)角色之间的等级层级如何在对话/动作中反复确认 5)管教/调教框架的具体描写公式。引用原文中每个演变节点。","examples":["5个角色演变的关键节点段落"],"writingRules":["可操作的演变规则，如'每章以角色的自我合理化独白开始，以身体背叛意志的反应结束'"],"vocabularyList":["身份演变词汇:旧身份词→新身份词对照表"]}"` },
  degradationRitual:{ label: '场景机制', category: '情色专属', prompt: `"degradationRitual": {"description":"分析凌辱/调教场景的书写公式。指出: 1)场景的结构模板(共几个阶段，每阶段的功能和长度) 2)每个阶段使用的固定词汇/句式 3)观众的引入和作用模式 4)羞辱升级的方式(言语→展示→触碰→体液→插入→内射→标记) 5)性癖分类的描写侧重 6)高潮描写的固定步骤模板 7)屈服确认的标准句式。引用原文中每个阶段的代表性描写。","examples":["完整的一个羞辱场景各阶段代表性段落"],"writingRules":["可操作的场景规则，如'羞辱场景严格按照[展示→目光→言语→触碰→体液→身体反应→羞耻→兴奋→升级]的9步公式'"],"vocabularyList":["每个阶段的专用词汇库:展示词汇/目光词汇/羞辱词表/体液词汇/高潮词汇"]}"` },
  narrativeVoice:   { label: '叙事声音', category: '情色专属', prompt: `简述叙述者语气的基本特征、极淫内容与平淡叙事的反差程度` },
  shameVoyeurLoop:  { label: '心理循环', category: '情色专属', prompt: `"shameVoyeurLoop": {"description":"分析羞耻-窥视-兴奋循环的写法。指出: 1)羞耻如何被触发(看见/听见/被看见/被听见) 2)从羞耻到兴奋的转折句式(转折词/身体信号/独白) 3)兴奋后的反馈放大(羞耻因兴奋而加深，兴奋因羞耻而加强) 4)循环的结束条件 5)窥视视角如何引入(路人/观众/镜子/水面)。引用原文的完整循环描写。","examples":["5个完整的羞耻→兴奋循环段落"],"writingRules":["可操作的循环规则，如'每段公开羞辱必须包含:被注视的刺痛→身体不自觉的反应→意识到自己的身体反应→更强烈的羞耻→羞耻转化为更强烈的身体反应'"],"vocabularyList":["羞耻词表/兴奋信号词表/循环转折词清单"]}"` },
  socialRealism:   { label: '社会现实', category: '类型专属', prompt: `"socialRealism": {"description":"分析社会现实描写。指出: 1)阶层如何通过物质细节标记(消费品/住所/出行方式/饰物) 2)身份高低如何通过空间关系展示(谁站在高处/谁跪着) 3)权力关系的视觉化呈现 4)口语的自然度(方言/流行语/脏话的使用场景)。引用原文。","examples":["5个社会现实描写的代表性段落"],"writingRules":[],"vocabularyList":["阶层标记词汇清单"]}"` },
  cultivationCombat:{ label: '修炼战斗', category: '类型专属', prompt: `"cultivationCombat": {"description":"分析修炼/战斗描写。指出: 1)招式命名的规律 2)战斗节奏模式 3)境界突破的仪式感 4)法宝丹药的描写密度和命名规则。引用原文。","examples":["5个战斗描写段落"],"writingRules":[],"vocabularyList":["战斗/修炼关键词汇"]}"` },
  romanceArc:      { label: '感情发展', category: '类型专属', prompt: `"romanceArc": {"description":"分析感情线描写。指出: 1)关系阶段模板 2)甜虐节奏比例 3)第三人/误会的作用方式。引用原文。","examples":["5个感情描写段落"],"writingRules":[],"vocabularyList":["感情关键词汇"]}"` },
  archaicStyle:    { label: '古风文言', category: '类型专属', prompt: `"archaicStyle": {"description":"分析古风特征。指出: 1)文白比例 2)称谓系统 3)功夫招式命名的文学风格。引用原文。","examples":["5个古风描写段落"],"writingRules":[],"vocabularyList":["古风高频词汇"]}"` },
  suspensePacing:  { label: '悬疑节奏', category: '类型专属', prompt: `"suspensePacing": {"description":"分析悬疑节奏。指出: 1)伏笔密度 2)虚假线索使用 3)信息揭露节奏 4)误导和反转频率。引用原文。","examples":["5个悬疑段落"],"writingRules":[],"vocabularyList":["悬疑关键词汇"]}"` },
  compoundWordPattern:{ label: '造词模式', category: '泛用技法', prompt: `"compoundWordPattern": {"description":"分析作者的造词/造复合词模式。这是精准模仿的关键维度。必须分析: 1)作者如何创造新复合形容词(如形容词+名词/名词+形容词/三词组合)的具体公式 2)复合词的来源领域(食物/动物/工具) 3)造词的频率(每千字几个自造词) 4)自造词是否在全文重复使用还是不断创造新词 5)列出所有自造复合词并分类(身体部位类/体液类/质感类/状态类)。引用原文。","examples":["10+个自造复合词的原文出处和上下文"],"writingRules":["可操作的造词公式，如'按照[质感形容词]+[体态暗示]+[身体部位名词]的三词组合公式创造新词'"],"vocabularyList":["完整的自造复合词汇清单，按类别分组"]}"` },
  onomatopoeiaSystem:{ label: '叫床/淫叫声', category: '泛用技法', prompt: `"onomatopoeiaSystem": {"description":"分析拟声词系统。这是精准模仿的关键维度。必须分析: 1)所有拟声词的完整清单和出现次数 2)拟声词的重复模式(单次/连续重复几次/是否有固定重复次数) 3)拟声词在段落中的触发位置(铺垫后/动作中/高潮后) 4)拟声词的排版格式(是否单独成行/是否用感叹号分隔/是否用空格分隔) 5)拟声词与身体动作的类型映射(哪种动作对应哪种拟声词)。引用原文。","examples":["原文中所有拟声词密集段落，标注重复次数和格式"],"writingRules":["可操作的拟声词规则，如'每个射精场景必须包含连续10-13次噗呲重复，每词用感叹号分隔，单独成段'"],"vocabularyList":["完整的拟声词汇清单，按动作类型分组"]}"` },
  sensoryPackFormula:{ label: '感官打包', category: '情色专属', prompt: `"sensoryPackFormula": {"description":"分析'感官打包'的句型公式。感官打包是指在单一长句中同时写入多种感官细节。必须分析: 1)感官打包的标准句型模板(如'视觉形状+触觉温度黏度+嗅觉气味'或'视觉颜色+触觉质感+味觉') 2)哪些感官组合最常用 3)感官打包句在段落中的位置(开头/中间/高潮) 4)打包句的字数范围 5)打包句中的感官顺序(从视觉开始还是从触觉开始)。引用原文中的典型打包句。","examples":["10个典型的感官打包句，标注每句包含的感官类型和顺序"],"writingRules":["可操作的打包规则，如'每个身体部位特写句必须为50字以上长句，依次写入视觉(形状+颜色)+触觉(温度+黏度)+嗅觉(具体气味词)三种感官'"],"vocabularyList":["感官打包常用的连接词/过渡词"]}"` },
  bodyMindBetrayal:{ label: '身心背离', category: '情色专属', prompt: `"bodyMindBetrayal": {"description":"分析'身体背叛意志'的写法。这是情色文学中最重要的叙事模式之一。必须分析: 1)身体在羞耻/恐惧/痛苦中产生反常兴奋的具体描写句式 2)意志与身体的对抗如何展现(意志的抗拒词vs身体的反应词) 3)身体背叛的转折点(往往由一个具体的感官刺激触发) 4)背叛后的自我厌恶/合理化独白 5)这种模式的重复频率(每章几次)。引用原文中每个身心背离段落。","examples":["所有身心背离的关键段落，标注意志话语vs身体信号"],"writingRules":["可操作的身心背离规则，如'每段羞辱必须以外部刺激→身体颤抖/收缩→意志抗拒→身体不可控制地分泌/硬挺/兴奋→羞耻加深→更兴奋的五步递进'"],"vocabularyList":["意志抗拒词汇/身体背叛信号词汇/转折连接词清单"]}"` },
  humiliationTemplate:{ label: '羞辱公式', category: '情色专属', prompt: `"humiliationTemplate": {"description":"分析羞辱场景的完整结构模板。必须分析: 1)一个羞辱场景从开始到结束的递进公式(暴露→围观→目光→言语→触碰→体液→高潮→余韵) 2)每个阶段的字数比例 3)每个阶段的描写密度(稀疏/中等/密集/极密) 4)羞辱如何在各个阶段升级(数量/程度/公开性) 5)羞辱后的'余韵'写法(身体残留+心理残留+身份变化)。引用原文中的完整羞辱场景。","examples":["完整剖析一个羞辱场景，标注每个阶段的起止点和字数"],"writingRules":["可操作的场景模板，如'羞辱场景按段落分8步:每步字数比例为5%→10%→10%→15%→20%→20%→15%→5%'"],"vocabularyList":["每个阶段的专用描写词汇和句式模板"]}"` },
}

export const GENRE_TRACK_PRESETS: Record<string, Omit<GrowthTrack, 'id' | 'order'>[]> = {
  '仙侠/玄幻': [
    { label: '等级境界', icon: '📊' }, { label: '功法技能', icon: '⚔️' },
    { label: '装备道具', icon: '🎒' }, { label: '身份地位', icon: '👑' },
    { label: '所在位置', icon: '📍' },
  ],
  '都市/现实': [
    { label: '职业发展', icon: '💼' }, { label: '资产财富', icon: '💰' },
    { label: '社交圈层', icon: '👥' }, { label: '感情状态', icon: '❤️' },
    { label: '所在位置', icon: '📍' },
  ],
  '恋爱/言情': [
    { label: '感情阶段', icon: '💕' }, { label: '好感度', icon: '📈' },
    { label: '关系确认', icon: '💍' }, { label: '情敌动态', icon: '⚡' },
    { label: '重要事件', icon: '🎯' },
  ],
  '悬疑/推理': [
    { label: '调查进度', icon: '🔍' }, { label: '线索收集', icon: '🧩' },
    { label: '嫌疑人圈', icon: '👤' }, { label: '真相揭露', icon: '💡' },
    { label: '危险等级', icon: '⚠️' },
  ],
  '科幻': [
    { label: '科技等级', icon: '🔬' }, { label: '装备升级', icon: '🛠️' },
    { label: '组织地位', icon: '🏛️' }, { label: '星际位置', icon: '🌍' },
    { label: '基因/改造', icon: '🧬' },
  ],
  '后宫': [
    { label: '后宫人数', icon: '👥' }, { label: '好感度', icon: '📈' },
    { label: '攻略进度', icon: '🎯' }, { label: '修罗场', icon: '💢' },
    { label: '关系阶段', icon: '💕' },
  ],
  '自定义': [
    { label: '新维度', icon: '📌' },
  ],
}

// ---- Unified Graph ----

export interface TimeFlowEntry {
  chapterId: string; chapterOrder: number; chapterTitle: string
  timeSpan: string; cumulativeDays: number; gapFromPrevious: string
}

export interface CoOccurrenceData {
  pairs: { charA: string; charB: string; coCount: number }[]
  nodes: { name: string; count: number }[]
  edges: { source: string; target: string; weight: number }[]
}

export interface RomanceProgressEntry {
  couple: { nameA: string; roleA: string; nameB: string; roleB: string }
  chapters: { chapterOrder: number; interactionCount: number; milestone: string }[]
}

export interface CultivationProgressEntry {
  characterName: string; systemName: string
  chapters: { chapterOrder: number; level: string; breakthrough: boolean }[]
}

export interface StoryGraph {
  events: StoryEvent[]
  links: StoryLink[]
  snapshots: CharacterSnapshot[]
  emotions: ChapterEmotion[]
  presences: CharacterPresence[]
  rhythms: ChapterRhythm[]
  plotlines: Plotline[]
  chapterPlotlines: ChapterPlotline[]
  povs: ChapterPOV[]
  growthTracks: GrowthTrack[]
  growthEntries: GrowthEntry[]
  timeFlow: TimeFlowEntry[]
  coOccurrence: CoOccurrenceData | null
  romanceProgress: RomanceProgressEntry[]
  cultivationProgress: CultivationProgressEntry[]
  generatedAt: string
  scannedChapterIds: string[]
  scannedChapterHashes: Record<string, number>
  novelType: string
}

// ---- Emotion Curve ----

export interface PacingTemplate {
  battleRatio: number; transitionRatio: number; climaxRatio: number
  trainingRatio: number; socialRatio: number; avgChapterWords: number
}

export interface EventPattern {
  cycles: { name: string; chapterSpan: number }[]
  eventDensity: number
}

export interface ProgressionRhythm {
  levelCount: number
  pattern: string
  stages: { name: string; chapters: string; levelsGained: number; avgChaptersPerLevel: number }[]
}

export interface CharacterArchetype {
  archetypes: { role: string; function: string; arcSpan: string }[]
}

export interface EmotionCurve {
  segments: { chapterStart: number; chapterEnd: number; dominantEmotion: string }[]
  cycleLength: number
}
