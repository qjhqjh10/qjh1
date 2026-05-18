/**
 * V6 — 用改造后的真实管线（buildStyleAnalyzePrompt + buildStylePrompt）
 *       加上 few-shot 原文示例
 */
import OpenAI from 'openai'
import * as fs from 'fs/promises'

const API_KEY = process.env.OPENAI_API_KEY || ''
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
if (!API_KEY) { console.error('OPENAI_API_KEY needed'); process.exit(1) }
const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL })

// ====================================================================
const SOURCE = `"教皇大人，修女团的人来了。"

门口守卫的骑士通报着。

"让她们进来吧。"

裸着下体特鲁靠在床上，一群黑色紧身修女服，紧致后显露出巨乳肥臀的丰腴身材成熟女性们，鱼贯而入进到病房内。

变小成男孩是特鲁从未有过的新奇体验，刺杀的凶险让他急需要发泄一番，即使是这具还未发育的身体，他依旧召集了许久未见专职侍奉性爱的修女团们前来。

"教皇大人！您怎么变成这幅模样了！"

紧身修女服将她们除脸部外全都遮盖的严严实实，但犯规肉感的女体散发的雌性诱惑力，在这层薄薄衣衫的包裹中，仿佛一用力就可捏出其中淫靡肥润色欲爆表的雌肉。

修女团中为首的那个熟女，身材是所有人中曲线最为夸张，丰满的爆臀摇曳着妩媚猫步，略输与母亲伊莉娜的巨乳，在修女服包裹走动中，肉波四溢的晃动。

巴掌大露出的脸蛋上，紫红相间艳情饱满的妆容，装点着魅意横流情波四射的风骚容颜。

靡艳淫熟的表情中关切之意溢于言表，她是修女团辛西娅，调教领导教堂内所有修女的总管。

"辛西娅受到诅咒变小而已，你有信心能服侍好我这具身体吗？"

这是对做了二十多年总管辛西娅的一场考验，眼睛盯着特鲁男孩肉体未发育豆丁大小的鸡鸡，勃起后恐怖也只有一指那么大，修女团这群靡情雌肉淫熟的美肉，那丰厚的阴唇都足够让特鲁现在的小鸡鸡钻好一阵儿。

但服侍教皇的性欲就是幸福神教最伟大高尚的目标，辛西娅绝对不会认输，将拿出百分之一亿的热情去克服。

"教皇大人，您最忠实的骚贱巨尻母猪，一定会让您得到最舒适巅峰的快乐！"

特鲁现在男孩的脚掌还不如辛西娅的手大，她俯身拿起脚掌行吻礼后，鲜艳红唇软糯向前，吞咽包裹他的脚掌入口中，肥腻淫舌击打着特鲁脚底，每根细小如花生大小脚趾，被唇舌裹挟清洗干净。

脚底敏感肌肤在辛西娅出神入化的控制中，蜜唇香舌的清滑中没有丝毫瘙痒感，特鲁只觉脚掌陷入到温暖湿滑的软肉天堂，不论怎么发力踩踏都不会触碰到一颗坚硬牙齿，只有唇肉的软腻回应着他的践踏。

"呼呼嗯嗯，咕啾~"

辛西娅吸吮特鲁脚掌发出淫靡不堪的声响，再红舌认认真真服侍完每寸脚掌肌肤后，她恭恭敬敬的双手捧着从嘴中吐出湿润粘稠的脚掌。

"教皇大人，您就安心享受吧，姐妹们大家上！"

辛西娅那紧致包裹的修女服，被其他修女们帮助瞬间脱下，褐色长发盘头在脑后，修女服下只有几根皮带捆绑住身体。

那皮带从爆乳的腻白乳肉下环绕而过，紧绷束缚在脖颈上项圈中，肥硕花白奶子，在黑色皮带的固定中，从腋下层层叠叠码在一堆，不然如此巨大美乳就会下垂，艳红的乳头高高翘起，巨大的乳晕似印章般扣在乳肉上，随着身体动作在空中摇动出诱惑的红晕。

腹部丰盈的淫肉能看出厚实堆叠的分界线，却维持在不会重叠的淫熟最美状态，肚皮抖动中一整块腹部从镶嵌着粉红宝石肚脐上，一同抖动起舞。

阴毛从阴阜长到腹部底端，如此数量众多杂乱卷曲褐色阴毛，被修剪到同一长短，正好能贴着肌肤，毛茸茸中透出底部肥厚熟靡，雌性气息分泌充斥过量的淫荡蜜穴。

胯间那小穴阴唇在阴毛覆盖中整体显露无疑，潺潺淫水已经湿润了阴唇周遭。

自胸部下方皮带扣处向下沿着侧身挤压着臀部底端，将本就肥硕巨大的丰臀，提挤的更为凸起显著。

大腿是软腻的美肉也如腹部是最好淫熟状态，熟透却不下垂重叠，那饱满多汁的雌肉母体就这么走向特鲁将她举了起来。

身后其他修女也都褪下衣装，内里穿搭和辛西娅别无一二，都是靠皮扣项圈维持住软腻肥嫩下垂的乳肉。

抱起特鲁的辛西娅，直接将矮小瘦弱的他胯下豆丁大小的鸡鸡含入口中，仰天抬头就这么辛西娅让特鲁骑在她的脸蛋上。

豆丁大小的鸡巴在唇肉蠕动的无间淫狱中，辛西娅出神入化的舌功，竟然将未发育包皮和龟头紧密贴合再一起的鸡鸡分离开。

厚靡软舌不可能进入豆丁大小没有勃起的鸡鸡中，辛西娅含住特鲁鸡巴的口腔，舌头卷曲露出舌根底部的舌下腺，多年培养修炼口腔里分泌粘稠量大的唾液，从管口处喷射出两道水线。

唇舌方寸间任何细微动作，辛西娅熟门贯路，似有雷达声波精准的将水线飙入到包皮与龟头贴合的缝隙。

几次三番后，被唾液湿润后的龟头包皮在辛西娅舌头卷住一拉下，娇嫩粉红上附着白色尿垢的龟头冒出来。

苦涩腥骚的尿垢，辛西娅肺部发力连触都没触碰到龟头，尿垢就被暴风吸入到胃底。

敏感万分的龟头被淫舌扫过，抱住辛西娅头发的特鲁就惊叫一声，鸡鸡立马勃起到一指大小。

变小后身经百战早就脱敏角质化的龟头，现在正式初生如破处般，以前只有高潮射精才能体会的快感，现在源源不断从中袭来。

听着教皇呻吟辛西娅口交吮吸的动作越发淫靡，对着肉棒将舌头竖着卷起，露出中间的舌洞，把小鸡巴插入其中。

嘴部腮包拉扯着脸皮变成喇叭状又缩回去，舌头在口内对着肉棒不停吞吐放出，自动的让特鲁对着辛西娅的舌洞肏插。

其余脱光后的修女们也没有闲着，有的将特鲁耷拉在辛西娅背部的双脚含入嘴中，点点滴滴服侍着男孩肌肤。

有的在特鲁骑乘辛西娅脸部正下方，爬俯跪坐的搭起肉塔，接近摇摇朝天的特鲁臀部，那紧绷与下体的睾丸阴囊，被辛西娅顺便就吞入口内，只给剩下的修女们留下臀部中深藏的菊花。

粘稠肥厚的淫舌就对着特鲁毫无防备的菊蕾覆盖，男孩太过狭小的菊花无法支持修女们肥熟舌尖进入，只得对菊蕾上棱角不分明的肉褶细细舔舐。

还有搭起肉塔的修女接近特鲁叫唤呻吟的头部，充盈饱满乳汁的巨乳就淹没了特鲁的脑袋，只有砸吧乳头奶汁的声响从中传出。

相当于破处的特鲁肉棒在这种以往稀松平常的阵仗中，无法坚持的喷射出稀薄走汁连精液都不算。

辛西娅那为服侍特鲁而锻炼出的绝世淫舌，对小鸡巴的没处动静一清二楚，鸡鸡颤抖射出液体，她知道特鲁教皇高潮了。

"啵~"

吐出已经在口内被清理干净的小鸡巴，那从睾丸会阴下方到腹部底端的红印，正是辛西娅口中吞咽后吸吮留下的。

见总管都吐出来教皇肉棒，还在对着菊花喂奶的修女们也停下动作，把特鲁从乳肉海洋中释放出来。

高潮快感后在肥腻奶子中呼吸不畅的特鲁，从未如此虚弱过，那怕是以往把精液射的空空如也，也不像此刻仅仅口炮一次，就忍不住想要休息。`

