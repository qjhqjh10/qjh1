export type CharacterRole = '男主' | '女主' | '男配' | '女配' | '反派' | '其他'

/** 自定义信息条块：label = 特点/标签名，content = 具体信息 */
export interface CharacterBlock {
  label: string
  content: string
}

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
  arc: string
  /** 用户自定义条块（特点 → 信息），可自由增删 */
  customBlocks: CharacterBlock[]
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
  arc: '',
  importance: 50,
  customBlocks: [],
}
