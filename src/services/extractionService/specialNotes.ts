// ── Type-specific special notes for style analysis ──
// Each note provides analysis guidance tailored to a specific novel type.
// Pattern: T0(总基调) → T1(技法核心) → T2(结构支撑) → T3(辅助)

export function getSpecialNote(novelType: string | undefined): string {
  switch (novelType) {
    case '情色小说': return EROTIC_SPECIAL_NOTE;
    case '修仙小说': return CULTIVATION_SPECIAL_NOTE;
    case '都市小说': return URBAN_SPECIAL_NOTE;
    case '恋爱小说': return ROMANCE_SPECIAL_NOTE;
    case '玄幻小说': return XUANHUAN_SPECIAL_NOTE;
    case '科幻小说': return SCIFI_SPECIAL_NOTE;
    case '奇幻小说': return FANTASY_SPECIAL_NOTE;
    default: return '';
  }
}

const EROTIC_SPECIAL_NOTE = `⚠️ 情色小说特别注意：

【格式要求】## 标题和 > 引用是必需的格式标记（解析器依赖它们）。除此之外不使用任何其他格式符号。公式和原文词例直接写进正文，不要用符号包裹。

【总基调层】
- narrativeTone — 叙述者用什么眼神看这个场景？是冷漠记录？是沉浸参与？是戏谑把玩？从原文提取1-2个关键词概括，附原文证据句。
- perspectiveStyle — 第几人称？叙述距离？一句话。
- descriptionPattern — 身体描写推进顺序？一句话。

【T1 技法核心】
- vocabularyStyle（选词+造词，T1）①②用公式格式输出，③④用描述性分析。①构造公式：每类词输出公式模板+从原文提取的1个真实词例+1个举一反三思路。②降格链：三级链格式，每级从原文提取真实词例。③定语堆叠和④物化方向用描述性分析。vocabularyStyle只管词本身，效果归rhetoricStyle。
- costumeStyle（衣着，T1）①衣物的情色化改造输出公式，从原文提取真实词例。②衣物对身体的力和③衣物作为触感中介用描述性分析。④权力差异：她穿什么他穿什么。
- sensoryStyle（感官，T1）①体液种类/脏化梯度/混合状态用描述性追踪。②气味作为情色引信用描述性分析。③触感阶梯输出为四级递进公式，每级从原文提取真实词例。
- rhetoricStyle（用词效果，T1）①描述性②③④公式格式。①比喻来源领域②借代压缩层级③排比清单化④反问羞辱。与vocabularyStyle分工：vocabularyStyle分析词本身，rhetoricStyle分析词组合后的效果。
- onomatopoeiaSystem（情色声音系统，T1）全部用公式格式输出——动作到声音编码表，每条从原文提取真实声音词例并附举一反三思路。

【T2 结构支撑】
- dialogueStyle（对话，T2）纯公式格式输出。①对白功能六类型每种从原文提取真实词例。②权力语言差异。③集体vs个体发声切换。
- bodyLanguageStyle（身体姿势语法，T2）纯公式格式输出。①扫描顺序②姿势解码公式③命令执行句式——从原文提取。
- degradationRitual（场景机制，T2）①④用公式格式，②③用描述性。
- bodyMindBetrayal（身心背离，T2）①背德内容②堕落路径③堕落后心理走向——从原文提取。
- humiliationTemplate（羞辱递进+羞耻循环，T2）合并shameVoyeurLoop。外部羞辱递进+内部羞耻循环。

【T3 辅助】moodStyle/narrativeVoice/shameVoyeurLoop各30-80字简述。corruptionArc已移除。`;