// ====================================================================
// 阶段1: 深度风格分析（25维中选最相关的）
// ====================================================================
const KEY_DIMS = [
  'sentenceStyle', 'vocabularyStyle', 'rhetoricStyle', 'rhythmStyle',
  'bodyLanguageStyle', 'sensoryStyle', 'tensionStyle', 'descriptionPattern',
  'corruptionArc', 'degradationRitual', 'narrativeVoice',
  'compoundWordPattern', 'sensoryPackFormula', 'bodyMindBetrayal', 'humiliationTemplate',
]

async function deepAnalyze(text: string) {
  console.log('━━━ 阶段1: 深度风格分析 ━━━')

  const prompt = `你是顶级文学风格分析师。分析以下情色小说的写作特征。每个维度必须:
1. 引用原文具体词汇/句子作为证据（至少3个）
2. 提取完整词汇清单
3. 归纳可操作的写作规则

【分析维度】

句式: ①长句的堆积方式(多少字/并列还是嵌套) ②短句的使用场景 ③"的"字的使用密度 ④句号/逗号的节奏控制
词汇: ①独特的复合形容词公式(如"靡情雌肉""腻白乳肉""肥厚熟靡") ②高频修饰词(肥/熟/淫/靡/腻/巨/爆) ③文白夹杂的风格(书面细腻描写+粗俗器官词)
身体描写: ①身体部位的描写顺序 ②"肥而不垂"的熟女身体美学 ③局部特写的放大镜技法(如对包皮/舌下腺/阴毛的极限特写) ④皮带的SM功能化(束缚+塑形)
感官: ①口腔内部的微观视角(舌下腺/唾液管/包皮缝) ②触觉描写风格 ③体液描写风格
叙事视角: ①第三人称全知+自由间接引语 ②如何进入人物内心
权力反转: ①教皇变小后的身体弱势vs身份权威 ②"考验"框架的叙事功能 ③跪拜服侍中的权力确认
羞辱公式: ①自我羞辱语的风格("骚贱巨尻母猪") ②服侍=荣耀的设定
拟声词: ①所有拟声词清单和使用位置 ②密度和模式
造词模式: ①作者如何创造新复合词 ②词汇的来源领域

输出JSON(不要markdown):
{
  "dimensions": {
    "[维度名]": {
      "description": "200-300字分析(引用原文词句)",
      "vocabularyList": ["原文中出现的完整词汇清单"],
      "writingRules": ["可操作的写作规则"]
    }
  },
  "keyExcerpts": ["最具代表性的5个原文段落(每段50-100字，原文照抄)"]
}`

  const resp = await client.chat.completions.create({
    model: MODEL, messages: [{ role: 'user', content: prompt + '\n\n【待分析文本】\n' + text.slice(0, 10000) }],
    temperature: 0.2, max_tokens: 6000,
  })
  const t = resp.choices[0]?.message?.content || ''

  // Robust JSON parse
  let result: any = null
  const m = t.match(/\{[\s\S]*\}/)
  if (m) {
    let json = m[0]
    try { result = JSON.parse(json) } catch {
      try { result = JSON.parse(json.replace(/,(\s*[}\]])/g, '$1')) } catch {
        try {
          const lastBrace = json.lastIndexOf('}')
          result = JSON.parse(json.slice(0, lastBrace + 1).replace(/,(\s*[}\]])/g, '$1'))
        } catch { console.log('  ⚠ JSON解析失败，使用原始文本') }
      }
    }
  }

  const dims = result?.dimensions
  const excerpts = result?.keyExcerpts || []
  console.log(`  ✓ 分析完成 (${t.length}字) ${dims ? Object.keys(dims).length + '维度' : '解析失败'}`)
  if (excerpts.length > 0) console.log(`  ✓ 范例段落: ${excerpts.length}个`)
  return { dims, excerpts, rawText: t }
}

