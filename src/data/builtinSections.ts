// ── 大纲内置部分定义（v16.4.1）──
// 纯数据、零依赖：渲染层（outlineSectionService 首次生成 sections.json）
// 与主进程（projectHandlers 新建项目初始化）共用。
// 除固定 3 个（故事剧情/世界观/角色）外均可屏蔽/新增（屏蔽 = hidden 划线，数据保留）。

import type { OutlineSectionDef } from '@/types/outline'

// ── v16.4.1(审查修复): 共享映射单一真源——侧边栏/实体卡片/AI 生成参考弹窗统一使用，
// 避免多份 emoji/名称/维度映射互不一致 ──

/** 部分 key → emoji（含 doc 部分；自定义部分缺省 📄） */
export const SECTION_EMOJI: Record<string, string> = {
  story: '📜', worldbuilding: '🌍', characters: '👥',
  items: '⚔️', locations: '🏔️', factions: '🛡️', power_systems: '⚡',
  foreshadows: '🧩', emotions: '💗', threads: '🪢',
}

/** 部分 key → 中文名（自定义部分缺省 key） */
export const SECTION_NAMES: Record<string, string> = {
  items: '道具', locations: '地点', factions: '势力', power_systems: '等级',
  foreshadows: '伏笔', emotions: '情绪', threads: '故事线',
}

/** 大纲维度键（OutlineTabToggles）→ 实体部分 key（实体级勾选注入用） */
export const DIM_SECTION_MAP: Record<string, string> = {
  items: 'items', locations: 'locations', factions: 'factions',
  powerSystem: 'power_systems', emotion: 'emotions',
  foreshadowing: 'foreshadows', plotThreads: 'threads',
}

