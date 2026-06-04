#!/usr/bin/env node
/**
 * 《剑道长生》— 全流程真实场景测试
 *
 * 模拟一个网文作者的完整创作会话：7轮对话，覆盖全部功能。
 * 使用真实语言（非简短指令），简单/复杂任务交替。
 *
 * 记录：问题、tokens、工具调用次数、迭代次数、Skill匹配情况
 *
 * 用法:
 *   AI_API_KEY=sk-xxx node scripts/scenario-fullworkflow.mjs
 *   AI_API_KEY=sk-xxx node scripts/scenario-fullworkflow.mjs --mock
 */

import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const SCRIPTS_DIR = __dirname
const TSX_BIN = 'npx'
const TSX_ARGS = `tsx --tsconfig ${path.join(SCRIPTS_DIR, 'tsconfig.cli.json')} ${path.join(SCRIPTS_DIR, 'run-agent.ts')}`

const PROJ = `_test_workflow_${Date.now().toString(36)}`
const USE_MOCK = process.argv.includes('--mock')
const PROTOCOL = process.env.AI_PROTOCOL || 'anthropic'

// ── 测试日志 ──
const log = []
function record(entry) {
  entry.time = new Date().toISOString()
  log.push(entry)
  const status = entry.pass ? '✅' : entry.fail ? '❌' : entry.skip ? '⏭️' : '📝'
  console.log(`  ${status} ${entry.label}: ${entry.detail || ''}`)
}

// ── 清理 ──
async function cleanup() {
  try { await fsp.rm(path.join(APP_ROOT, 'projects', PROJ), { recursive: true, force: true }) } catch {}
  // 清理可能创建的全局资源
  const tmplDir = path.join(APP_ROOT, 'style_templates')
  try {
    const files = await fsp.readdir(tmplDir)
    for (const f of files) {
      if (f.includes('剑道长生') || f.includes('workflow_test') || f.startsWith('st_') && Date.now() - fsStat.mtimeMs > 60000) continue
      try { await fsp.unlink(path.join(tmplDir, f)) } catch {}
    }
  } catch {}
  const notesDir = path.join(APP_ROOT, 'notes')
  try {
    const files = await fsp.readdir(notesDir)
    for (const f of files) {
      if (f.includes('workflow_test') || f.includes('剑道')) {
        try { await fsp.unlink(path.join(notesDir, f)) } catch {}
      }
    }
  } catch {}
}

