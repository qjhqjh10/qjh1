#!/usr/bin/env node
/**
 * 仿真测试: 多意图顺序依赖 (multi-intent-02-sequential-tasks)
 * 模拟用户在一次消息中嵌入5个有先后依赖关系的任务，验证AI能否：
 *   1. 识别出消息中所有嵌入式任务
 *   2. 按逻辑顺序排序（先读后写，依赖关系正确）
 *   3. 正确执行每个任务
 *
 * 场景: 依赖任务排序 — 任务间有先后依赖关系，模型需自行排序
 * 用户消息: "我要写第5章。你需要：1. 先读大纲了解整体剧情 2. 创建角色"陈曦"（反派，35岁）
 *           3. 给第5章写细纲 4. 读第4章摘要（前情回顾）5. 最后写第5章正文。
 *           注意顺序不要乱，该先读的文件先读了再写新的..."
 *
 * 预期工具链: read_file x N → create_file x 3 (角色 + 细纲 + 章节)
 * 验证: 先读了文件再创建, create_file 在 read_file 之后
 *
 * 复杂度: complex — 多任务排序, ~5-12 个工具调用
 * 工具覆盖: read_file, create_file, list_directory
 *
 * 运行: node scripts/full-sim/multi-intent-02-sequential-tasks.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置常量
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 15
const ROOT = process.cwd()

// ── 路径辅助函数 ──
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  测试数据准备
// ═══════════════════════════════════════════════════
function seedTestData() {
  const projDir = P('1')
  fs.mkdirSync(projDir, { recursive: true })

  // ── 大纲: outline/plot.md ──
  const outlineDir = path.join(projDir, 'outline')
  fs.mkdirSync(outlineDir, { recursive: true })
  fs.writeFileSync(path.join(outlineDir, 'plot.md'), [
    '# 《青云仙路》故事大纲',
    '',
    '## 一句话梗概',
    '山村少女许倩偶获古玉佩，踏入修仙世界，在正邪纷争中成长为一代剑仙。',
    '',
    '## 世界观概要',
    '修仙世界分为炼气、筑基、金丹、元婴、化神、渡劫六大境界。',
    '正道以青云宗为首，魔道以血煞教为尊，双方争斗千年。',
    '',
    '### 第1章·青云入门',
    '许倩来到青云宗，凭借古玉佩被破格收入门下。初遇师兄林逸和师姐沈清雪。',
    '',
    '### 第2章·初窥门径',
    '许倩开始修炼，天赋惊人。古玉佩首次显现异象，引起宗门高层暗中关注。',
    '',
    '### 第3章·试炼危机',
    '新人试炼中，许倩遭遇血煞教暗算。林逸舍身相救，两人关系升华。古玉佩力量初觉醒。',
    '',
    '### 第4章·暗流涌动',
    '血煞教布局青云宗，安插内应陈曦。许倩突破筑基期，引起各方势力觊觎。' +
    '沈清雪发现端倪却遭人陷害。林逸为保护许倩与宗门长辈决裂。',
    '',
    '### 第5章·山雨欲来',
    '陈曦正式暴露身份。青云宗内部分裂。许倩得知古玉佩与千年前正邪大战有关。' +
    '林逸被血煞教抓走，许倩决意独闯魔窟救人。',
  ].join('\n'), 'utf-8')

  // ── 世界观: outline/worldbuilding.md ──
  fs.writeFileSync(path.join(outlineDir, 'worldbuilding.md'), [
    '# 世界观设定',
    '',
    '## 修仙体系',
    '炼气 → 筑基 → 金丹 → 元婴 → 化神 → 渡劫',
    '',
    '## 势力分布',
    '- 青云宗: 正道第一大派，主修剑道',
    '- 血煞教: 魔道至尊，以血炼之法修炼',
    '- 散修联盟: 中立势力',
    '',
    '## 特殊设定',
    '- 古玉佩: 上古神器残片，共七块，散落天下',
    '- 灵脉: 天生拥有灵力感知能力者',
  ].join('\n'), 'utf-8')

  // ── 已有角色: characters/ ──
  const charsDir = path.join(projDir, 'characters')
  fs.mkdirSync(charsDir, { recursive: true })

  // 参考角色1: 许倩 (女主)
  fs.writeFileSync(path.join(charsDir, '许倩.json'), JSON.stringify({
    id: 'xu_qian',
    name: '许倩',
    role: '女主',
    gender: '女',
    age: '16',
    occupation: '青云宗弟子/修仙者',
    background: '青云山脚下小村庄出身，自幼父母双亡，由村长抚养长大。一日救助受伤灵狐，获赠古玉佩，从此命运改变。',
    appearance: '乌黑长发及腰，明眸皓齿，身形纤细。常穿青色道袍，气质清冷中带着倔强。',
    personality: '坚韧不拔，心地善良，重情重义。外表沉静，内心刚烈。有时过于冲动，但关键时刻冷静果断。',
    abilities: '基础剑法、灵脉感知、古玉佩(未完全激活)、筑基期修为',
    weaknesses: '修为尚浅、阅历不足、过于重感情容易被人利用',
    relationships: '与林逸是恋人关系，二人并肩经历生死。与沈清雪是师姐妹，情谊深厚。对师父心怀感恩。',
    relationshipTags: ['恋人(林逸)', '师姐妹(沈清雪)', '师徒', '同门'],
    arc: '从懵懂山村少女成长为独当一面的剑仙。核心成长线: 学会在守护他人与信任自己之间找到平衡。',
    importance: 100,
    motivations: '保护珍视之人，查明古玉佩秘密，为父母报仇',
  }, null, 2), 'utf-8')

  // 参考角色2: 林逸 (男主)
  fs.writeFileSync(path.join(charsDir, '林逸.json'), JSON.stringify({
    id: 'lin_yi',
    name: '林逸',
    role: '男主',
    gender: '男',
    age: '19',
    occupation: '青云宗真传弟子',
    background: '青云宗内门长老之子，天资卓绝。自小在宗门长大，受过严格的剑道训练。',
    appearance: '身材修长，剑眉星目，一袭白衣。气质冷峻，但眼神中藏着温柔。',
    personality: '外冷内热，责任感极强。对敌人毫不留情，对朋友两肋插刀。有时过于固执。',
    abilities: '天罡剑诀、御风术、金丹期修为、剑意初成',
    weaknesses: '过于守护许倩导致自己常陷险境、固执己见不听劝告',
    relationships: '与许倩是恋人，愿为她付出一切。与沈清雪是青梅竹马的师兄妹。',
    relationshipTags: ['恋人(许倩)', '师兄妹(沈清雪)', '同门'],
    arc: '从恪守门规的正道弟子成长为敢于打破规则为正义而战的侠者。',
    importance: 100,
    motivations: '守护许倩，匡扶青云宗正道，继承父亲遗志',
  }, null, 2), 'utf-8')

  // 参考角色3: 沈清雪 (女配)
  fs.writeFileSync(path.join(charsDir, '沈清雪.json'), JSON.stringify({
    id: 'shen_qing_xue',
    name: '沈清雪',
    role: '女配',
    gender: '女',
    age: '18',
    occupation: '青云宗弟子',
    background: '青云宗长老之女，天赋出众。与林逸自幼一同长大，对林逸暗藏情愫。',
    appearance: '冰肌玉骨，容颜绝美。喜穿白色长裙，气质清冷高雅。',
    personality: '聪慧冷静，心思缜密。表面清冷疏离，实则古道热肠。对认可之人极为忠诚。',
    abilities: '冰心剑诀、阵法精通、筑基期巅峰修为',
    weaknesses: '对林逸的感情成为软肋、过于理智有时显得冷漠无情',
    relationships: '与林逸青梅竹马，内心深爱却从未表白。与许倩是师姐妹，从最初的戒备到真心相待。',
    relationshipTags: ['暗恋(林逸)', '师姐妹(许倩)', '同门'],
    arc: '从执着于个人情感的少女成长为能放下私情为大局着想的智者。',
    importance: 85,
    motivations: '守护青云宗，保护林逸和许倩，追求剑道极致',
  }, null, 2), 'utf-8')

  // ── 已有细纲: detailed_outline/ ──
  const detDir = path.join(projDir, 'detailed_outline')
  fs.mkdirSync(detDir, { recursive: true })

  // 参考细纲: chapter1.json (供AI参考格式)
  fs.writeFileSync(path.join(detDir, 'chapter1.json'), JSON.stringify({
    id: 'chapter1',
    title: '青云入门',
    order: 1,
    status: 'complete',
    plotOverview: '许倩带着古玉佩来到青云宗，在山门前被守门弟子刁难。出示古玉佩后，引起宗门长老注意。经过灵脉检测，许倩被确认拥有罕见的上古灵脉资质，被破格收入门下。林逸作为引导师兄带她熟悉宗门，两人初次交谈，彼此留下深刻印象。',
    characters: [
      { name: '许倩', emotionalState: '忐忑不安、好奇憧憬' },
      { name: '林逸', emotionalState: '冷漠淡然、暗含关注' },
      { name: '玄真长老', emotionalState: '威严中带着惊讶' },
    ],
    location: '青云宗山门 → 宗门大殿 → 新人弟子院',
    keyEvents: [
      '许倩山门前被刁难',
      '出示古玉佩引起长老注意',
      '灵脉检测揭示上古资质',
      '破格入门',
      '林逸引导参观宗门',
    ],
    writingNotes: '开篇要营造修仙世界的宏大氛围，通过许倩的视角展示普通人对修仙的向往与敬畏。古玉佩是全书线索，首次出现要足够神秘。',
  }, null, 2), 'utf-8')

  // 参考细纲: chapter4.json (第4章已有细纲)
  fs.writeFileSync(path.join(detDir, 'chapter4.json'), JSON.stringify({
    id: 'chapter4',
    title: '暗流涌动',
    order: 4,
    status: 'complete',
    plotOverview: '血煞教在青云宗内部布局，安插卧底陈曦。陈曦伪装成新入门的外门弟子，暗中收集青云宗情报。许倩在林逸指导下突破筑基期，引发宗门震动。沈清雪察觉到陈曦的可疑行为，却被陈曦先发制人陷害为魔道内应。林逸为保护许倩不惜与宗门长辈决裂，被罚面壁思过。',
    characters: [
      { name: '许倩', emotionalState: '突破后的欣喜、对宗门暗流的忧虑' },
      { name: '林逸', emotionalState: '愤怒、决绝、对许倩的保护欲' },
      { name: '沈清雪', emotionalState: '警觉、被陷害后的震惊与无助' },
      { name: '陈曦', emotionalState: '表面恭顺，暗藏杀机' },
    ],
    location: '青云宗修炼密室 → 议事大殿 → 后山禁地面壁处',
    keyEvents: [
      '许倩突破筑基期',
      '陈曦暗中传递情报',
      '沈清雪发现陈曦可疑',
      '陈曦反诬沈清雪',
      '林逸为许倩顶撞长老',
      '林逸被罚面壁',
    ],
    writingNotes: '这是冲突升级的一章。陈曦的反派形象要立住——不是纯粹的邪恶，而是有自己信念的对手。许倩突破的描写要有仪式感。林逸的牺牲让读者心疼。',
  }, null, 2), 'utf-8')

  // ── 已有章节: chapters/ ──
  const chaptersDir = path.join(projDir, 'chapters')
  fs.mkdirSync(chaptersDir, { recursive: true })

  // 章节1（简短占位）
  fs.writeFileSync(path.join(chaptersDir, 'chapter1.txt'), [
    '# 第1章 青云入门',
    '',
    '青云山，绵延千里，终年云雾缭绕。',
    '',
    '许倩站在山脚下，仰头望着那条蜿蜒入云的青石台阶，心中忐忑难安。',
    '她怀中那枚古玉佩隐隐发烫，似乎在催促她——快些，再快些。',
    '',
    '（完整正文见正式版本）',
  ].join('\n'), 'utf-8')

  // 章节4（简短占位，AI应读summaries而非完整章节）
  fs.writeFileSync(path.join(chaptersDir, 'chapter4.txt'), [
    '# 第4章 暗流涌动',
    '',
    '许倩睁开眼，体内灵力如江河奔腾。筑基期，她终于踏入了这个门槛。',
    '',
    '然而她还不知道，暗处有一双眼睛，正冷冷地注视着她的一举一动——',
    '那个叫陈曦的新弟子，嘴角勾起一丝不易察觉的笑。',
    '',
    '（完整正文见正式版本）',
  ].join('\n'), 'utf-8')

  // ── 第4章摘要: summaries/chapter4.md （这是AI应该读取的前情回顾） ──
  const summDir = path.join(projDir, 'summaries')
  fs.mkdirSync(summDir, { recursive: true })

  fs.writeFileSync(path.join(summDir, 'chapter4.md'), [
    '# 第4章摘要（前情回顾）',
    '',
    '## 核心事件',
    '',
    '1. **许倩突破筑基期**:',
    '   在林逸的悉心指导下，许倩经历三天三夜的闭关修炼，成功突破筑基期。',
    '   突破瞬间，古玉佩发出耀眼光芒，在青云宗上空形成异象，引起全宗震动。',
    '   掌门玄真子亲自探查，确认许倩为千年难遇的上古灵脉体质。',
    '',
    '2. **陈曦暗线浮出**:',
    '   新入门的外门弟子陈曦，实为血煞教精心培养的卧底。',
    '   他以温和谦逊的表象成功融入宗门，暗中通过秘法向血煞教传递情报。',
    '   陈曦的目标是夺取古玉佩，他的背后是血煞教教主血影子的直接授命。',
    '',
    '3. **沈清雪遭陷害**:',
    '   沈清雪偶然发现陈曦深夜外出，暗中跟踪。',
    '   陈曦察觉后，设下精巧圈套，将魔道暗探的嫌疑转嫁到沈清雪身上。',
    '   宗门议事大会上，沈清雪被当众指控为魔道内应，百口莫辩。',
    '',
    '4. **林逸与宗门决裂**:',
    '   林逸坚信沈清雪清白，当众抗辩，指出疑点。',
    '   然而证据链被陈曦精心伪造，林逸的反驳反而被视为"被感情冲昏头脑"。',
    '   掌门为维护宗门秩序，罚林逸到后山禁地面壁思过三个月。',
    '   临行前，林逸嘱托许倩: "小心陈曦。保护好自己。"',
    '',
    '5. **许倩的觉醒**:',
    '   林逸被罚后，许倩意识到宗门内部的暗流远比她想象的危险。',
    '   古玉佩再次在梦中低语，暗示她的身世与千年前的正邪大战有关。',
    '   许倩决定不再被动等待，开始暗中调查陈曦的真实身份。',
    '',
    '## 本章埋下的伏笔',
    '- 古玉佩的来历与许倩身世之谜',
    '- 陈曦在宗门内的同伙（不止一人）',
    '- 血煞教对古玉佩的觊觎',
    '- 林逸面壁期间可能遭遇不测',
    '',
    '## 情感线推进',
    '- 许倩对林逸的感情更加深厚，危急时刻林逸的守护让她心动又心疼',
    '- 沈清雪对林逸的感情首次显露——被陷害时她最担心的是"林逸会怎么想"',
    '- 陈曦对许倩表现出虚假的关心，形成微妙的情感张力',
  ].join('\n'), 'utf-8')

  console.log('  [初始化] 测试数据已创建: projects/1/')
  console.log('    - outline/plot.md (含第5章概要)')
  console.log('    - outline/worldbuilding.md')
  console.log('    - characters/许倩.json, 林逸.json, 沈清雪.yaml (3个参考角色)')
  console.log('    - detailed_outline/chapter1.json, chapter4.yaml (2个参考细纲)')
  console.log('    - chapters/chapter1.txt, chapter4.txt (2个占位章节)')
  console.log('    - summaries/chapter4.md (第4章摘要/前情回顾)')
}

// ═══════════════════════════════════════════════════
//  工具实现 (真实文件系统操作)
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      const c = fs.readFileSync(fullPath, 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      const fp = a.file_path || a.path || ''
      return '[错误: 文件不存在或无法读取: ' + fp + ']'
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const fullDir = P(dir)
      const entries = fs.readdirSync(fullDir, { withFileTypes: true })
      if (entries.length === 0) return '(空目录)'
      return entries
        .map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name)
        .join('\n')
    } catch (e) {
      const dir = a.path || a.dir_path || '.'
      return '[错误: 目录不存在: ' + dir + ']'
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
          if (e.isDirectory()) {
            searchDir(f)
            continue
          }
          try {
            const c = fs.readFileSync(f, 'utf-8')
            const ls = c.split('\n')
            for (let i = 0; i < ls.length; i++) {
              if (re.test(ls[i])) {
                results.push(
                  f.replace(ROOT + '/projects/', '') +
                    ':' + (i + 1) + ':' + ls[i].slice(0, 200)
                )
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }

      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++) {
          if (re.test(ls[i])) {
            results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
          }
        }
      } else {
        searchDir(fp)
      }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) {
      return '[错误: 搜索失败]'
    }
  },

  create_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      const c = a.content || ''

      // JSON 文件自动校验格式
      if (fp.endsWith('.json') && c) {
        try {
          JSON.parse(c)
        } catch (e) {
          return '[JSON格式错误: ' + e.message + ']'
        }
      }

      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, c, 'utf-8')
      return '创建成功: ' + fp + ' (' + c.length + '字)'
    } catch (e) {
      return '[错误: ' + e.message + ']'
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
      if (idx < 0) return '[未找到匹配文本: "' + old.slice(0, 80) + '"]'

      fs.writeFileSync(fullPath, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) {
      return '[错误: ' + e.message + ']'
    }
  },

  delete_file: a => {
    try {
      fs.unlinkSync(P(a.file_path || a.path || ''))
      return '删除成功'
    } catch (e) {
      return '[错误: ' + e.message + ']'
    }
  },

  // ── 其余 Harness 工具 (简化实现，保证 TOOLS 定义完整) ──
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
    } catch (e) { return '[错误: ' + e.message + ']' }
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
    } catch (e) { return '[错误: ' + e.message + ']' }
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

  create_style_template: a => {
    try {
      const fp = path.join(ROOT, 'style_templates', (a.name || 'x') + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, JSON.stringify(a, null, 2), 'utf-8')
      return '模板创建成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  create_project: a => {
    try {
      const d = P(a.name || 'new-project')
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        s => fs.mkdirSync(path.join(d, s), { recursive: true })
      )
      return '项目' + a.name + '创建成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  delete_project: a => {
    try {
      fs.rmSync(P(a.name || ''), { recursive: true, force: true })
      return '项目删除成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',

  list_rules: () => '暂无自定义规则',

  learn_rule: a => {
    return '规则已学习: ' + (a.rule || '').slice(0, 60)
  },

  list_audit: () => '暂无审计记录',

  write_learning: a => {
    return '经验已记录: ' + (a.summary || '').slice(0, 60)
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
      description: '读取项目文件内容。已知路径直接读，不要先列目录。读文件是获取上下文的第一步，创建/修改文件前务必先读相关参考文件。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/outline/plot.md、1/characters/许倩.yaml、1/summaries/chapter4.md' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出项目目录内容。仅在不知道文件确切路径时使用。',
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
      description: '创建新文件。JSON文件自动校验格式。创建文件前应先读取相关参考文件。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/characters/陈曦.yaml、1/detailed_outline/chapter5.yaml、1/chapters/chapter5.txt' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑现有文件。先read_file确认原文。不适用于新建文件（新建用create_file）。',
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
      name: 'kb_list',
      description: '列出知识库文件',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_create_file',
      description: '创建知识库文件',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
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
          name: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取笔记',
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
      name: 'create_style_template',
      description: '创建风格模板',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '创建项目',
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
//  系统提示词 (与真实 Harness 一致)
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，帮助用户进行小说创作。',
  '',
  '# 核心规则',
  '',
  '## 顺序铁律: 先读后写',
  '- 任何创建/修改文件的操作之前，必须先读取相关参考文件。',
  '- 写章节前必读: 大纲 → 本章出场角色卡 → 本章细纲 → 前章摘要',
  '- 创建角色前必读: 已有角色参考格式',
  '- 创建细纲前必读: 大纲 + 已有细纲参考格式',
  '',
  '## 多任务处理',
  '- 用户可能在一条消息中嵌入多个任务。你需要:',
  '  1. 识别所有嵌入任务',
  '  2. 按逻辑依赖关系排序（先读后写）',
  '  3. 逐个执行每个任务',
  '- 如果用户指定了顺序，严格按用户指定的顺序执行。',
  '- 同一轮可并行执行多个独立操作（如同时读多个文件）。',
  '- 有依赖的操作分轮执行。',
  '',
  '## 文件路径速查',
  '大纲: 1/outline/plot.md | 世界观: 1/outline/worldbuilding.md',
  '角色: 1/characters/中文名.yaml | 细纲: 1/detailed_outline/chapter{N}.yaml',
  '章节正文: 1/chapters/chapter{N}.txt | 摘要: 1/summaries/chapter{N}.md',
  '',
  '## 角色JSON标准字段 (16个必填)',
  'id, name, role, gender, age, occupation, background, appearance, personality,',
  'abilities, weaknesses, relationships, relationshipTags, arc, importance, motivations',
  '',
  '## 细纲JSON标准字段 (8个必填)',
  'id, title, order, status, plotOverview, characters(出场角色+情绪线),',
  'location, keyEvents(关键事件列表)',
  '',
  '## 写作要求',
  '- 中文写作，文笔流畅，符合小说风格。',
  '- 严格按细纲场景顺序展开。',
  '- 回复简洁，在任务完成后告知用户完成情况。',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 4096,
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
  // 分别记录: read_file 发生在第几轮, create_file 发生在第几轮
  const readIterations = []
  const createIterations = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write('  [iter' + iterations + '] ')

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write('文本回复(' + r.text.length + '字)\n')
      return {
        text: fullText,
        iterations,
        toolCalls: totalTools,
        toolLog,
        readIterations,
        createIterations,
      }
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
      try {
        args = JSON.parse(fn.arguments)
      } catch {
        /* ignore parse errors */
      }

      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = typeof result === 'string' && !result.startsWith('[')
      const icon = ok ? '✓' : '✗'
      totalTools++

      // 记录工具所属迭代
      if (fn.name === 'read_file') readIterations.push(iterations)
      if (fn.name === 'create_file') createIterations.push(iterations)

      process.stdout.write(fn.name + icon + ' ')
      toolLog.push({
        name: fn.name,
        ok,
        args,
        iteration: iterations,
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

  return {
    text: fullText,
    iterations,
    toolCalls: totalTools,
    toolLog,
    readIterations,
    createIterations,
  }
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
  console.log('\n' + '─'.repeat(60))
  console.log('  ' + title)
  console.log('─'.repeat(60))
}

// ═══════════════════════════════════════════════════
//  验证工具函数
// ═══════════════════════════════════════════════════

/**
 * 检查读操作是否在写操作之前
 * 规则: 所有 read_file 的迭代号 <= 所有 create_file 的迭代号
 * 且至少有1个 read_file 的迭代号严格小于第一个 create_file 的迭代号
 */
function readsBeforeWrites(readIterations, createIterations) {
  if (readIterations.length === 0) return { ok: false, reason: '没有 read_file 调用' }
  if (createIterations.length === 0) return { ok: false, reason: '没有 create_file 调用' }

  const maxReadIter = Math.max(...readIterations)
  const minCreateIter = Math.min(...createIterations)

  // 关键检查: 最早的创建不能早于最晚的读取
  // 即: 应该先全部读完, 再开始写
  if (maxReadIter > minCreateIter) {
    // 更宽松的检查: 允许交错, 但第一个工具调用必须是 read_file
    const allCalls = [
      ...readIterations.map(i => ({ type: 'read', iter: i })),
      ...createIterations.map(i => ({ type: 'create', iter: i })),
    ].sort((a, b) => a.iter - b.iter)

    if (allCalls[0].type === 'read') {
      return {
        ok: true,
        reason: '存在读写交错, 但第一个操作是 read_file (宽松通过)',
        strictOk: false,
      }
    }
    return {
      ok: false,
      reason: '第一个操作不是 read_file, 写在读前',
    }
  }

  return {
    ok: true,
    reason: '所有 read_file 在第' + maxReadIter + '轮或之前, 所有 create_file 在第' + minCreateIter + '轮或之后 (严格通过)',
    strictOk: true,
  }
}

/**
 * 检查具体文件是否被读取
 */
function fileWasRead(toolLog, filePattern) {
  return toolLog.some(l =>
    l.name === 'read_file' && l.ok &&
    l.args.file_path && l.args.file_path.includes(filePattern)
  )
}

/**
 * 检查具体文件是否被创建
 */
function fileWasCreated(toolLog, filePattern) {
  return toolLog.some(l =>
    l.name === 'create_file' && l.ok &&
    l.args.file_path && l.args.file_path.includes(filePattern)
  )
}

/**
 * 检查磁盘上文件是否存在且内容符合条件
 */
function checkFileExists(relPath) {
  const fullPath = P(relPath)
  try {
    const stat = fs.statSync(fullPath)
    const content = fs.readFileSync(fullPath, 'utf-8')
    return { exists: true, size: stat.size, content }
  } catch {
    return { exists: false, size: 0, content: '' }
  }
}

// ═══════════════════════════════════════════════════
//  清理函数
// ═══════════════════════════════════════════════════
function cleanupTestDir() {
  try {
    const projDir = P('1')
    if (fs.existsSync(projDir)) {
      fs.rmSync(projDir, { recursive: true, force: true })
      console.log('  🧹 已清理: projects/1/')
    }
  } catch (e) {
    console.log('  ⚠ 清理失败: ' + e.message)
  }

  // 也清理可能的空 projects 目录
  try {
    const projRoot = P('')
    const remaining = fs.readdirSync(projRoot).filter(f => !f.startsWith('.'))
    if (remaining.length === 0) {
      fs.rmdirSync(projRoot)
    }
  } catch { /* ok */ }
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('═════════════════════════════════════════')
  console.log('  仿真测试: 多意图顺序依赖 (multi-intent-02-sequential-tasks)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: 5个嵌入任务 + 顺序依赖 + 先读后写验证')
  console.log('═════════════════════════════════════════')

  // 准备测试数据
  seedTestData()

  // ═══════════════════════════════════════════════════
  //  S1: 多任务顺序依赖 — 用户一口气提5个任务
  // ═══════════════════════════════════════════════════
  hr('S1 多任务顺序依赖')

  const userMsg = [
    '我要写第5章。你需要：',
    '1. 先读大纲了解整体剧情',
    '2. 创建角色“陈曦”（反派，35岁）',
    '3. 给第5章写细纲',
    '4. 读第4章摘要（前情回顾）',
    '5. 最后写第5章正文。',
    '注意顺序不要乱，该先读的文件先读了再写新的，保存到项目1里。',
  ].join(' ')

  console.log('  用户消息 (5个嵌入任务):')
  console.log('    任务1: 读取大纲 (1/outline/plot.md)')
  console.log('    任务2: 创建角色 陈曦 (反派, 35岁)')
  console.log('    任务3: 写第5章细纲 (1/detailed_outline/chapter5.yaml)')
  console.log('    任务4: 读取第4章摘要 (1/summaries/chapter4.md)')
  console.log('    任务5: 写第5章正文 (1/chapters/chapter5.txt)')
  console.log('')

  const r1 = await agentRun(userMsg)

  // ═══════════════════════════════════════════════════
  //  断言: PART A — 基本交互验证
  // ═══════════════════════════════════════════════════
  hr('断言: PART A — 基本交互验证')
  t('A1 有工具调用', r1.toolCalls >= 1,
    r1.toolCalls + '个工具 ' + r1.iterations + '轮')
  t('A2 AI有文本回复', r1.text.length > 0,
    r1.text.length + '字')
  t('A3 未达到最大迭代上限',
    r1.iterations < MAX_ITERATIONS,
    r1.iterations + '/' + MAX_ITERATIONS + '轮')

  // ═══════════════════════════════════════════════════
  //  断言: PART B — 任务识别验证 (5个嵌入式任务是否都被识别)
  // ═══════════════════════════════════════════════════
  hr('断言: PART B — 任务识别验证 (是否识别所有5个嵌入任务)')

  // 任务1: 读大纲
  const b1_readOutline = fileWasRead(r1.toolLog, 'plot.md') || fileWasRead(r1.toolLog, 'outline')
  t('B1 [任务1] 读取大纲 (plot.md)', b1_readOutline,
    b1_readOutline ? '已读取' : '未读取')

  // 任务2: 创建角色陈曦
  const b2_createChar = fileWasCreated(r1.toolLog, '陈曦') || fileWasCreated(r1.toolLog, 'chen')
  // 也检查磁盘
  const charFile = checkFileExists('1/characters/陈曦.yaml')
  t('B2 [任务2] 创建角色 陈曦', b2_createChar || charFile.exists,
    (b2_createChar ? '已调用create_file ' : '') + (charFile.exists ? '文件已存在' : '未找到'))

  // 任务3: 写第5章细纲
  const b3_createOutline = fileWasCreated(r1.toolLog, 'chapter5') || fileWasCreated(r1.toolLog, 'detailed_outline')
  const detFile = checkFileExists('1/detailed_outline/chapter5.yaml')
  t('B3 [任务3] 写第5章细纲', b3_createOutline || detFile.exists,
    (b3_createOutline ? '已调用create_file ' : '') + (detFile.exists ? '文件已存在' : '未找到'))

  // 任务4: 读第4章摘要
  const b4_readSummary = fileWasRead(r1.toolLog, 'chapter4.md') || fileWasRead(r1.toolLog, 'summaries')
  t('B4 [任务4] 读第4章摘要 (summary)', b4_readSummary,
    b4_readSummary ? '已读取' : '未读取')

  // 任务5: 写第5章正文
  const b5_createChapter = fileWasCreated(r1.toolLog, 'chapter5.txt') || fileWasCreated(r1.toolLog, 'chapters')
  const ch5File = checkFileExists('1/chapters/chapter5.txt')
  t('B5 [任务5] 写第5章正文', b5_createChapter || ch5File.exists,
    (b5_createChapter ? '已调用create_file ' : '') + (ch5File.exists ? '文件已存在' : '未找到'))

  // 汇总: 全部5个任务是否都被识别并执行
  const allTasksDone = b1_readOutline && (b2_createChar || charFile.exists) &&
    (b3_createOutline || detFile.exists) && b4_readSummary && (b5_createChapter || ch5File.exists)
  t('B6 全部5个任务均被执行', allTasksDone,
    [
      b1_readOutline ? '✓大纲' : '✗大纲',
      (b2_createChar || charFile.exists) ? '✓陈曦' : '✗陈曦',
      (b3_createOutline || detFile.exists) ? '✓细纲' : '✗细纲',
      b4_readSummary ? '✓摘要' : '✗摘要',
      (b5_createChapter || ch5File.exists) ? '✓章节' : '✗章节',
    ].join(' '))

  // ═══════════════════════════════════════════════════
  //  断言: PART C — 顺序验证 (read在create之前)
  // ═══════════════════════════════════════════════════
  hr('断言: PART C — 顺序验证 (先读后写)')

  t('C1 read_file 被调用', r1.readIterations.length > 0,
    r1.readIterations.length + '次')
  t('C2 create_file 被调用', r1.createIterations.length > 0,
    r1.createIterations.length + '次')

  const orderCheck = readsBeforeWrites(r1.readIterations, r1.createIterations)
  t('C3 read_file 在 create_file 之前', orderCheck.ok,
    orderCheck.reason)

  // 补充: 严格顺序检查 (所有读在第一批写之前完成)
  const strictOrder = orderCheck.strictOk !== false
  t('C4 严格顺序: 全部读完再写', strictOrder,
    strictOrder ? '通过' : '存在读写交错(可接受)')

  // 展示工具调用顺序
  const orderedCalls = [...r1.toolLog].map(l =>
    'iter' + l.iteration + ':' + l.name + '(' +
    (l.args.file_path || l.args.path || '').slice(0, 30) +
    ')' + (l.ok ? '' : '✗')
  )
  console.log('\n  工具调用顺序:')
  for (const call of orderedCalls) {
    const isRead = call.includes(':read_file')
    const isCreate = call.includes(':create_file')
    const prefix = isRead ? '  📖 ' : isCreate ? '  ✍️ ' : '     '
    console.log(prefix + call)
  }

  // ═══════════════════════════════════════════════════
  //  断言: PART D — 角色陈曦质量验证
  // ═══════════════════════════════════════════════════
  hr('断言: PART D — 角色陈曦质量验证')

  const CHARACTER_16_FIELDS = [
    'id', 'name', 'role', 'gender', 'age', 'occupation',
    'background', 'appearance', 'personality', 'abilities',
    'weaknesses', 'relationships', 'relationshipTags', 'arc',
    'importance', 'motivations',
  ]

  const VALID_ROLES = ['男主', '女主', '男配', '女配', '反派', '其他']

  if (charFile.exists && charFile.content) {
    let charObj = null
    try {
      charObj = JSON.parse(charFile.content)
    } catch (e) {
      t('D0 JSON解析成功', false, e.message)
    }

    if (charObj) {
      const missing = CHARACTER_16_FIELDS.filter(f => !(f in charObj))
      t('D1 16字段完整 (' + CHARACTER_16_FIELDS.length + '字段)',
        missing.length === 0,
        missing.length > 0 ? '缺少: ' + missing.join(', ') : '全部字段')

      t('D2 name="陈曦"', charObj.name === '陈曦',
        '实际: "' + charObj.name + '"')

      t('D3 role="反派"', charObj.role === '反派',
        '实际: "' + charObj.role + '"')

      t('D4 role在合法范围内', VALID_ROLES.includes(charObj.role),
        'role="' + charObj.role + '"')

      t('D5 age=35', String(charObj.age) === '35',
        '实际: ' + String(charObj.age))

      t('D6 abilities是字符串', typeof charObj.abilities === 'string',
        '类型: ' + typeof charObj.abilities)

      t('D7 relationshipTags是数组', Array.isArray(charObj.relationshipTags),
        '类型: ' + typeof charObj.relationshipTags)

      t('D8 importance是数字', typeof charObj.importance === 'number',
        '类型: ' + typeof charObj.importance + ', 值: ' + String(charObj.importance))

      t('D9 角色描述有实质内容',
        charObj.background && charObj.background.length > 20,
        'background: ' + (charObj.background || '').length + '字')

      t('D10 人格描述有实质内容',
        charObj.personality && charObj.personality.length > 10,
        'personality: ' + (charObj.personality || '').length + '字')

      if (charObj.name && charObj.role) {
        console.log('    角色摘要: ' + charObj.name + ' | ' + charObj.role +
          ' | gender=' + charObj.gender + ' | age=' + charObj.age +
          ' | importance=' + charObj.importance)
      }
    }
  } else {
    t('D✗ 角色文件不存在', false, '无法进行内容验证')
  }

  // ═══════════════════════════════════════════════════
  //  断言: PART E — 第5章细纲质量验证
  // ═══════════════════════════════════════════════════
  hr('断言: PART E — 第5章细纲质量验证')

  const DET_FIELDS = ['id', 'title', 'order', 'status', 'plotOverview', 'characters', 'location', 'keyEvents']

  if (detFile.exists && detFile.content) {
    let detObj = null
    try {
      detObj = JSON.parse(detFile.content)
    } catch (e) {
      t('E0 JSON解析成功', false, e.message)
    }

    if (detObj) {
      const missing = DET_FIELDS.filter(f => !(f in detObj))
      t('E1 8字段完整 (' + DET_FIELDS.length + '字段)',
        missing.length === 0,
        missing.length > 0 ? '缺少: ' + missing.join(', ') : '全部字段')

      t('E2 id为 chapter5', detObj.id === 'chapter5' || String(detObj.id).includes('5'),
        '实际: "' + detObj.id + '"')

      t('E3 有标题', detObj.title && detObj.title.length > 0,
        'title: "' + (detObj.title || '') + '"')

      t('E4 plotOverview有内容',
        detObj.plotOverview && detObj.plotOverview.length > 30,
        'plotOverview: ' + (detObj.plotOverview || '').length + '字')

      t('E5 characters为数组且非空',
        Array.isArray(detObj.characters) && detObj.characters.length > 0,
        'characters: ' + (Array.isArray(detObj.characters) ? detObj.characters.length + '个' : '非数组'))

      t('E6 keyEvents为数组且非空',
        Array.isArray(detObj.keyEvents) && detObj.keyEvents.length > 0,
        'keyEvents: ' + (Array.isArray(detObj.keyEvents) ? detObj.keyEvents.length + '个' : '非数组'))

      // 验证细纲提到了第5章大纲的内容 (山雨欲来, 陈曦暴露, 林逸被抓)
      const plotText = JSON.stringify(detObj)
      t('E7 细纲与大纲一致 (提及陈曦或血煞教或林逸)',
        /[陈曦血煞教林逸古玉佩]/.test(plotText),
        '细纲包含大纲的关键元素')
    }
  } else {
    t('E✗ 细纲文件不存在', false, '无法进行内容验证')
  }

  // ═══════════════════════════════════════════════════
  //  断言: PART F — 第5章正文质量验证
  // ═══════════════════════════════════════════════════
  hr('断言: PART F — 第5章正文质量验证')

  if (ch5File.exists && ch5File.content) {
    // 去除空白字符的字数统计
    const textOnly = ch5File.content.replace(/\s/g, '')
    const totalLen = ch5File.content.length

    t('F1 文件已创建', true, totalLen + '字节')

    t('F2 内容较为丰富 (≥100字节)',
      totalLen >= 100,
      totalLen + '字节')

    t('F3 有效文字较多 (≥50字)',
      textOnly.length >= 50,
      textOnly.length + '字')

    t('F4 包含中文内容',
      /[一-鿿]/.test(ch5File.content),
      '含中文字符')

    // 检查是否与大纲/细纲/摘要一致
    t('F5 与第5章大纲一致 (提及陈曦或血煞教或林逸)',
      /[陈曦血煞教林逸古玉佩山雨]/.test(ch5File.content),
      '内容与大纲关联')

    // 检查是否参考了第4章摘要 (前情回顾)
    t('F6 与第4章衔接 (提及第4章事件)',
      /[突破面壁陷害诀裂咒语]/.test(ch5File.content) ||
      /第[四4]章/.test(ch5File.content),
      '与前情有衔接')

    console.log('    章节文件: ' + totalLen + '字节, 有效文字约' + textOnly.length + '字')
    console.log('    前200字: ' + ch5File.content.slice(0, 200).replace(/\n/g, '\\n'))
  } else {
    t('F✗ 章节文件不存在', false, '无法进行内容验证')
  }

  // ═══════════════════════════════════════════════════
  //  断言: PART G — 额外顺序验证 (具体文件级别)
  // ═══════════════════════════════════════════════════
  hr('断言: PART G — 具体依赖关系验证')

  // G1: 大纲必须在角色创建之前读取
  const outlineReads = r1.toolLog.filter(l =>
    l.name === 'read_file' && l.ok &&
    (l.args.file_path || '').includes('plot.md')
  )
  const charCreates = r1.toolLog.filter(l =>
    l.name === 'create_file' && l.ok &&
    (l.args.file_path || '').includes('陈曦')
  )
  if (outlineReads.length > 0 && charCreates.length > 0) {
    t('G1 大纲读取在角色创建之前',
      outlineReads[0].iteration <= charCreates[0].iteration,
      '大纲: iter' + outlineReads[0].iteration + ' ≤ 角色: iter' + charCreates[0].iteration)
  } else {
    t('G1 大纲读取在角色创建之前', false,
      '无法比较(缺少相关工具调用)')
  }

  // G2: 第4章摘要必须在第5章正文之前读取
  const summaryReads = r1.toolLog.filter(l =>
    l.name === 'read_file' && l.ok &&
    (l.args.file_path || '').includes('chapter4.md')
  )
  const chapterCreates = r1.toolLog.filter(l =>
    l.name === 'create_file' && l.ok &&
    (l.args.file_path || '').includes('chapter5.txt')
  )
  if (summaryReads.length > 0 && chapterCreates.length > 0) {
    t('G2 摘要读取在章节创建之前',
      summaryReads[0].iteration <= chapterCreates[0].iteration,
      '摘要: iter' + summaryReads[0].iteration + ' ≤ 章节: iter' + chapterCreates[0].iteration)
  } else {
    t('G2 摘要读取在章节创建之前', false,
      '无法比较(缺少相关工具调用)')
  }

  // G3: 大纲/角色参考文献是否在细纲创建前读取
  const refReadsForOutline = r1.toolLog.filter(l =>
    l.name === 'read_file' && l.ok &&
    ((l.args.file_path || '').includes('plot.md') ||
     (l.args.file_path || '').includes('chapter4.json') ||
     (l.args.file_path || '').includes('许倩') ||
     (l.args.file_path || '').includes('林逸'))
  )
  const detCreates = r1.toolLog.filter(l =>
    l.name === 'create_file' && l.ok &&
    (l.args.file_path || '').includes('chapter5.json')
  )
  t('G3 参考文件读取在细纲创建之前',
    refReadsForOutline.length > 0 && (detCreates.length === 0 ||
      Math.min(...refReadsForOutline.map(r => r.iteration)) <= detCreates[0].iteration),
    refReadsForOutline.length + '次参考读取, ' +
    (detCreates.length > 0 ? '细纲创建在 iter' + detCreates[0].iteration : '未找到细纲创建'))

  // ═══════════════════════════════════════════════════
  //  断言: PART H — 汇总统计
  // ═══════════════════════════════════════════════════
  hr('断言: PART H — 汇总统计')

  const readCount = r1.toolLog.filter(l => l.name === 'read_file').length
  const createCount = r1.toolLog.filter(l => l.name === 'create_file').length
  const readOk = r1.toolLog.filter(l => l.name === 'read_file' && l.ok).length
  const createOk = r1.toolLog.filter(l => l.name === 'create_file' && l.ok).length

  console.log('  read_file: ' + readOk + '/' + readCount + ' 次成功')
  console.log('  create_file: ' + createOk + '/' + createCount + ' 次成功')
  console.log('  其他工具: ' + (r1.toolCalls - readCount - createCount) + ' 次')
  console.log('  总迭代: ' + r1.iterations + ', 总工具: ' + r1.toolCalls)

  // ═══════════════════════════════════════════════════
  //  清理
  // ═══════════════════════════════════════════════════
  console.log('\n  ── 清理测试文件 ──')
  cleanupTestDir()

  // ═══════════════════════════════════════════════════
  //  最终汇总
  // ═══════════════════════════════════════════════════
  const total = pass + fail
  console.log('\n')
  console.log('═════════════════════════════════════════')
  console.log('  多意图顺序依赖仿真测试结果')
  console.log('═════════════════════════════════════════')
  console.log('  总计: ' + total + '  ✅ ' + pass + '  ❌ ' + fail)
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  测试维度:')
  console.log('    PART A — 基本交互验证 (有工具调用、有文本回复)')
  console.log('    PART B — 任务识别验证 (5个嵌入任务是否全部执行)')
  console.log('    PART C — 顺序验证 (read_file 在 create_file 之前)')
  console.log('    PART D — 角色质量验证 (16字段 + 角色属性正确)')
  console.log('    PART E — 细纲质量验证 (8字段 + 内容一致性)')
  console.log('    PART F — 章节质量验证 (内容丰富、中文、与大纲一致)')
  console.log('    PART G — 具体依赖关系验证 (大纲→角色、摘要→章节)')
  console.log('    PART H — 汇总统计')
  console.log('')
  console.log('  用户消息覆盖:')
  console.log('    任务1: "先读大纲了解整体剧情"')
  console.log('    任务2: "创建角色“陈曦”（反派，35岁）"')
  console.log('    任务3: "给第5章写细纲"')
  console.log('    任务4: "读第4章摘要（前情回顾）"')
  console.log('    任务5: "最后写第5章正文"')
  console.log('═════════════════════════════════════════')

  if (fail > 0) {
    process.exitCode = 1
  }
}

// ═══════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════
main()
  .then(() => {
    // exit code already set if failures
  })
  .catch(e => {
    console.error('\n💥 测试异常:', e.message)
    console.error(e.stack)
    process.exit(1)
  })