export const BUILTIN_SECTIONS: OutlineSectionDef[] = [
  { key: 'story', name: '故事剧情', type: 'doc', fixed: true, file: 'plot.md' },
  { key: 'worldbuilding', name: '世界观', type: 'doc', fixed: true, file: 'worldbuilding.md' },
  {
    key: 'characters', name: '角色', type: 'entities', fixed: true,
    fields: [
      { key: 'name', label: '姓名', type: 'text', required: true },
      { key: 'role', label: '角色定位', type: 'select', options: ['男主', '女主', '男配', '女配', '反派', '其他'] },
      { key: 'gender', label: '性别', type: 'select', options: ['男', '女', '其他'] },
      { key: 'age', label: '年龄', type: 'text' },
      { key: 'occupation', label: '身份职业', type: 'text' },
      { key: 'background', label: '背景经历', type: 'textarea' },
      { key: 'appearance', label: '外貌', type: 'textarea' },
      { key: 'personality', label: '性格', type: 'textarea' },
      { key: 'abilities', label: '能力', type: 'textarea' },
      { key: 'weaknesses', label: '弱点', type: 'textarea' },
      { key: 'importance', label: '重要程度', type: 'select', options: ['主角', '重要', '一般', '龙套'] },
    ],
  },
  {
    key: 'items', name: '道具', type: 'entities',
    fields: [      { key: 'name', label: '名称', type: 'text', required: true, core: true },
      { key: 'type', label: '类型', type: 'select', options: ['武器', '法宝', '丹药', '功法', '道具', '其他'], core: true },
      { key: 'grade', label: '品级', type: 'select', options: ['凡器', '灵器', '仙器', '神器', '凡品', '其他'], core: true },
      { key: 'ability', label: '能力效果', type: 'textarea', placeholder: '有什么能力、如何发挥作用' },
      { key: 'owner', label: '持有者', type: 'text', placeholder: '当前/历任持有者' },
      { key: 'origin', label: '来历', type: 'textarea', placeholder: '如何得到、锻造/制作背景' },
      { key: 'limitation', label: '限制与副作用', type: 'textarea', placeholder: '使用限制、代价、副作用' },
      { key: 'plotRole', label: '剧情作用', type: 'textarea', placeholder: '在剧情中起到什么作用' }
    ],
  },
  {
    key: 'locations', name: '地点', type: 'entities',
    fields: [      { key: 'name', label: '名称', type: 'text', required: true, core: true },
      { key: 'type', label: '类型', type: 'select', options: ['门派', '城池', '秘境', '自然', '其他'], core: true },
      { key: 'geography', label: '地理位置', type: 'textarea', placeholder: '方位、地貌、与其他地点关系' },
      { key: 'environment', label: '环境描述', type: 'textarea', placeholder: '景象、氛围、气候' },
      { key: 'faction', label: '势力归属', type: 'text', placeholder: '所属势力/管理者' },
      { key: 'importantEvents', label: '重要事件', type: 'textarea', placeholder: '发生过的关键事件' },
      { key: 'plotRole', label: '剧情作用', type: 'textarea', placeholder: '在剧情中起到什么作用' }
    ],
  },
  {
    key: 'factions', name: '势力', type: 'entities',
    fields: [      { key: 'name', label: '名称', type: 'text', required: true, core: true },
      { key: 'type', label: '类型', type: 'select', options: ['正道', '邪道', '中立', '皇朝', '其他'], core: true },
      { key: 'creed', label: '宗旨理念', type: 'textarea', placeholder: '信条、目标、行事风格' },
      { key: 'strength', label: '实力构成', type: 'textarea', placeholder: '顶尖战力、规模、资源' },
      { key: 'members', label: '成员结构', type: 'textarea', placeholder: '重要成员及其定位' },
      { key: 'territory', label: '地盘', type: 'textarea', placeholder: '管辖范围、据点' },
      { key: 'relations', label: '与其他势力关系', type: 'textarea', placeholder: '结盟、敌对、利用关系' }
    ],
  },
  {
    key: 'power_systems', name: '等级', type: 'entities',
    fields: [      { key: 'name', label: '体系名称', type: 'text', required: true, placeholder: '如: 修仙等级、剑道境界', core: true },
      { key: 'levels', label: '等级列表', type: 'textarea', placeholder: '每行一个等级，格式「名称 — 描述」\n练气期 — 聚气化液\n筑基期 — …' },
      { key: 'breakthrough', label: '突破条件', type: 'textarea', placeholder: '各境界如何晋升、瓶颈' },
      { key: 'features', label: '体系特点', type: 'textarea', placeholder: '与其他体系差异、世界观中的定位' }
    ],
  },
  {
    key: 'foreshadows', name: '伏笔', type: 'entities',
    fields: [      { key: 'description', label: '伏笔描述', type: 'textarea', required: true, placeholder: '如: 第1章提到主角母亲的遗物', core: true },
      { key: 'status', label: '状态', type: 'select', options: ['planted', 'resolved'], core: true },
      { key: 'plantChapterId', label: '埋设章节', type: 'text', placeholder: '章节 id', core: true },
      { key: 'payoffChapterId', label: '回收章节', type: 'text', placeholder: '章节 id（未指定=待回收）' },
      { key: 'payoffMethod', label: '回收方式', type: 'textarea', placeholder: '如何揭示/回收这条伏笔' },
      { key: 'relatedPlot', label: '关联剧情', type: 'textarea', placeholder: '牵涉的人物与事件' }
    ],
  },
  {
    key: 'emotions', name: '情绪', type: 'entities',
    fields: [      { key: 'chapterStart', label: '起始章', type: 'number', core: true },
      { key: 'chapterEnd', label: '结束章', type: 'number', core: true },
      { key: 'dominantEmotion', label: '主导情绪', type: 'text', required: true, placeholder: '如: 压抑、热血、温馨', core: true },
      { key: 'development', label: '情绪发展描述', type: 'textarea', placeholder: '情绪如何变化推进' },
      { key: 'keyEvents', label: '关键事件', type: 'textarea', placeholder: '推动情绪转折的事件' }
    ],
  },
  {
    key: 'threads', name: '故事线', type: 'entities',
    fields: [      { key: 'name', label: '故事线名称', type: 'text', required: true, placeholder: '如: 主角复仇线', core: true },
      { key: 'type', label: '类型', type: 'select', options: ['main', 'sub', 'hidden'], core: true },
      { key: 'startChapter', label: '起始章节', type: 'text', placeholder: '章节 id', core: true },
      { key: 'endChapter', label: '结束章节', type: 'text', placeholder: '章节 id' },
      { key: 'color', label: '颜色', type: 'text', placeholder: '十六进制色值，如 #7c3aed' },
      { key: 'keyNodes', label: '关键节点', type: 'textarea', placeholder: '每行一个关键节点（如: 第3章 发现线索）' },
      { key: 'relatedCharacters', label: '关联角色', type: 'textarea', placeholder: '参与这条故事线的角色' }
    ],
  },
]