const CULTIVATION_SPECIAL_NOTE = `⚠️ 修仙特别注意：

【总基调层】
- narrativeTone — 叙述语气（飘渺出尘/热血逆天/杀伐果断/老谋深算），从原文提取1-2个关键词概括，附原文证据句。
- perspectiveStyle — 第三人称居多，注意视角切换时机（战斗/日常/破境），一句话即可。

【T1 技法核心】
- cultivationCombat（修炼战斗，T1）— 仙侠风格最核心维度。分析：①修炼体系命名规律（境界名称的用字偏好——单字/双字/四字、偏道教/佛教/自创）②战斗描写节奏（蓄力→爆发→余韵的段落比例）③破境仪式感（天地异象/灵气涌动/雷劫描写的固定模板）④法宝丹药的命名规则和描写密度。从原文提取每种模式的真实词例。
- sentenceStyle（句式）— 战斗场景的短句密度、日常场景的长句铺陈、破境时刻的排比句式。
- vocabularyStyle（词汇）— 仙侠特有词汇库：境界词、功法名、丹药名、法宝名、灵物名的构词公式。从原文提取每类词的构造模式。
- rhetoricStyle（修辞）— 破境描写的比喻来源（天地/星辰/洪荒/雷电）、战斗排比的触发场景。
- dialogueStyle（对话）— 前辈/晚辈语言等级差异、传音入密的描写方式、论道对话的术语密度。

【T2 结构支撑】
- rhythmStyle — 战斗/日常/破境三种场景的切换节奏。
- bodyLanguageStyle — 御剑/飞行/打坐/掐诀等仙侠特有身体动作的描写模式。
- sensoryStyle — 灵气感知（视觉+触觉为主）、丹药气味、天劫雷声。
- tensionStyle — 突破失败风险、宗门恩怨、正邪对立的张力升级方式。

【T3 辅助】moodStyle, descriptionPattern 简述。`;

const URBAN_SPECIAL_NOTE = `⚠️ 都市特别注意：

【总基调层】
- narrativeTone — 现实主义/讽刺/温情/冷酷，从原文提取1-2个关键词概括，附原文证据句。
- perspectiveStyle — 第一人称代入感强还是第三人称全景，一句话即可。

【T1 技法核心】
- socialRealism（社会现实，T2→提升注意）— 都市风格核心维度。分析：①阶层标记物（消费品品牌/住所地段/出行方式/衣着价位）②身份高低的空间关系（谁坐主位/谁站门口）③职场/商业术语的使用密度和自然度④口语的自然度（方言/流行语/脏话的使用场景）。从原文提取每种标记的具体词例。
- sentenceStyle — 口语化短句密度、内心独白占比。
- vocabularyStyle — 现代词汇：品牌名/网络用语/职场术语/金融词汇的出现频率和嵌入方式。
- dialogueStyle — 不同社会阶层的语言差异、电话/微信对话的格式。
- rhetoricStyle — 讽刺/反讽的使用频率、比喻来源（商业/科技/竞技）。

【T2 结构支撑】
- rhythmStyle — 职场/社交/私人三种场景的切换频率。
- bodyLanguageStyle — 现代社交动作：握手/递名片/看手机/喝咖啡的频率和描写方式。
- sensoryStyle — 城市感官：咖啡味/香水味/空调冷气/车流声的描写模式。
- tensionStyle — 职场竞争/阶层焦虑/人际博弈的张力升级方式。

【T3 辅助】moodStyle, descriptionPattern 简述。`;

const ROMANCE_SPECIAL_NOTE = `⚠️ 恋爱特别注意：

【总基调层】
- narrativeTone — 甜宠/虐心/轻松/沉重，从原文提取态度标记。
- perspectiveStyle — 女主第一人称还是男女双视角交替，一句话即可。

【T1 技法核心】
- romanceArc（感情发展，T1）— 言情最核心维度。分析：①关系阶段模板（初遇→在意→拉扯→确认→冲突→和解）②甜虐节奏比例（甜:虐的字数比和切换频率）③第三人/误会的作用方式④告白/确认关系的场景模板⑤亲密描写的含蓄度（牵手/拥抱/接吻的文字尺度）。从原文提取每个阶段的触发词和标志句。
- dialogueStyle — 男女对话风格差异、撒娇/毒舌/傲娇等角色语言标签、聊天记录的格式。
- sentenceStyle — 内心独白占比（言情通常>30%）、心理描写的句式特征。
- vocabularyStyle — 情感词汇库：心动/失落/期待的形容词密度和构词模式。
- moodStyle — 氛围渲染（雨天/星空/樱花等浪漫道具的使用模式）。

【T2 结构支撑】
- tensionStyle — 吃醋/误会/分离/情敌出现的张力升级方式。
- bodyLanguageStyle — 亲密动作的渐进描写（目光→牵手→拥抱→接吻的推进节奏）。
- sensoryStyle — 对方身上的气味/温度/触感的描写模式。
- rhetoricStyle — 暗恋比喻（星星/月亮/季节）、排比的触发场景。

【T3 辅助】descriptionPattern, rhythmStyle 简述。`;