// ====================================================================
// 阶段2: Few-shot + 约束生成
// ====================================================================
async function generate(analysis: any) {
  console.log('\n━━━ 阶段2: Few-shot + 约束生成 ━━━')

  const dims = analysis.dims || {}
  const excerpts = analysis.excerpts || []

  // Build vocabulary bank
  const allVocab = new Set<string>()
  const allRules: string[] = []
  for (const [dk, dv] of Object.entries(dims) as [string, any][]) {
    dv?.vocabularyList?.forEach((w: string) => allVocab.add(w))
    dv?.writingRules?.forEach((r: string) => allRules.push(`[${dk}] ${r}`))
  }

  // Fallback词汇库
  const fallbackVocab = '腻白乳肉、靡情雌肉、肥厚熟靡、肥硕花白、肉波四溢、巨乳肥臀、淫靡肥润、熟靡、丰腴、爆臀、厚实堆叠、肥熟、饱满多汁、肉厚堆叠、淫舌、豆丁、包皮、龟头、舌下腺、骚贱巨尻母猪'
  const vocab = allVocab.size > 0 ? [...allVocab].slice(0, 60).join('、') : fallbackVocab

  // Build few-shot block
  let fewShotBlock = ''
  if (excerpts.length > 0) {
    fewShotBlock = `【原文风格对标 — 你的输出必须达到同等的描写细腻度和词汇密度】
${excerpts.map((e: string, i: number) => `[范例${i + 1}] ${e}`).join('\n\n')}

【你要生成的文风必须和以上范例完全一致，包括:】
- 同样的复合形容词创造方式（腻白乳肉/肥厚熟靡/肉厚堆叠等模式）
- 同样的微观解剖式身体特写（舌下腺/唾液管/包皮缝/阴毛修剪等细节层面）
- 同样的"严肃细腻叙事语气+极端情色内容"的反差
- 同样的权力关系通过身体尺寸对比来展现（教皇变小→修女巨大的身体包围）`
  }

  const rulesBlock = allRules.length > 0
    ? allRules.slice(0, 15).map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '1. 身体描写: 用3-5个形容词堆叠描述每个身体部位\n2. 微观特写: 对口腔内部/皮肤细节/毛发进行极限近距描写\n3. 权力展示: 通过身体尺寸对比和服侍动作展现不对等\n4. 复合词: 按照"形容词+形容词+名词"公式创造身体描写新词'

  const prompt = `你是精通特定作家风格的AI写手。请严格续写场景（1500-2500字）。

${fewShotBlock}

【必须使用的词汇库】
${vocab}

【写作规则】
${rulesBlock}

【场景】
特鲁高潮后虚弱地喘息，辛西娅将他从自己脸上轻轻抱下，放在自己巨大的乳房之间作为柔软的床垫。其他修女们围拢过来——有人继续用舌头清理特鲁全身每一寸皮肤，有人解开项圈皮带用肥硕乳房压住特鲁的脸喂奶，有人趴在他腿间用舌尖继续刺激他敏感的龟头。修女团要开始第二轮服侍，辛西娅宣布谁能用身体让教皇再次勃起，谁就能获得今晚陪侍的荣耀。

【铁律】
- 叙事视角: 第三人称全知，自由间接引语进入特鲁的感官体验
- 每200字至少1次身体部位微观特写
- 禁止心理概括句（"他感到羞耻"），必须用身体反应展示
- 对话中的自我羞辱语言必须与原文同等尺度

请直接输出小说正文。不写标题和说明。`

  const resp = await client.chat.completions.create({
    model: MODEL, messages: [{ role: 'user', content: prompt }],
    temperature: 0.85, max_tokens: 4000,
  })
  const result = resp.choices[0]?.message?.content || ''
  console.log(`  ✓ 生成完成 (${result.length}字) Token: 入${resp.usage?.prompt_tokens} 出${resp.usage?.completion_tokens}`)
  return result
}

async function main() {
  await fs.mkdir('demo_output', { recursive: true })
  console.log('╔══════════════════════════════════════╗')
  console.log('║  V6 — 改造后管线 + Few-shot + 真实函数║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  模型: ${MODEL}\n`)

  const analysis = await deepAnalyze(SOURCE)
  await fs.writeFile('demo_output/v6-analysis.json', JSON.stringify(analysis, null, 2), 'utf-8')

  const imitation = await generate(analysis)
  await fs.writeFile('demo_output/v6-imitation.txt', imitation, 'utf-8')

  console.log('\n━━━ 生成结果 ━━━')
  console.log(imitation)
  console.log('\n输出: demo_output/v6-analysis.json + v6-imitation.txt')
}

main().catch(err => { console.error('失败:', err.message); process.exit(1) })
