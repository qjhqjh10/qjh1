export type CharacterRole = '男主' | '女主' | '男配' | '女配' | '反派' | '其他'

export const RELATIONSHIP_TAGS = [
  '恋人', '后宫', '妻子', '丈夫',
  '父亲', '母亲', '姐姐', '妹妹', '哥哥', '弟弟',
  '师父', '徒弟', '师兄弟', '师姐妹',
  '挚友', '知己', '盟友', '同伴',
  '敌人', '宿敌', '竞争对手', '仇人',
  '上司', '下属', '同僚',
  '救命恩人', '青梅竹马', '初恋', '暗恋对象',
  '养父', '养母', '养子', '养女',
  '前世', '转世', '分身',
] as const

export type RelationshipTag = (typeof RELATIONSHIP_TAGS)[number]

export interface Character {
  id: string
  name: string
  role: CharacterRole
  gender: string
  age: string
  occupation: string
  background: string
  appearance: string
  personality: string
  abilities: string
  weaknesses: string
  importance: number
  relationships: string
  relationshipTags: RelationshipTag[]
  arc: string
  image?: string
}

// ---- Relationship Graph (AI-generated) ----

export interface RelationEdge {
  source: string
  target: string
  relation: string
  description: string
}

export interface RelationshipGraph {
  nodes: { id: string; name: string; role: CharacterRole }[]
  edges: RelationEdge[]
  generatedAt: string
}

export const EMPTY_CHARACTER: Character = {
  id: '',
  name: '',
  role: '其他',
  gender: '',
  age: '',
  occupation: '',
  background: '',
  appearance: '',
  personality: '',
  abilities: '',
  weaknesses: '',
  relationships: '',
  relationshipTags: [],
  arc: '',
  importance: 50,
}