const XUANHUAN_SPECIAL_NOTE = `⚠️ 玄幻特别注意：

【总基调层】
- narrativeTone — 热血/霸气/逆袭，从原文提取1-2个关键词概括。
- perspectiveStyle — 第三人称跟随主角为主，注意是否有群像视角切换。

【T1 技法核心】
- cultivationCombat（修炼战斗，T1）— 境界体系命名、功法神通命名规律、战斗描写节奏。
- vocabularyStyle — 玄幻特有词汇密度和构词公式（XX之体/万古/九天/混沌等模式），从原文提取。
- rhetoricStyle — 夸张手法的使用频率、排比的触发场景（功法描述/战力对比）。
- compoundWordPattern（造词模式，T2→提升注意）— 玄幻的自造词密度远高于其他类型。分析：造词来源领域（太古/洪荒/星域/神兽）、[修饰]+[主体]的构词公式。从原文提取自造词清单和构造模式。
- sentenceStyle — 高潮场景的长排比句、日常的短对话交替模式。

【T2 结构支撑】
- rhythmStyle — 战斗/修炼/日常三种场景的循环切换节奏。
- bodyLanguageStyle — 飞行/战斗/服丹/盘坐的描写模式。
- sensoryStyle — 灵气感知、突破时的天地异象视觉+声音描写。
- tensionStyle — 战力巅峰/仇敌追杀/秘境探索的张力结构。

【T3 辅助】archaicStyle（古风感，文白比例+称谓系统）、moodStyle, descriptionPattern 简述。`;

const SCIFI_SPECIAL_NOTE = `⚠️ 科幻特别注意：

【总基调层】
- narrativeTone — 冷峻客观/探索好奇/末世警示，从原文提取。
- perspectiveStyle — 第三人称广角为主，也可能多视角交替。

【T1 技法核心】
- socialRealism（社会现实，T2→提升注意）— 科幻的核心是科技对社会的影响。分析：①技术如何改变社会阶层（基因改造/义体/芯片植入的阶层标记）②未来世界的物质细节（消费品/交通工具/居住空间的描写密度）③技术术语的使用方式（解释密度/术语的上下文嵌入方式）。从原文提取每种标记的具体词例。
- vocabularyStyle — 科技术语库：自造技术名词的构词公式。
- sentenceStyle — 技术说明段落与叙事段落的句式差异。
- descriptionPattern — 世界设定的交代方式（通过剧情自然揭示 vs 旁白直接说明）。
- rhetoricStyle — 比喻来源领域（科技/宇宙/生物/数据）。

【T2 结构支撑】
- rhythmStyle — 技术说明/行动/思考的段落交替节奏。
- sensoryStyle — 未来世界的感官描写（金属味/臭氧味/HUD显示）。
- tensionStyle — 技术伦理困境/人类vs机器的张力升级方式。
- bodyLanguageStyle — 人机交互/增强改造的动作描写模式。

【T3 辅助】moodStyle, dialogueStyle 简述。`;

const FANTASY_SPECIAL_NOTE = `⚠️ 奇幻特别注意：

【总基调层】
- narrativeTone — 史诗/冒险/黑暗，从原文提取1-2个关键词。
- perspectiveStyle — 多视角POV还是单线跟随，一句话即可。

【T1 技法核心】
- vocabularyStyle — 奇幻命名体系：西幻（人名/地名/种族名/魔法的外语来源——拉丁/凯尔特/北欧风格）、东方奇幻（自造汉字词）、魔法体系的术语一致性。从原文提取命名模式。
- compoundWordPattern（造词模式，T2→提升注意）— 奇幻自造词密度极高。分析：种族名/魔物名/地名/魔法的构词公式和来源语言模式。
- sentenceStyle — 西幻的翻译腔句式（长定语/倒装/被动语态的使用频率和功能）。
- rhetoricStyle — 史诗比喻来源（神话/自然/战争/龙）。
- moodStyle — 世界氛围：黑暗/光辉/神秘的色调偏好。

【T2 结构支撑】
- rhythmStyle — 冒险/战斗/休息/政治的多线切换节奏。
- bodyLanguageStyle — 剑与魔法战斗动作、魔法吟唱、种族特有动作的描写模式。
- sensoryStyle — 魔法感知（视觉+听觉为主）、奇幻生物的气味。
- tensionStyle — 种族冲突/王国战争/神的干预的张力升级方式。

【T3 辅助】socialRealism（种族/阶级的社会结构）、descriptionPattern, archaicStyle 简述。`;
