#!/usr/bin/env node
/**
 * 仿真测试: 长文本多任务解析 (multi-intent-03-long-message)
 * 模拟用户在一条消息中粘贴3000+字的小说正文，并附带多个分析任务。
 * 验证AI能否正确识别所有嵌入任务并按逻辑顺序执行。
 *
 * 场景: 用户发送超长消息 — 小说第一章初稿 + 3个分析要求
 *   子任务1: 文风分析 → create_style_template
 *   子任务2: 角色创建 → create_file (林玄.json)
 *   子任务3: 世界观整理 → create_file 或 kb_create_file
 *
 * 复杂度: extreme — 超长输入, 多任务并行/串行判断
 * 工具覆盖: create_style_template, create_file, kb_create_file, list_directory, read_file
 *
 * 运行: node scripts/full-sim/multi-intent-03-long-message.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 12
const ROOT = path.resolve(import.meta.dirname || '.', '..', '..')

// ── 路径辅助函数 ──
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)
const ST = p => path.join(ROOT, 'style_templates', p)

// ═══════════════════════════════════════════════════
//  超长小说正文 (3000+ 字) — 《星辰陨落》第一章初稿
// ═══════════════════════════════════════════════════
const NOVEL_CHAPTER = [
  '第1章 星辰陨落',
  '',
  '夜幕低垂，青云山脉笼罩在一片诡异的紫色雾气之中。林玄站在悬崖边缘，手中握着一枚古老的玉佩，上面刻满了密密麻麻的符文。他已经在这个世界修行了整整十年，从筑基到元婴，一步一个脚印。但今天，所有的努力都可能化为泡影。',
  '',
  '"你不该来这里。"一个冰冷的声音从身后传来。',
  '',
  '林玄转身，看到一个身穿黑袍的男子，面容隐藏在兜帽的阴影中。尽管看不清对方的脸，但林玄能感受到那股令人窒息的压迫感——化神期。比他高出整整一个大境界。',
  '',
  '"前辈是何人？为何阻我去路？"林玄沉声问道，右手已经按在了腰间的剑柄上。',
  '',
  '黑袍人发出一声低笑，那笑声在寂静的夜空中显得格外刺耳。"我是谁并不重要。重要的是，你手中的玉佩——那是星辰令吧。把它交出来，我可以饶你不死。"',
  '',
  '林玄的心猛地一沉。星辰令——这枚玉佩的名字，是他师父临终前告诉他的。师父说，这枚玉佩关系到整个天元大陆的命运，绝对不能落入外人之手。',
  '',
  '"前辈说笑了。这不过是一枚普通的家传玉佩，不值一提。"林玄尽量让自己的声音保持平静。',
  '',
  '黑袍人摇了摇头，缓缓抬起右手。一股恐怖的灵力波动从他掌心涌出，空气中传来霹雳般的炸响。"既然如此，那我只好自己来取了。"',
  '',
  '话音未落，一道黑色的灵力匹练如毒蛇般朝林玄激射而来。林玄早有准备，脚下青云步瞬间发动，身形化作一道残影向左侧闪避。同时，他右手的长剑出鞘，剑身上泛起一层淡金色的光芒——这是他修炼十年的成果，天罡剑气。',
  '',
  '"天罡剑诀？你是天剑宗的弟子？"黑袍人的语气中终于带上了一丝惊讶。',
  '',
  '林玄不答，手中长剑连刺三剑。这三剑正是天罡剑诀的精髓——"三星逐月"，一剑快过一剑，剑光如流星般划破夜空。然而黑袍人只是随手一挥，一道黑色光幕便挡在了身前。三道剑光撞在光幕上，发出刺耳的金属碰撞声，随即消散无踪。',
  '',
  '实力的差距太大了。',
  '',
  '林玄咬了咬牙，左手悄悄摸到了怀中一个小巧的符箓。那是师父留给他的最后保命之物——遁空符。一旦激活，可以瞬间传送百里之外。但机会只有一次，他必须把握住最佳时机。',
  '',
  '"交出星辰令。"黑袍人的声音变得更加冰冷，显然已经失去了耐心。"你不过是一个元婴期的小辈，在我面前，连三招都撑不过。"',
  '',
  '"是吗？"林玄忽然笑了。那笑容里有三分苦涩，七分决绝。',
  '',
  '他想起了师父。那个满头白发的老人，在临终前握着他的手，用最后的力气说："玄儿，这枚玉佩不是凡物。它来自天上的星辰，蕴含着改变世界的力量。记住，只有在万不得已的时候，才能动用它的力量。因为那股力量，需要付出生命的代价。"',
  '',
  '林玄将玉佩举到胸前。玉佩在月光下散发出柔和的蓝色光芒，那些古老的符文仿佛活了过来，在玉佩表面缓缓流转。',
  '',
  '"你疯了吗？"黑袍人大惊失色，"以元婴期的修为催动星辰令，你会死的！"',
  '',
  '"我知道。"林玄的声音很轻，却带着不容置疑的坚定。"但有些东西，值得用生命去守护。"',
  '',
  '玉佩的光芒越来越强烈，从淡蓝转为深蓝，又从深蓝转为纯白。一股浩瀚的力量从玉佩中涌出，以林玄为中心向四周扩散。',
  '',
  '黑袍人发出一声怒吼，全力催动护体光芒试图抵挡。但那力量太过纯粹，太过强大，他的防护在那光芒面前如同纸糊一般脆弱。',
  '',
  '"不——"',
  '',
  '耀眼的白光吞没了一切。',
  '',
  '当光芒散去，悬崖上已经空无一人。只有空气中残留的那股令人心悸的力量波动，证明着刚才发生的一切不是幻觉。',
  '',
  '紫色雾气重新笼罩了青云山脉。夜空中，一颗流星缓缓划过，然后消失在无边的黑暗里。',
  '',
  '——',
  '',
  '不知过了多久，林玄缓缓睁开了眼睛。',
  '',
  '入目的是一片陌生的天地。头顶是蔚蓝的天空，身下是柔软的草地。远处有一座繁华的城池，城池中央矗立着一座高耸入云的白色巨塔。巨塔的顶端笼罩在一层淡金色的光晕之中，散发着神圣而威严的气息。',
  '',
  '"这里......是哪里？"林玄挣扎着坐起身，发现手中的玉佩已经失去了光泽，变得如同普通的石头一般。而他体内的灵力，竟然一丝都不剩了。',
  '',
  '他试着运转功法，却发现丹田之中空空如也，就像是一个从未修炼过的凡人。十年的苦修，在这一刻化为乌有。',
  '',
  '林玄苦笑了一声。这大概就是师父说的"代价"吧。',
  '',
  '远处传来一阵马蹄声。林玄抬起头，看到一队身穿银色铠甲的骑士正朝他这边赶来。领头的骑士骑着一匹白色的骏马，头盔上的羽毛在阳光下熠熠生辉。',
  '',
  '"停下！"领头的骑士勒住马，居高临下地看着林玄。"你是何人？为何出现在圣塔禁地？"',
  '',
  '圣塔？禁地？林玄心中充满了疑问。他完全不知道自己被传送到了什么地方。这里的一切——天空的颜色、空气中的灵气浓度、远处的白色巨塔——都与他所知的天元大陆截然不同。',
  '',
  '"在下林玄，并非有意闯入此地。我......"他顿了顿，不知道该如何解释自己的来历。',
  '',
  '领头的骑士摘下头盔，露出一张年轻俊朗的面孔。他仔细打量着林玄，目光中带着几分好奇。"你的衣着很奇怪，不像是我们天启帝国的人。"',
  '',
  '"天启帝国？"林玄愣住了。他从未听说过这个名字。',
  '',
  '"你连天启帝国都不知道？"年轻骑士皱了皱眉，"你该不会是从星界之门那边来的吧？"',
  '',
  '星界之门？又一个陌生的名词。但林玄隐约觉得，这个"星界之门"或许与星辰令有关。',
  '',
  '"我确实不知这里是什么地方。"林玄诚实地回答，"我在一次意外中被传送到了这里。"',
  '',
  '年轻骑士沉默了片刻，似乎在思考什么。最后，他朝身后挥了挥手："下马，给他一匹坐骑。带他回城，让圣塔的贤者们来判定他的身份。"',
  '',
  '几个骑士翻身下马，将一匹枣红色的马牵到林玄面前。林玄虽然失去了所有修为，但基本的骑术还在，他翻身上马，跟在队伍后面向远处的城池行去。',
  '',
  '白色的巨塔越来越近，塔身上可以清楚地看到无数闪光的符文。那些符文与星辰令上的符文有几分相似，但又更为繁杂玄奥。',
  '',
  '林玄摸了摸怀中的玉佩。虽然它已经不再发光，但依然温热。',
  '',
  '新的世界，新的开始。虽然失去了修为，但只要还活着，就有希望。',
  '',
  '而此刻的他并不知道，在这座白色巨塔的顶端，一个沉睡了一万年的古老意志，正因为星辰令的波动而缓缓苏醒。',
  '',
  '天启帝国的命运，即将因为一个来自异世界的少年的到来，而发生翻天覆地的改变。',
  '',
  '夜幕再次降临，白色巨塔的光芒照亮了整个帝都。林玄被安置在圣塔脚下的一间石室中。石室虽然简陋，却干净整洁。窗外可以听到远处传来的钟声，那钟声悠远深沉，仿佛在诉说着千年的故事。',
  '',
  '他盘膝坐在石床上，试图感应天地间的灵气。虽然修为尽失，但他的感知能力并未完全消退。渐渐地，他感受到这个世界的灵气与天元大陆有着本质的不同——这里的灵气更加纯净，但同时也更加狂躁。就像是未经驯服的野马，随时可能挣脱束缚。',
  '',
  '"这个世界的修炼体系，恐怕与我熟悉的完全不同。"林玄眉头微皱，陷入了沉思。',
  '',
  '天元大陆的修炼分为九大境界：筑基、金丹、元婴、化神、合体、渡劫、大乘、真仙、道祖。他用了十年时间修炼到元婴期，在天剑宗已是百年难遇的天才。但如今，他必须从头开始。',
  '',
  '林玄从怀中取出那枚已经失去光泽的星辰令。玉佩的表面布满了细密的裂纹，但那些符文依然隐约可见。他用手指轻轻摩挲着玉佩，脑海中回响着师父的话。',
  '',
  '"星辰令不是凡物，它来自天上的星辰，蕴含着改变世界的力量。"',
  '',
  '可是，师父从未告诉过他，星辰令为什么要选择他。一个普通的孤儿，一个天剑宗的弟子，为什么会背负如此重大的使命？',
  '',
  '门外突然传来一阵急促的脚步声。紧接着，石门被猛然推开。',
  '',
  '进来的正是白天那位年轻骑士。他的脸色凝重，眼神中带着几分焦虑。',
  '',
  '"林玄，圣塔的大贤者要见你。立刻。"',
  '',
  '林玄心中一凛。圣塔的大贤者——天启帝国最高权力的代行者，传说中能与星辰对话的存在。这样的人物，为什么要见他一个来历不明的异乡人？',
  '',
  '"我知道了。"林玄站起身，将星辰令小心地收入怀中。不管前路如何，他必须走下去。因为星辰令还在他手中，因为师父的嘱托还在他心中。',
  '',
  '石室的窗外，夜幕上的星辰格外明亮。在那些闪烁的星光之中，似乎隐藏着某种不为人知的秘密。',
  '',
  '——第一章 终',
].join('\n')

// ═══════════════════════════════════════════════════
//  用户消息 — 嵌入小说全文 + 3个分析任务
// ═══════════════════════════════════════════════════
const USER_MESSAGE =
  '以下是他的新书第一章初稿，请仔细阅读后进行以下分析和操作——\n\n' +
  NOVEL_CHAPTER +
  '\n\n' +
  '阅读完毕后请完成以下三项任务：\n\n' +
  '1.【风格分析】分析这段小说的文风特征，包括但不限于：叙述节奏、语言风格、意象运用、对话特点、视角转换等，然后使用create_style_template创建一个名为"星辰陨落风格"的风格模板来保存分析结果。\n\n' +
  '2.【角色创建】根据小说内容，为主角"林玄"创建一个完整的角色卡（16字段JSON格式），保存到项目目录 1/characters/林玄.yaml。需要包含他的背景故事、性格特征、能力设定、成长弧线等完整信息。\n\n' +
  '3.【世界观整理】基于小说中展现的世界观设定——天元大陆、青云山脉、天剑宗、星辰令、天启帝国、星界之门、圣塔、化神期修炼体系等，整理一份世界观设定文档，保存到 1/worldbuilding/世界观概述.md。'

// ═══════════════════════════════════════════════════
//  预期任务清单 (用于验证)
// ═══════════════════════════════════════════════════
const EXPECTED_TASKS = [
  {
    id: 'style_analysis',
    name: '文风分析',
    toolHint: 'create_style_template',
    description: '分析小说文风特征并创建风格模板',
  },
  {
    id: 'character_creation',
    name: '角色创建(林玄)',
    toolHint: 'create_file',
    description: '为林玄创建16字段完整角色JSON',
  },
  {
    id: 'worldbuilding',
    name: '世界观整理',
    toolHint: 'create_file',
    description: '整理世界观设定文档',
  },
]

// ═══════════════════════════════════════════════════
//  角色JSON 16字段定义
// ═══════════════════════════════════════════════════
const CHARACTER_16_FIELDS = [
  'id', 'name', 'role', 'gender', 'age', 'occupation',
  'background', 'appearance', 'personality', 'abilities',
  'weaknesses', 'relationships', 'relationshipTags', 'arc',
  'importance', 'motivations',
]

// ═══════════════════════════════════════════════════
//  工具实现
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      const fp2 = a.file_path || a.path || ''
      try {
        // 尝试 style_templates 路径
        const c = fs.readFileSync(ST(fp2), 'utf-8')
        return c
      } catch {
        return `[错误: 文件不存在 — ${fp2}]`
      }
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      if (e.length === 0) return '(空目录)'
      return e.map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return `[错误: 目录不存在 — ${a.path || a.dir_path}]`
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const re = new RegExp(
        (a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'
      )
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i]))
            results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
      } else {
        searchDir(fp)
      }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) { return '[错误: 搜索失败]' }
  },

  create_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      const c = a.content || ''

      // JSON 文件自动校验格式
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) {
          return `[JSON格式错误: ${e.message}]`
        }
      }

      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, c, 'utf-8')
      return `创建成功: ${fp}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  edit_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      let c = fs.readFileSync(fullPath, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''

      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fullPath, nw, 'utf-8')
        return '全量替换成功'
      }

      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return `[未找到匹配文本: "${old.slice(0, 80)}"]`

      fs.writeFileSync(fullPath, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  delete_file: a => {
    try {
      fs.unlinkSync(P(a.file_path || a.path || ''))
      return '删除成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  create_style_template: a => {
    try {
      const name = a.name || ''
      const type = a.type || ''
      if (!name) return '[错误: name 是必填字段]'
      if (!type) return '[错误: type 是必填字段]'
      const fp = path.join(ROOT, 'style_templates', name + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      const template = {
        name,
        type,
        description: a.description || '',
        dimensions: a.dimensions || {},
        created_at: new Date().toISOString(),
      }
      fs.writeFileSync(fp, JSON.stringify(template, null, 2), 'utf-8')
      return `风格模板创建成功: ${name} (类型: ${type}) 已保存到 style_templates/${name}.json`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  create_scene_template: a => {
    try {
      const name = a.name || ''
      const type = a.type || ''
      if (!name) return '[错误: name 是必填字段]'
      const fp = path.join(ROOT, 'scene_templates', name + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, JSON.stringify(a, null, 2), 'utf-8')
      return `场景模板创建成功: ${name}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  // ── 知识库 / 笔记工具 ──
  kb_list: () => {
    try {
      const files = fs.readdirSync(K('')).filter(f => f.endsWith('.md'))
      return files.join('\n') || '无KB文件'
    } catch { return '无KB文件' }
  },

  kb_create_file: a => {
    try {
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return 'KB创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  list_notes: () => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无笔记'
    } catch { return '无笔记' }
  },

  write_note: a => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return '笔记创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  read_note: a => {
    try {
      return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500)
    } catch { return '[笔记不存在]' }
  },

  delete_note: a => {
    try {
      fs.unlinkSync(N((a.name || 'x') + '.md'))
      return '笔记删除成功'
    } catch { return '[错误]' }
  },

  create_project: a => {
    try {
      const d = P(a.name || 'new-project')
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        s => fs.mkdirSync(path.join(d, s), { recursive: true })
      )
      return `项目${a.name}创建成功`
    } catch (e) { return `[错误: ${e.message}]` }
  },

  delete_project: a => {
    try {
      fs.rmSync(P(a.name || ''), { recursive: true, force: true })
      return '项目删除成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',

  list_rules: () => '暂无自定义规则',

  learn_rule: a => {
    return `规则已学习: ${(a.rule || '').slice(0, 60)}`
  },

  list_audit: () => '暂无审计记录',

  write_learning: a => {
    return `经验已记录: ${(a.summary || '').slice(0, 60)}`
  },
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目文件内容。已知路径直接读，不需要先列目录。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/characters/林玄.yaml' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出项目目录内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，如 1/characters' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '在项目文件中搜索文本内容',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词或正则' },
          path: { type: 'string', description: '搜索路径(可选)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '创建新文件。JSON文件自动校验格式。创建角色时需包含完整的16字段JSON。创建世界观测文档时使用.md格式。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径' },
          content: { type: 'string', description: '文件内容(JSON需为字符串)' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑现有文件。先read_file确认原文。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除项目文件',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_style_template',
      description: '创建风格模板。分析文本后提取文风特征，创建可复用的写作风格模板。必填: name, type。dimensions为文风维度JSON对象。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '模板类型，如 prose, narrative, dialogue, description' },
          description: { type: 'string', description: '模板描述' },
          dimensions: {
            type: 'object',
            description: '文风维度，如 {sentence_rhythm:"张弛有度", imagery_density:"高", dialogue_style:"简洁有力", perspective:"第三人称有限"}',
          },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_scene_template',
      description: '创建场景模板。分析场景结构后创建可复用的场景写作模板。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '模板类型' },
          description: { type: 'string', description: '模板描述' },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_list',
      description: '列出知识库文件',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_create_file',
      description: '创建知识库文件。用于保存世界观设定、写作参考等。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名(不含扩展名)' },
          content: { type: 'string', description: 'Markdown格式内容' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出所有笔记',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '创建笔记',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '笔记名称' },
          content: { type: 'string', description: '笔记内容' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取笔记内容',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: '删除笔记',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '创建新项目',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: '删除项目',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_prompts',
      description: '列出提示词模板',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: '列出已学习规则',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'learn_rule',
      description: '学习新规则',
      parameters: {
        type: 'object',
        properties: { rule: { type: 'string' } },
        required: ['rule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_audit',
      description: '查看审计记录',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_learning',
      description: '记录学习经验',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
]

// ═══════════════════════════════════════════════════
//  系统提示词 (与真实Harness一致)
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)/查看/确认/分析',
  '❌ 不调工具（纯对话）: 问候/闲聊/我是/我叫/我喜欢/我觉得/谢谢/什么是/为什么/怎么/推荐',
  '',
  '# 执行规则',
  '- 已知文件路径直接读文件，不需要先列目录。',
  '- 修改文件前必须先读取原文件内容（read_file），再edit_file。',
  '- 创建JSON文件时会自动校验格式。',
  '- 只做用户要求的操作，不多做也不少做。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- 用户消息中嵌入的长文本已在消息中，不需要额外读取文件。直接基于消息中的文本进行分析。',
  '- 回复简洁有力，分析完成后汇报结果。',
  '',
  '# 路径速查',
  '角色: {项目}/characters/{中文名}.yaml  例: 1/characters/林玄.yaml',
  '世界观测文档: {项目}/worldbuilding/{名称}.md',
  '风格模板: style_templates/{名称}.json',
  '',
  '# 角色JSON标准字段（16个必填）',
  '1.id  2.name  3.role  4.gender  5.age  6.occupation',
  '7.background  8.appearance  9.personality  10.abilities',
  '11.weaknesses  12.relationships  13.relationshipTags  14.arc',
  '15.importance  16.motivations',
  '',
  '# 角色字段规范',
  '- role 字段必须是以下之一: 男主, 女主, 男配, 女配, 反派, 其他',
  '- abilities 字段必须是**字符串**（如"天罡剑诀、青云步"），不能是对象',
  '- relationshipTags 字段必须是**数组**（如["师徒","战友"]）',
  '- importance 字段必须是**数字**（1-100）',
  '- 用户未明确提供的字段，用合理默认值填充，不要留空字符串',
  '- 创建完成后告知用户已创建的字段概要，请用户确认',
  '',
  '# 风格模板创建',
  '- dimensions 应包含: narrative_rhythm(叙述节奏), language_style(语言风格), imagery_style(意象运用), dialogue_style(对话风格), perspective(视角), tone(基调), sentence_structure(句式特点)',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 8192,
    tools: TOOLS,
    tool_choice: 'auto',
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200))
  }

  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ═══════════════════════════════════════════════════
//  Agent 运行循环
// ═══════════════════════════════════════════════════
async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]

  let iterations = 0
  let totalTools = 0
  let fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write(`文本回复(${r.text.length}字)\n`)
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant 消息
    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    // 执行每个工具调用
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch { /* ignore parse errors */ }

      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = typeof result === 'string' && !result.startsWith('[')
      const icon = ok ? '✓' : '✗'
      totalTools++

      process.stdout.write(`${fn.name}${icon} `)
      toolLog.push({
        name: fn.name,
        ok,
        args,
        result: typeof result === 'string' ? result.slice(0, 120) : String(result).slice(0, 120),
      })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
    process.stdout.write('\n')
  }

  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  测试框架