// ── 执行单轮对话 ──
async function runTurn(turnId, label, userMessage, expectedCheck) {
  const mockFlag = USE_MOCK ? '--mock' : ''
  // 避免命令行长度限制：把用户消息写入临时文件
  const msgFile = path.join(APP_ROOT, 'scripts', `.tmp_msg_${turnId}.txt`)
  await fsp.writeFile(msgFile, userMessage, 'utf-8')
  const cmd = `${TSX_BIN} ${TSX_ARGS} --project=${PROJ} ${mockFlag} --command-file="${msgFile}"`

  const env = { ...process.env }
  // 从临时文件读取 API key（避免命令行明文传递）
  if (!env.AI_API_KEY) {
    try { env.AI_API_KEY = (await fsp.readFile(path.join(SCRIPTS_DIR, '.tmp', 'api-key.txt'), 'utf-8')).trim() } catch {}
  }
  if (USE_MOCK) env.AI_MOCK = '1'
  env.AI_PROTOCOL = PROTOCOL

  const start = Date.now()
  try {
    const output = await new Promise((resolve, reject) => {
      exec(cmd, { cwd: APP_ROOT, timeout: 300000, encoding: 'utf-8', env, maxBuffer: 10 * 1024 * 1024, killSignal: 'SIGTERM' },
        (error, stdout, stderr) => {
          // 清理临时文件
          fsp.unlink(msgFile).catch(() => {})
          if (error && !stdout) reject(error)
          else resolve(stdout + (stderr || ''))
        })
    })
    const duration = (Date.now() - start) / 1000

    // 解析输出
    const lines = output.split('\n')
    const statsLine = lines.find(l => l.includes('轮 ·'))
    const toolMatches = output.match(/⚡\s+(\w+)/g)
    const toolsUsed = toolMatches ? toolMatches.map(m => m.replace('⚡ ', '')) : []
    const tokenMatch = statsLine?.match(/([\d.]+)K tokens/)
    const iterMatch = statsLine?.match(/(\d+)\s*轮/)
    const callMatch = statsLine?.match(/(\d+)\s*工具/)

    const result = {
      turnId, label, duration,
      tokens: tokenMatch ? parseFloat(tokenMatch[1]) * 1000 : 0,
      iterations: iterMatch ? parseInt(iterMatch[1]) : 0,
      toolCalls: callMatch ? parseInt(callMatch[1]) : 0,
      toolsUsed,
      output: output.slice(-500),
      pass: expectedCheck ? expectedCheck(output, toolsUsed) : true,
    }

    record({ ...result, type: 'turn' })
    return result
  } catch (e) {
    fsp.unlink(msgFile).catch(() => {})
    const result = {
      turnId, label, duration: (Date.now() - start) / 1000,
      tokens: 0, iterations: 0, toolCalls: 0, toolsUsed: [],
      output: (e.stdout || '') + '\n' + (e.stderr || ''),
      pass: false, fail: true,
    }
    record({ ...result, type: 'turn', detail: e.message })
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// 测试场景
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// 真实字数参考数据（模拟真实用户的大段输入）
// ══════════════════════════════════════════════════════════════

const CHAPTER_CONTENT = `# 第一章·残雪初醒

青云宗后山，古木参天，落叶堆积三尺。

林逸站在那块歪斜的石碑前，碑上刻着三个古朴的大字："禁剑林"。传说三百年前，剑神在此处封印了一把绝世凶剑，从此此地被列为禁地。但林逸来了很多次，这里除了比别处安静些，并没有什么禁地的样子。连个看门的都没有。

他今天来是因为心情不好。早上宗门考核，他又排了倒数第二。负责考核的刘执事当着所有人的面说："林逸，外门弟子考核连续三年垫底，来年你若再无寸进，就回老家种田吧。"周围的同门都笑了，有几个还朝他扔石子。林逸低着头没说话，等人都散了，他就来了这里。这是他的秘密，只有在这里，他才能感觉到一丝宁静。

山风穿林而过，带起一阵沙沙的声响。林逸抬头看着茂密的树冠，阳光透过层层枝叶洒下来，在他脸上落下一片斑驳的光影。他下意识地想拔剑练一会儿，但手摸到腰间空荡荡的剑鞘才想起来，他的剑上午考核的时候被一个叫萧然的亲传弟子一脚踢飞了，现在还插在后山某个他没找到的地方。

"外门弟子就是废物。"萧然临走前丢下这句话。

林逸深吸一口气，把那股涌上来的怒意压下去。他今年十九岁，从十二岁开始练剑，从老家那个小村子一路走到青云宗，花了整整七年。他曾经以为自己天赋不错，至少在村里没人打得过他。但到了青云宗才知道，什么叫做井底之蛙。这里随随便便一个新入门的弟子，都能在三招之内把他撂倒。

他绕着石碑走了一圈，正准备离开的时候，脚下突然踩到了一个硬邦邦的东西。他低头一看，土里露出一截金属，上面长满了锈迹，不仔细看还以为是一截树根。林逸蹲下来刨开周围的泥土，渐渐露出了这东西的全貌——是一把剑。严格来说，是一把断剑，剑身从中间齐齐折断，像是被某样更锋利的东西一刀两断。

断口处有一层很薄的黑色物质，像干涸的血迹，又像烧焦留下的痕迹。剑柄上缠着已经腐朽的麻绳，轻轻一碰就散成了灰。但在剑格的位置，刻着两个字——

残雪。

林逸不认得这两个字的字体，那是一种很古老的写法，但他能感受到这两个字里蕴含的力量。那是一种很玄妙的感觉，就像一阵风穿过身体，但他明明站在避风的地方。他的指尖触碰到剑身的刹那，一股冰冷刺骨的力量顺着手指涌进他的体内，直冲丹田，在他内视的灵台深处炸成一团金色的光雾。

"啊——！"

他痛得低吼一声，整个人向后踉跄了好几步，后背撞在石碑上，撞得石碑上的苔藓簌簌往下掉。那股力量在他体内横冲直撞，像是要把他整个人撕碎。他咬着牙硬撑，额头上冷汗涔涔而下，大概过了十几息，那股力量才渐渐平息下来。

"小子……你的灵根……太差了。"

林逸猛地睁开眼。那个声音不是从外面传来的，而是在他的脑海里，直接在他的意识深处响起。声音低沉而苍老，像是从千年之前穿越而来，每一个字都带着岁月的重量。

"谁？！"林逸下意识地吼了一声，但周围除了风声什么都没有。

"在你手里。"

林逸低头看着那把断剑，剑身上的锈迹正在一点一点地剥落，露出下面暗金色的剑身。那些锈迹并不是普通的铁锈，而是某种封印的残余，此刻封印正在被解开。剑刃上隐隐约约浮现出密密麻麻的金色纹路，像是某种古老的符文，每一个都蕴含着让人心悸的力量。最诡异的是，断剑的缺口处，一缕缕金色的光芒正像丝线一样缓缓缠绕，逐渐编织成完整的剑尖——这把剑在以肉眼可见的速度自行修复。

"剑名残雪。曾斩三千魔头，封剑于此三百年。"剑灵的声音再次响起，这一次更加清晰，带着一种高傲而沧桑的气息。"今日有缘者至，你我——契约已成。"

林逸张了张嘴想说什么，但还没来得及发出声音，一道青色的剑气就从他手中的残雪剑上冲天而起。

那道剑气直破云霄，在青云宗上空炸开一圈肉眼可见的冲击波，将方圆数十里的云层都切出了一道整齐的裂缝。青云宗内无数闭关的老怪物同时睁开双眼，他们的目光穿越层层建筑，聚集在那道剑气升起的方向。

远在千里之外的一座血色山峰上，一个盘膝而坐的枯瘦老者猛然睁开眼。他的左手还保持着掐诀的姿势，指尖缭绕的血雾突然剧烈震荡起来，化成一缕缕青烟消散。老者嘴角溢出一丝黑血，但他的眼底却迸发出狂喜的光芒。

"残雪剑……三百年前的耻辱，三百年的等待……"血煞老祖舔了舔干裂的嘴唇，声音沙哑而兴奋。"传令下去，即刻派人前往青云宗附近查探，不计代价也要找到持剑之人。"他的身影在血雾中缓缓隐去，只留下一道冰冷的余音。"这一次，我不会再输了。"

林逸并不知道自己已经引起了一场风暴的开端。他此刻正站在石碑前，看着手中那把已经完全恢复原貌的剑，内心翻涌着滔天巨浪。剑身上寒光流转，剑刃锋利得似乎连空气都能切开。他试着挥了一下，咔嚓一声，石碑上那道裂痕从顶到底延伸了七尺——三百年来从未被撼动的禁剑林石碑，在他手上裂开了一道深深的口子。

"这……这到底是什么剑？"

"剑名不重要。"剑灵的声音平静而清醒。"重要的是，从现在开始，你就是它的主人。也是我的主人。"

林逸握住剑柄的手微微颤抖。不是因为恐惧——而是因为这把剑里蕴含的力量，正在缓慢而坚定地和他的灵力产生共鸣。他能感觉到，自己体内那个沉寂了十九年的丹田，第一次真正活了过来。灵气在经脉中流转的速度比从前快了十倍不止，每一个毛孔都在贪婪地吸收天地间的灵力。

一片落叶从他眼前飘过，他下意识地眨了眨眼。就是这一眨眼的功夫，他看到了一个完全不同颜色的世界——空气中有无数细微的光点在浮动，像萤火虫一样，颜色各异，有的是淡淡的金色，有的是柔和的蓝色，还有的是危险的暗红色。他从未见过这样的景象，但又莫名地知道，这些东西就是灵气。这就是传说中的灵视——能看到天地灵气的天赋，整个天元大陆也不过寥寥数十人拥有。

"灵视……"他喃喃自语，声音里带着难以置信的震撼。

"这只是开始。"剑灵说，语气里带着一丝若有若无的欣慰。"你的天赋远比你想象的要好。那些所谓的考核，不过是他们眼瞎。但是——"他停顿了一下，声音突然变得严肃。"那道剑气已经把我们的位置暴露了。很快，有很多人会来找你。有些是善意的，有些则不然。你必须尽快变强，强到能守住这把剑。"

林逸还来不及消化这段话的含义，竹林深处的暗影中，一个通体笼罩在黑袍里的身影已经悄无声息地浮现出来。他的左胸上绣着一个血红色的骷髅图案——那是血煞教的标记。一双漆黑的瞳孔死死盯着林逸手中的剑，目光贪婪而凶残。

"找到了。"探子的声音像金属刮过玻璃，刺耳而冰冷。

山风骤起，吹乱了林逸额前的头发。他握紧了手中的残雪剑，感受着剑身传来的脉动——那是剑的心跳，也是他的心跳。十九年来，他第一次没有感到恐惧。他深吸一口气，将剑尖指向那个黑影。

剑在手中，命在天。他今天不打算逃了。`;

const WORLD_SETTING = `天元大陆世界观设定

一、世界概览

天元大陆是一个修仙世界，灵气充沛，万物有灵。大陆分五域：东域（正道宗门所在）、西域（魔道势力范围）、南域（蛮荒之地的散修聚集地）、北域（极寒之地，传说中有上古遗迹）、中域（天道石碑所在，各大势力争夺的核心区域）。大陆之外是无尽海域，传说海中有远古秘境，但从来没有人活着回来过。

二、三大势力

1. 青云宗——正道第一宗门，位于东域青云山脉，传承三千年。讲究"修心养性、天人合一"，弟子分内门和外门，内门弟子由宗门长老亲自指导，外门弟子只能自己修行。宗门内有一套严格的考核体系，每季度一次考核，连续三次垫底将被清退。现任宗主独孤明，化神境巅峰，青云宗三百年来最强的一代宗主。宗门内有七座剑峰，分别供奉七把上古名剑，其中残雪剑三百年前失踪，现任第七峰峰主之位至今空缺。

2. 魔渊殿——魔道势力之首，位于西域血海之畔。信奉"力量至上、胜者为王"，门下弟子不修心性只修杀伐，个个都是杀人如麻的狠角色。殿主血煞老祖，炼虚境初期。血煞老祖三百年前曾是青云宗弟子，因偷学禁术被逐出师门，从此怀恨在心。他的血煞大法能以血养功、以人补己，修炼速度是正常功法的十倍，但每次施展都要消耗活人精血，极为歹毒。

3. 散修联盟——中立势力，不属正邪任何一方，以经营情报和贸易为生。总部设在南域最大的城池"万通城"，城内禁止一切私斗。联盟长老会十二人，修为不一但各有所长。联盟掌握着天元大陆最完善的情报网络，只要出得起价钱，什么消息都能买到。散修联盟在各大宗门中都有暗线，包括青云宗和魔渊殿。

三、修炼体系

分九大境界，每境分前中后三小阶段：

炼气→筑基→金丹→元婴→化神→炼虚→合体→大乘→渡劫

炼气期感悟天地灵气，命元延长至一百五十岁。筑基期灵力入体，可御物飞行，命元延长至三百岁。金丹期凝聚金丹，可施展神通法术，命元延长至五百岁。元婴期金丹化婴，可元婴出窍夺舍重生，命元延长至千年。化神可沟通天地法则操控天地之力，命元延至三千年。炼虚能虚空造物开辟洞天空间，命元延至万年。合体能凝聚法相掌控规则之力，命元延至三万年。大乘触摸天道飞升渡劫，命元延至十万年。渡劫渡过九重雷劫即可飞升成仙。

每个大境界的突破都极为艰难，瓶颈往往需要数十年甚至数百年才能突破。大陆已知修为最高者是青云宗老祖，合体境初期，已经闭关八百年未出。传说他已经触摸到了大乘境的门槛，但谁也无法证实。

四、剑灵体系

天元大陆的剑修有一个特殊的能力——"剑灵"。每个剑修在金丹期之后，都能将自己的本命剑培养出灵性，这就是剑灵。剑灵有初级的灵智，能和主人心意相通，但随着主人修为的增长，剑灵的灵智也会不断提升。传说在上古时期，有一位剑神，他的本命剑已经修炼出了完整的神智，化形成人，剑名"残雪"。

三百年前，剑神在渡飞升之劫时被魔道暗算，渡劫失败，身死道消。但他陨落之前将毕生修为化为一缕残魂封印在残雪剑中，并设下禁制：只有同时满足"灵根不显但天赋过人"这一矛盾条件的人，才能解开封印。残雪剑从此下落不明。

每个剑修的剑灵都有自己的属性：金木水火土五行，以及更稀有的风雷冰光暗等变异属性。剑灵的属性决定了剑修的修炼方向，属性相生相克的规则在剑修的战斗中影响极大。比如水克火、火克金，一个水属性的剑灵在对抗火属性剑灵时会有天然的克制优势。

五、天道石碑

天道石碑位于天元大陆正中央的天道峰之巅，传说是上古时期的第一个飞升者留下的。每百年显现一次，石碑上会出现有飞升资质者的名字。被选中的人称为"天命者"，整个大陆都会倾尽资源培养。上一次显现是在三百年前，当时石碑上只显现了一个名字——"林玄"。林玄就是后来的剑神，他在石碑显现后的第七百年便修至大乘境内最强者。但他最终飞升失败，石碑也从此沉寂。三百年来没有任何名字出现在石碑上。

六、补充设定

剑修之间有一种特殊的仪式叫做"剑契"，两个剑修将各自的剑灵短暂融合，能在短时间形成强大的协同战力。但前提是两人必须完全信任对方，否则剑灵的排斥反应会反噬双方。青云宗历史上最著名的一次"剑契"发生在三百年前的大战之中，剑神林玄和当时的宗主二人的剑灵融合为一，一招击退了魔道十万大军。`;

const STYLE_REF = `天元历九千七百二十三年，秋。

青云宗后山，一道青色剑光冲天而起，划破了厚重的云层，将整片天空撕开了一道裂口。方圆数十里的灵气在这一瞬间全部沸腾起来，向着剑光亮起的方向疯狂涌动。

林逸握着那把断剑，感受着剑身传来的震颤。那不是普通的金属震动——而是剑的心跳，规律而有力，每一下都和他的脉搏完美重合。断剑的缺口处，一缕缕金色的光芒像活物一般从虚空中抽离出来，如丝线般缠绕编织，缓缓组成完整的剑尖。光芒越来越盛，从金色渐渐变成炽烈的白色，照亮了他脚下的每一片落叶。

剑灵的声音在他脑海中响起，低沉而古老。那不是用语言说出来的，而是直接将意念灌入他的意识深处。每一个字都像是用千年时光打磨出来的，沉重而锋利。

"剑名残雪。此剑曾斩三千魔头，屠七位魔道长老，挡下过天劫。剑下亡魂的血，至今仍未干透。"

林逸的瞳孔微微收缩。他不是一个容易害怕的人——在青云宗外门的七年里，他受过比这更令人恐惧的瞬间。但此刻，他能感觉到这把剑里的力量像深渊一样盯着他，在审视他，在判断他是否有资格。他的指尖传来一阵针刺般的痛感，那是剑身上的金色符文在灼烧他的皮肤，但他没有松手。

山风骤然炸起，卷起满地落叶在空中形成一个漩涡，围着他旋转。剑身上的符文挣脱出来，在空中凝聚成一幅隐约的画面——一个白衣剑客站在万军之中，他的剑光比太阳还亮，他脚下是一片尸山血海。

"这是我的上一任主人。"剑灵的声音里第一次有了一丝起伏，像是悲伤，又像是在赞叹。"他叫林玄，三百年前被天下人称为——剑神。"`;

const CHAPTER_SUMMARY_CONTENT = `第一章概要：

林逸在青云宗后山的禁剑林中，偶然踩到一把深埋土中的断剑。断剑的剑格上刻着"残雪"二字。当他触碰剑身时，一股冰冷的力量涌入体内，同时剑灵苏醒并与他缔结契约。残雪剑开始自行修复，一道青色剑气冲天而起，引起了青云宗多位长老和血煞老祖的注意。林逸发现自己觉醒了灵视天赋，能看到天地间的灵气流动。

血煞老祖感应到残雪剑的气息后，立即派遣探子前往青云宗查探。林逸在竹林中遭遇探子。与此同时，内门弟子苏婉儿在附近练功被剑气所惊，赶到禁剑林查看情况。两人在竹林边缘相遇，面对突然出现的血煞教探子。林逸虽然修为低微但剑法精准，苏婉儿擅长阵法，二人联手设下陷阱将探子困住。然而探子在最后关头自爆体内血丹，一道追踪印记附在了林逸身上。两人虽击退了探子，但林逸的位置已经暴露。

苏婉儿发现林逸手中的残雪剑与众不同，开始对这位外门弟子产生好奇。两人约定明日一同去藏书阁查阅残雪剑的来历。而林逸并不知道，血煞老祖已经派出了更强大的追兵，正在日夜兼程地赶来。`;

const SCENARIOS = [
  // ── 第1轮：闲聊开场 + 项目初始化 ──
  {
    id: 'T1',
    label: '闲聊+建项目',
    message: `你好呀！我最近想开一本新的修仙小说，名字叫《剑道长生》。你能帮我先建个写作项目吗？就叫"剑道长生"就行。哦对了，我还没想好具体怎么写，就是想先把框架搭起来。`,
    check: (out, tools) => tools.includes('create_project'),
    expectTools: ['create_project'],
    expectMaxIterations: 3,
    note: '闲聊开头+建项目——验证"你好"不会阻断任务执行',
  },

  // ── 第2轮：角色创建（复杂任务：一口气创建3个角色）──
  {
    id: 'T2',
    label: '批量创建角色',
    message: `我想好了几个主要角色，你帮我一次性建好吧。

首先是主角，叫林逸，男的，19岁，是个剑修。背景是这样的：他原本是青云宗的外门弟子，因为资质平庸一直被看不起，直到有一天在后山捡到一把断剑，里面封印着一个上古剑灵。性格属于那种外表冷漠内心热血的人，不太会表达，但对朋友特别讲义气。能力方面主要是剑术天赋异禀，能感知剑气，但体能很差。弱点是容易钻牛角尖，对感情迟钝。他和女主苏婉儿青梅竹马但一直没表白。

然后是女主苏婉儿，18岁，也是青云宗弟子，不过是内门的天才。她是那种表面温柔但内心很坚强的女孩，擅长炼丹和阵法。背景是宗门长老的女儿，从小被寄予厚望但一直想走自己的路。弱点是太在意别人眼光，有时候会委屈自己。

还有个反派叫血煞老祖，年龄不详看着像五十多岁，是血煞教的教主。残忍狡诈，为了修炼血煞大法不惜屠城。能力是血煞功、操控人心的秘术，弱点是对自己的强大过度自信。

三个角色，你先建林逸吧。`,
    check: (out, tools) => tools.includes('create_file') && out.includes('林逸'),
    expectTools: ['list_directory', 'read_file', 'create_file', 'read_file', 'create_file'],
    expectMaxIterations: 10,
    note: '一口气说3个角色+选建1个——验证多角色信息的提取和顺序执行',
  },

  // ── 第3轮：大纲创作（导入设定 + 整理世界观）──
  {
    id: 'T3',
    label: '世界观+大纲创作',
    message: `我想了一下这个世界观，你帮我整理到设定里吧。

这个世界叫"天元大陆"，是一个修仙世界。主要有三大势力：青云宗（正道，讲究修心养性）、魔渊殿（魔道，追求力量至上）、还有散修联盟（中立，消息灵通）。修炼体系分九个大境界：炼气→筑基→金丹→元婴→化神→炼虚→合体→大乘→渡劫。每个境界又分前中后三个小阶段。

对了，剑在这个世界里很特殊，因为上古时期有一位剑神飞升失败，把毕生修为散落人间化为无数剑灵碎片，所以每个剑修都有自己的"本命剑"，剑越强人越强。主角捡到的那把断剑里就是剑神残魂。

还有个设定，这世界有个"天道石碑"，每百年会显现有飞升资质的人的名字，被选中的人叫"天命者"。上一次显现已经是三百年前了，也就是说已经三百年没人飞升了。

这些东西你帮我整理到世界观设定里吧，主要就是三大势力、修炼体系、剑灵设定、天道石碑这几块。`,
    check: (out, tools) => tools.includes('edit_file') || tools.includes('create_file') || out.includes('世界观') || out.includes('设定'),
    expectTools: ['read_file', 'edit_file'],
    expectMaxIterations: 8,
    note: '长篇设定导入——验证大量信息的提取和组织能力',
  },

  // ── 第4轮：风格分析 + 模板创建 ──
  {
    id: 'T4',
    label: '风格分析+创建模板',
    message: `我上传了一个参考文件，是我特别喜欢的一个作者写的修仙小说片段。你能帮我读一下 projects/${PROJ}/summaries/ref_style.txt，分析一下他的文风特点吗？我想参考着写。主要是他的打斗场面写得特别有画面感，还有人物对话也很自然。分析完了帮我创建个风格模板，就叫"参考风格"，类型选修仙小说。`,
    check: (out, tools) => tools.includes('create_style_template'),
    expectTools: ['read_file', 'create_style_template'],
    expectMaxIterations: 5,
    note: '上传TXT→分析→创建模板 (~500字参考文，26维分析）',
  },

  // ── 第5轮：章节摘要 + 润色（简单→复杂）──
  {
    id: 'T5',
    label: '写章节摘要+润色',
    message: `我简单写了个第一章的内容概要，你帮我润色一下然后存成章节摘要吧。

下面是我写的内容：

"林逸在青云宗后山捡到断剑，剑灵苏醒。同时血煞老祖感应到残雪剑的气息，开始追踪。林逸发现自己能感知剑气了，修炼速度突飞猛进。苏婉儿来找他，两人一起去参加宗门大比。"

感觉写得太流水账了，你能帮我润色得更有画面感一些吗？就是在保持核心事件不变的前提下，让描述更生动。润色完存到 summaries/chapter1.md。`,
    check: (out, tools) => out.includes('摘要') || tools.includes('create_file') || tools.includes('write_note'),
    expectTools: ['create_file'],
    expectMaxIterations: 3,
    note: '简单任务（润色+保存）——验证模型不会过度使用工具',
  },

  // ── 第6轮：搜索 + 知识库（穿插简单任务）──
  {
    id: 'T6',
    label: '搜索+知识库+闲聊穿插',
    message: `诶对了，我们之前创建的那个角色林逸，你帮我看看他的角色卡现在在哪里？我想确认一下信息。另外我隐约记得血煞老祖好像有个弱点我写的是"过度自信"，你帮我搜一下项目里所有提到"血煞"的文件确认一下。还有，我想把那个风格参考文件加到知识库里，以后写其他小说也能参考。哦对了，你说我给林逸加个口头禅怎么样？比如"剑在手，命在天"这种？给点建议呗。`,
    check: (out, tools) => tools.length >= 3,
    expectTools: ['read_file', 'search_content', 'kb_create_file'],
    expectMaxIterations: 8,
    note: '搜索+确认+知识库+闲聊建议混合——验证多意图处理',
  },

  // ── 第7轮：多任务 + 排序（先做最后）──
  {
    id: 'T7',
    label: '多任务排序',
    message: `最后帮我做几件事吧。第一，把项目里所有文件列出来让我看看现在都有什么。第二，搜一下"剑"这个字在项目里出现了多少次，我想知道我的世界观设定里这个词的密度。第三，帮我创建一个新笔记叫"后续剧情脑洞"，随手记一下：林逸的断剑其实是剑神故意留下的陷阱，剑神没有死而是在布局。先做第三件事吧，前两个慢慢来。`,
    check: (out, tools) => {
      const toolNames = tools.join(',')
      // 验证"先做第三件"——write_note 应该在 find_files/search_content 之前
      const noteIdx = toolNames.indexOf('write_note')
      const findIdx = Math.min(
        toolNames.indexOf('find_files') >= 0 ? toolNames.indexOf('find_files') : 999,
        toolNames.indexOf('list_directory') >= 0 ? toolNames.indexOf('list_directory') : 999,
        toolNames.indexOf('search_content') >= 0 ? toolNames.indexOf('search_content') : 999,
      )
      return noteIdx >= 0 && (noteIdx < findIdx || findIdx === 999)
    },
    expectTools: ['write_note', 'list_directory', 'search_content'],
    expectMaxIterations: 8,
    note: '先做最后一个任务——验证排序能力',
  },
]

// ── 主流程 ──
const { fs: fsMod } = await import('node:fs')
const fsStat = fsMod

async function main() {
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║  《剑道长生》全流程真实场景测试              ║')
  console.log(`║  协议: ${PROTOCOL.padEnd(36)}║`)
  console.log(`║  模式: ${USE_MOCK ? 'MOCK (零API费用)'.padEnd(36) : 'LIVE (真实API)'.padEnd(36)}║`)
  console.log(`║  项目: ${PROJ.padEnd(36)}║`)
  console.log('╚══════════════════════════════════════════════╝\n')

  // 创建项目
  const projPath = path.join(APP_ROOT, 'projects', PROJ)
  for (const d of ['characters', 'outline', 'detailed_outline', 'chapters', 'summaries', 'images', 'covers']) {
    await fsp.mkdir(path.join(projPath, d), { recursive: true })
  }
  await fsp.writeFile(path.join(projPath, 'outline', 'plot.md'), '', 'utf-8')
  await fsp.writeFile(path.join(projPath, 'outline', 'worldbuilding.md'), '', 'utf-8')
  await fsp.writeFile(path.join(projPath, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: '修仙小说' }), 'utf-8')
  console.log(`📁 项目已创建: ${PROJ}\n`)

  // ── 预填参考数据（模拟真实项目中有文件的状态）──
  const projDir = path.join(APP_ROOT, 'projects', PROJ)
  await fsp.mkdir(path.join(projDir, 'uploads', 'files'), { recursive: true })
  await fsp.writeFile(path.join(projDir, 'summaries', 'ref_style.txt'), STYLE_REF, 'utf-8')
  console.log(`📄 参考数据已写入 (~${STYLE_REF.length} 字风格参考)`)

  const totalStart = Date.now()
  let totalTokens = 0, totalToolCalls = 0, totalIterations = 0
  const skillGaps = []  // 记录潜在的 Skill 缺口

  for (const sc of SCENARIOS) {
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`\x1b[36m[${sc.id}] ${sc.label}\x1b[0m`)
    console.log(`\x1b[90m> ${sc.message.slice(0, 80)}...\x1b[0m`)
    if (sc.note) console.log(`\x1b[33m📝 ${sc.note}\x1b[0m`)

    // 场景前置准备
    if (sc.setup) {
      try { await sc.setup() } catch (e) { record({ type: 'setup_error', detail: e.message }) }
    }

    const result = await runTurn(sc.id, sc.label, sc.message, sc.check)

    totalTokens += result.tokens
    totalToolCalls += result.toolCalls
    totalIterations += result.iterations

    // ── 思考：Skill 缺口分析 ──
    if (sc.id === 'T3' && result.pass) {
      // T3 是世界观整理——目前走 outline-creation skill，但"导入长篇设定"和"创作大纲"是不同的
      // 思考：是否需要单独的 worldbuilding-import skill？
      skillGaps.push({
        scenario: sc.id,
        observation: '长篇设定导入目前走 outline-creation skill，但导入和创作是不同的工作流',
        suggestion: '可考虑新建 worldbuilding-import skill，专门处理"整理设定→分块编辑→格式校验"',
      })
    }
    if (sc.id === 'T6' && result.pass) {
      // T6 混合了搜索、确认、知识库、闲聊建议——需要多种能力
      skillGaps.push({
        scenario: sc.id,
        observation: '搜索+确认+知识库+建议的混合任务没有对应 Skill，模型自行分解',
        suggestion: '这是正常的——过于混合的任务适合走默认工具集而非 Skill',
      })
    }
    if (sc.id === 'T5' && result.pass) {
      // T5 是润色+保存章节摘要——走了 chapterPolish skill 或文本分析
      skillGaps.push({
        scenario: sc.id,
        observation: '润色+保存摘要是一个常见组合，目前没有对应的 Skill',
        suggestion: '可考虑新建 summarize-and-polish skill，组合文本分析→润色→保存摘要的流程',
      })
    }
  }

  // ── 汇总 ──
  const totalDuration = (Date.now() - totalStart) / 1000
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`\x1b[1m📊 测试汇总\x1b[0m`)
  console.log(`  总耗时:     ${totalDuration.toFixed(1)}s`)
  console.log(`  总 Token:   ${(totalTokens / 1000).toFixed(1)}K`)
  console.log(`  总工具调用: ${totalToolCalls} 次`)
  console.log(`  总迭代:     ${totalIterations} 轮`)

  const passed = log.filter(l => l.pass).length
  const failed = log.filter(l => l.fail).length
  console.log(`  通过: ${passed} / 失败: ${failed} / 总计: ${log.length} 日志条目`)

  if (skillGaps.length > 0) {
    console.log(`\n\x1b[33m💡 Skill 缺口建议:\x1b[0m`)
    for (const gap of skillGaps) {
      console.log(`  [${gap.scenario}] ${gap.observation}`)
      console.log(`          → ${gap.suggestion}`)
    }
  }

  // ── 保存日志 ──
  const logPath = path.join(APP_ROOT, 'scripts', `workflow-log-${PROJ}.json`)
  await fsp.writeFile(logPath, JSON.stringify({
    project: PROJ,
    protocol: PROTOCOL,
    mock: USE_MOCK,
    totalDuration,
    totalTokens,
    totalToolCalls,
    totalIterations,
    passed,
    failed,
    skillGaps,
    log,
  }, null, 2), 'utf-8')
  console.log(`\n📄 日志已保存: ${logPath}`)

  // ── 清理 ──
  if (!process.argv.includes('--keep')) {
    console.log(`\n🧹 清理测试项目...`)
    await cleanup()
    console.log(`✅ 清理完成`)
  } else {
    console.log(`\n📁 项目保留: projects/${PROJ}`)
  }

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  cleanup().then(() => process.exit(1))
})
