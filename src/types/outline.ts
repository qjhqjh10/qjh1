export interface OutlineItem {
  id: string
  name: string
  type: string
  grade?: string
  ability?: string
  owner?: string
  description?: string
}

export interface OutlineLocation {
  id: string
  name: string
  description: string
  type?: string
}

export interface OutlineFaction {
  id: string
  name: string
  description: string
  type?: string
}

export interface PowerLevel {
  name: string
  description: string
}

export interface PowerSystem {
  name: string
  levels: PowerLevel[]
  description: string
}

export interface EmotionSegment {
  chapterStart: number
  chapterEnd: number
  dominantEmotion: string
  description?: string
}

export interface EmotionData {
  segments: EmotionSegment[]
}

export interface OutlineItemsData {
  items: OutlineItem[]
}

export interface OutlineLocationsData {
  locations: OutlineLocation[]
}

export interface OutlineFactionsData {
  factions: OutlineFaction[]
}

// ═══════════════════════════════════════════════════════════
// v16.4.1: 大纲部分注册表 + 通用实体（可增删部分 / 每实体一文件）
// ═══════════════════════════════════════════════════════════

/** 字段模板——定义实体部分的核心字段（新建部分向导也用它）。
 *  v16.4.1: core=true 的字段结构化渲染；其余信息用自由条块（blocks）承载，不设固定字段 */
export interface OutlineSectionField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number'
  /** select 用：可选值列表 */
  options?: string[]
  /** 是否必填（默认 false；name 字段恒必填） */
  required?: boolean
  placeholder?: string
  /** 新建时的默认值 */
  defaultValue?: string | number
  /** v16.4.1: 结构化核心字段（表单内固定输入）；false/缺省 = 归入自由条块 */
  core?: boolean
}

/** 自由信息条块（v16.4.1，对齐角色卡 customBlocks）：label + content，可增删 */
export interface OutlineEntityBlock {
  label: string
  content: string
}

/** 部分定义（sections.json 的一项） */
export interface OutlineSectionDef {
  /** 目录名（英文/URL 安全，如 items、relationships） */
  key: string
  /** 显示名称（如"道具"、"恋爱关系"） */
  name: string
  /** doc = 单文件协作空间（故事剧情/世界观）；entities = 每实体一文件卡片管理 */
  type: 'doc' | 'entities'
  /** true = 不可删除（故事剧情/世界观/角色） */
  fixed?: boolean
  /** doc 部分用：文件夹内文件名（如 plot.md） */
  file?: string
  /** entities 部分用：字段模板 */
  fields?: OutlineSectionField[]
  /** v16.4.1: 屏蔽状态（侧边栏划线；数据与文件保留，随时可恢复） */
  hidden?: boolean
}

export interface OutlineSectionsData {
  sections: OutlineSectionDef[]
}

/**
 * 通用实体（entities 部分的一个文件）。
 * id = 文件名（去扩展名）——唯一事实来源（同角色约定：AI 生成文件里内容 id 不可信）；
 * 其余字段按部分字段模板动态展开。
 */
export interface OutlineEntity {
  id: string
  /** 展示名称（内容里的 name 字段；伏笔/情绪段等无 name 的用其他主字段） */
  name?: string
  [key: string]: unknown
}