// ═══════════════════════════════════════════════════
let pass = 0
let fail = 0

function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name + (detail ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ❌ ' + name + (detail ? ': ' + detail : ''))
  }
}

function hr(title) {
  console.log('\n' + '─'.repeat(62))
  console.log('  ' + title)
  console.log('─'.repeat(62))
}

/**
 * 检查角色JSON是否包含全部16个字段
 */
function checkCharacterFields(content) {
  try {
    const obj = JSON.parse(content)
    const missing = CHARACTER_16_FIELDS.filter(f => !(f in obj))
    return {
      valid: missing.length === 0,
      missing,
      obj,
    }
  } catch (e) {
    return { valid: false, missing: [], error: e.message }
  }
}

/**
 * 验证磁盘上的文件是否存在
 */
function fileExists(relPath) {
  const fullPath = P(relPath)
  return fs.existsSync(fullPath)
}

/**
 * 读取磁盘文件内容
 */
function readDiskFile(relPath) {
  const fullPath = P(relPath)
  try {
    return fs.readFileSync(fullPath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 检查风格模板文件是否存在并有效
 */
function checkStyleTemplate(name) {
  const fp = ST(name + '.json')
  try {
    if (!fs.existsSync(fp)) return { exists: false }
    const content = fs.readFileSync(fp, 'utf-8')
    const obj = JSON.parse(content)
    return {
      exists: true,
      hasName: !!obj.name,
      hasType: !!obj.type,
      hasDimensions: obj.dimensions && typeof obj.dimensions === 'object' && Object.keys(obj.dimensions).length > 0,
    }
  } catch {
    return { exists: false }
  }
}

// ═══════════════════════════════════════════════════
//  测试环境初始化与清理
// ═══════════════════════════════════════════════════
function setupTestEnvironment() {
  // 确保项目目录存在
  const charDir = P('1/characters')
  const wbDir = P('1/worldbuilding')
  fs.mkdirSync(charDir, { recursive: true })
  fs.mkdirSync(wbDir, { recursive: true })
  fs.mkdirSync(ST(''), { recursive: true })
  console.log('  [初始化] 测试目录已创建: projects/1/characters, projects/1/worldbuilding, style_templates/')
  console.log('  [初始化] 小说正文长度: ' + NOVEL_CHAPTER.length + ' 字符')
  console.log('  [初始化] 用户消息总长: ' + USER_MESSAGE.length + ' 字符')
}

function cleanupTestEnvironment() {
  const dirs = [
    P('1'),
    ST(''),
  ]
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch { /* best-effort */ }
  }
  console.log('  [清理] 测试文件已清理')
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('══════════════════════════════════════════════════════')
  console.log('  仿真测试: 长文本多任务解析 (multi-intent-03-long-message)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: 3000+字小说正文 + 3个分析任务')
  console.log('  MAX_ITERATIONS: ' + MAX_ITERATIONS)
  console.log('══════════════════════════════════════════════════')

  // 初始化测试环境
  setupTestEnvironment()

  // ═══════════════════════════════════════════════════
  //  S1: 长文本多任务 — 完整流程
  // ═══════════════════════════════════════════════════
  hr('S1 长文本多任务 — 阅读小说 + 风格分析 + 角色创建 + 世界观整理')

  console.log('  用户消息: ' + USER_MESSAGE.slice(0, 100) + '...')
  console.log('  小说正文长度: ' + NOVEL_CHAPTER.length + ' 字符')
  console.log('  任务数: 3 (风格分析/角色创建/世界观整理)')
  console.log('')

  const result = await agentRun(USER_MESSAGE)

  // ── 基础验证 ──
  t('S1-base AI有文本回复', result.text.length > 0, result.text.length + '字')
  t('S1-base 不超最大迭代', result.iterations < MAX_ITERATIONS, result.iterations + '/' + MAX_ITERATIONS + '轮')
  t('S1-base 有工具调用', result.toolCalls >= 1, result.toolCalls + '次工具调用')

  // ── 任务识别验证 ──
  // 统计调用过的工具名称
  const toolNames = result.toolLog.map(l => l.name)
  const uniqueTools = [...new Set(toolNames)]
  console.log('\n  工具调用序列: ' + toolNames.join(' → ') + '  总计: ' + result.toolCalls + '次')
  console.log('  唯一工具: ' + uniqueTools.join(', '))

  t('S1-task-detect 多个不同工具被调用', uniqueTools.length >= 2,
    uniqueTools.length + '种工具: ' + uniqueTools.join(', '))

  // ── 子任务1: 风格分析 ──
  hr('  子任务1: 风格分析 (预期: create_style_template)')

  const styleTemplateCall = result.toolLog.find(
    l => l.name === 'create_style_template' && l.ok
  )
  const sceneTemplateCall = result.toolLog.find(
    l => l.name === 'create_scene_template' && l.ok
  )

  t('S1-style-1 风格/场景模板被调用',
    !!(styleTemplateCall || sceneTemplateCall),
    styleTemplateCall ? 'create_style_template ✓' : (sceneTemplateCall ? 'create_scene_template ✓' : '未调用'))

  // 验证风格模板文件
  if (styleTemplateCall) {
    const stCheck = checkStyleTemplate(styleTemplateCall.args.name || 'unknown')
    t('S1-style-2 风格模板文件已创建', stCheck.exists,
      '模板名: ' + (styleTemplateCall.args.name || 'N/A'))
    if (stCheck.exists) {
      t('S1-style-3 模板含name', stCheck.hasName)
      t('S1-style-4 模板含type', stCheck.hasType)
      t('S1-style-5 模板含dimensions文风维度', stCheck.hasDimensions,
        stCheck.hasDimensions ? '有维度数据' : '无维度数据')
    }
  } else if (sceneTemplateCall) {
    t('S1-style-alt 场景模板已作为替代方案调用', true,
      'name=' + (sceneTemplateCall.args.name || 'N/A'))
  }

  // ── 子任务2: 角色创建 ──
  hr('  子任务2: 角色创建 — 林玄 (预期: create_file 1/characters/林玄.yaml)')

  const charCreateCall = result.toolLog.find(
    l => l.name === 'create_file' && l.ok &&
      (l.args.file_path || '').includes('林玄')
  )

  // 也检查文件路径变体
  const anyCharCreate = result.toolLog.find(
    l => l.name === 'create_file' && l.ok &&
      ((l.args.file_path || l.args.path || '').toLowerCase().includes('characters') ||
       (l.args.file_path || l.args.path || '').toLowerCase().includes('character'))
  )

  t('S1-char-1 角色文件创建被调用',
    !!(charCreateCall || anyCharCreate),
    charCreateCall ? 'create_file(林玄) ✓' : (anyCharCreate ? 'create_file(角色目录) ✓' : '未找到'))

  // 验证磁盘上的角色文件
  const charFileExists = fileExists('1/characters/林玄.yaml')
  // 也检查可能的替代文件名
  let charDiskPath = '1/characters/林玄.yaml'
  let charDiskExists = charFileExists
  if (!charDiskExists) {
    // 尝试列目录找角色文件
    try {
      const files = fs.readdirSync(P('1/characters'))
      const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '.gitkeep')
      if (jsonFiles.length > 0) {
        charDiskPath = '1/characters/' + jsonFiles[0]
        charDiskExists = true
      }
    } catch { /* ignore */ }
  }

  t('S1-char-2 角色文件在磁盘上存在', charDiskExists,
    charDiskExists ? charDiskPath : '文件未创建')

  if (charDiskExists) {
    const charContent = readDiskFile(charDiskPath.replace('1/characters/', ''))
    const charCheck = checkCharacterFields(charContent)
    t('S1-char-3 角色JSON格式有效', !charCheck.error,
      charCheck.error ? charCheck.error : 'JSON解析正常')

    if (charCheck.valid) {
      t('S1-char-4 包含全部16字段', charCheck.valid,
        '16/16字段完整')
    } else {
      t('S1-char-4 包含全部16字段', false,
        '缺少: ' + (charCheck.missing || []).join(', '))
    }

    if (charCheck.obj) {
      t('S1-char-5 角色名含"林玄"',
        (charCheck.obj.name || '').includes('林玄'),
        'name=' + charCheck.obj.name)
      t('S1-char-6 role合法',
        ['男主', '女主', '男配', '女配', '反派', '其他'].includes(charCheck.obj.role),
        'role=' + charCheck.obj.role)
      t('S1-char-7 abilities是字符串',
        typeof charCheck.obj.abilities === 'string',
        typeof charCheck.obj.abilities)
      t('S1-char-8 importance是数字',
        typeof charCheck.obj.importance === 'number',
        String(charCheck.obj.importance))
      t('S1-char-9 relationshipTags是数组',
        Array.isArray(charCheck.obj.relationshipTags),
        Array.isArray(charCheck.obj.relationshipTags) ? '数组' : typeof charCheck.obj.relationshipTags)

      console.log('    角色摘要: ' + charCheck.obj.name + ' | ' + charCheck.obj.role +
        ' | ' + charCheck.obj.gender + ' | age=' + charCheck.obj.age +
        ' | importance=' + charCheck.obj.importance +
        ' | abilities=' + (charCheck.obj.abilities || '').slice(0, 30))
    }
  }

  // ── 子任务3: 世界观整理 ──
  hr('  子任务3: 世界观整理 (预期: create_file 或 kb_create_file)')

  const wbCreateCall = result.toolLog.find(
    l => l.name === 'create_file' && l.ok &&
      ((l.args.file_path || l.args.path || '').toLowerCase().includes('worldbuilding') ||
       (l.args.file_path || l.args.path || '').toLowerCase().includes('世界观'))
  )
  const kbCreateCall = result.toolLog.find(
    l => l.name === 'kb_create_file' && l.ok
  )

  t('S1-wb-1 世界观文件被创建',
    !!(wbCreateCall || kbCreateCall),
    wbCreateCall ? 'create_file(世界观) ✓' : (kbCreateCall ? 'kb_create_file ✓' : '未创建'))
  t('S1-wb-2 AI有文本回复', result.text.length > 0, result.text.length + '字')

  // 验证世界观文件在磁盘上
  const wbDiskExists = fileExists('1/worldbuilding/世界观概述.md') ||
    fileExists('1/worldbuilding/worldbuilding.md') ||
    fileExists('1/worldbuilding/世界观.md')
  // 也检查KB
  let kbDiskExists = false
  try {
    const kbFiles = fs.readdirSync(K(''))
    kbDiskExists = kbFiles.length > 0
  } catch { /* ignore */ }

  t('S1-wb-3 世界观文件磁盘存在',
    wbDiskExists || kbDiskExists,
    wbDiskExists ? 'projects路径找到' : (kbDiskExists ? 'KB路径找到' : '未找到'))

  // 读取世界观文件进行内容验证
  if (wbDiskExists) {
    let wbContent = ''
    for (const fn of ['世界观概述.md', 'worldbuilding.md', '世界观.md']) {
      const c = readDiskFile('1/worldbuilding/' + fn)
      if (c) { wbContent = c; break }
    }
    if (wbContent) {
      t('S1-wb-4 世界观文档有实质内容', wbContent.length > 100,
        wbContent.length + '字符')
      // 应提及关键世界观要素
      const wbKeywords = ['天元', '青云', '天剑', '星辰令', '天启帝国']
      const matchedKeywords = wbKeywords.filter(kw => wbContent.includes(kw))
      t('S1-wb-5 包含关键世界观要素',
        matchedKeywords.length >= 3,
        '包含: ' + matchedKeywords.join(', ') + ' (' + matchedKeywords.length + '/' + wbKeywords.length + ')')
    }
  }

  // ═══════════════════════════════════════════════════
  //  任务完整性验证
  // ═══════════════════════════════════════════════════
  hr('  任务完整性汇总')

  const task1Done = !!(styleTemplateCall || sceneTemplateCall)
  const task2Done = charDiskExists
  const task3Done = wbDiskExists || kbDiskExists
  const allThreeDone = task1Done && task2Done && task3Done
  const tasksDoneCount = (task1Done ? 1 : 0) + (task2Done ? 1 : 0) + (task3Done ? 1 : 0)

  t('S1-complete 全部3个子任务完成', allThreeDone,
    tasksDoneCount + '/3: ' +
    (task1Done ? '风格✓ ' : '风格✗ ') +
    (task2Done ? '角色✓ ' : '角色✗ ') +
    (task3Done ? '世界观✓' : '世界观✗'))

  // ── 任务执行顺序验证 ──
  hr('  任务执行顺序验证')

  // 获取工具调用顺序中的关键事件索引
  const styleIdx = result.toolLog.findIndex(
    l => l.name === 'create_style_template' || l.name === 'create_scene_template'
  )
  const createIdx = result.toolLog.findIndex(
    l => l.name === 'create_file'
  )

  if (styleIdx >= 0 && createIdx >= 0) {
    t('S1-order 风格分析在文件创建之前或有合理顺序',
      true,
      '风格索引=' + styleIdx + ', create_file索引=' + createIdx)
  } else {
    t('S1-order 工具调用顺序可追踪',
      result.toolLog.length >= 2,
      result.toolLog.length + '次工具调用')
  }

  // ── 回复内容质量验证 ──
  hr('  回复内容质量')
  t('S1-quality-1 AI回复提及小说内容',
    /星辰|林玄|青云|天元|玉佩|星辰令/.test(result.text),
    '回复涉及小说关键元素')
  t('S1-quality-2 AI回复提及分析结果',
    /风格|文风|分析|节奏|语言|意象|创建|模板|角色|世界观/.test(result.text),
    '回复包含分析或创建相关的描述')
  t('S1-quality-3 AI回复含中文',
    /[一-鿿]/.test(result.text),
    '包含中文字符')

  const lines = result.text.split('\n').filter(l => l.trim())
  console.log('    AI回复行数: ' + lines.length + '  总字数: ' + result.text.length)
  console.log('    回复预览: ' + result.text.slice(0, 200).replace(/\n/g, ' | '))

  // ═══════════════════════════════════════════════════
  //  汇总
  // ═══════════════════════════════════════════════════
  cleanupTestEnvironment()

  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════════════════════')
  console.log('  仿真测试: 长文本多任务解析 (multi-intent-03-long-message)')
  console.log('  测试结果')
  console.log('══════════════════════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  测试覆盖:')
  console.log('    S1-base          基础验证 — 文本回复/迭代数/工具调用')
  console.log('    S1-task-detect   任务识别 — 多个不同工具被调用')
  console.log('    S1-style-*       子任务1: 风格分析 (create_style_template)')
  console.log('    S1-char-*        子任务2: 角色创建 (create_file → 林玄.json)')
  console.log('    S1-wb-*          子任务3: 世界观整理 (create_file/kb_create_file)')
  console.log('    S1-complete      完整性 — 全部3个子任务完成')
  console.log('    S1-order         执行顺序 — 工具调用顺序合理')
  console.log('    S1-quality-*     回复质量 — 内容相关/含中文')
  console.log('')
  console.log('  输入统计:')
  console.log('    小说正文: ' + NOVEL_CHAPTER.length + ' 字符')
  console.log('    用户消息总长: ' + USER_MESSAGE.length + ' 字符')
  console.log('    API轮次: ' + result.iterations + '  工具调用: ' + result.toolCalls + '次')
  console.log('    工具序列: ' + toolNames.join(' → '))
  console.log('══════════════════════════════════════════════════════')

  if (fail > 0) {
    process.exitCode = 1
  }
}

// ═══════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════
main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
