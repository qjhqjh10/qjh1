import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import type { Character, CharacterRole } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'

export const ROLES: CharacterRole[] = ['男主', '女主', '男配', '女配', '反派', '其他']

export function normalizeRole(raw: string): CharacterRole {
  if (!raw) return '其他'
  const r = raw.trim()
  // Exact match first
  if ((ROLES as string[]).includes(r)) return r as CharacterRole
  // Fuzzy matching — map free-form AI output to standard values
  if (/男主|男一|主角/.test(r)) return '男主'
  if (/女主|女一/.test(r)) return '女主'
  if (/男配/.test(r)) return '男配'
  if (/女配/.test(r)) return '女配'
  if (/反派|敌人|boss/.test(r)) return '反派'
  return '其他'
}

export const CHARACTER_FIELDS: { key: keyof Character; label: string; isNumber?: boolean }[] = [
  { key: 'name', label: '姓名' },
  { key: 'role', label: '角色类型' },
  { key: 'gender', label: '性别' },
  { key: 'age', label: '年龄' },
  { key: 'occupation', label: '职业/身份' },
  { key: 'background', label: '背景设定' },
  { key: 'appearance', label: '外观特征' },
  { key: 'personality', label: '性格特征' },
  { key: 'abilities', label: '能力' },
  { key: 'weaknesses', label: '弱点' },
  { key: 'relationships', label: '角色关系网' },
  { key: 'relationshipTags', label: '关系标签' },
  { key: 'arc', label: '角色成长弧线' },
  { key: 'importance', label: '重要程度', isNumber: true },
  { key: 'image', label: '形象图' },
]

function jsonPath(projectPath: string, id: string) {
  return `${projectPath}/characters/${id}.json`
}

export async function saveCharacter(projectPath: string, character: Character) {
  try {
    await fileService.write(jsonPath(projectPath, character.id), JSON.stringify(character, null, 2))
  } catch (e) {
    logError(`保存角色失败: ${character.name}`, e)
    throw e
  }
}

export async function loadCharacters(projectPath: string): Promise<Character[]> {
  try {
    const files = await fileService.listDir(`${projectPath}/characters`)
    const chars: Character[] = []

    // Prefer .json files
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    const seenIds = new Set<string>()

    for (const file of jsonFiles) {
      try {
        const content = await fileService.read(`${projectPath}/characters/${file}`)
        const char = JSON.parse(content) as Character
        // Normalize role — AI may write free-form values like "重要女配"
        char.role = normalizeRole(char.role as string)
        chars.push(char)
        seenIds.add(file.replace('.json', ''))
      } catch (err) { logError(`跳过无效角色文件: ${file}`, err) }
    }

    // Fallback: legacy .txt files not yet migrated
    const txtFiles = files.filter(f => {
      if (!f.endsWith('.txt')) return false
      const id = f.replace('.txt', '')
      return !seenIds.has(id)
    })

    for (const file of txtFiles) {
      try {
        const content = await fileService.read(`${projectPath}/characters/${file}`)
        const char: Character = { ...EMPTY_CHARACTER, id: file.replace('.txt', '') }
        const lines = content.split('\n')
        for (const line of lines) {
          const match = line.match(/^(.+?): (.+)$/)
          if (match) {
            const field = CHARACTER_FIELDS.find(f => f.label === match[1])
            if (field) {
              if (field.key === 'relationshipTags') {
                char.relationshipTags = match[2].split(/[、,，]/).map((s: string) => s.trim()).filter(Boolean) as Character['relationshipTags']
              } else if (field.key === 'role') {
                const roleMatch = ROLES.find(r => r === match[2])
                Object.assign(char, { [field.key]: roleMatch || '其他' })
              } else if (field.isNumber) {
                const n = parseInt(match[2], 10)
                if (!isNaN(n)) Object.assign(char, { [field.key]: n })
              } else {
                Object.assign(char, { [field.key]: match[2] })
              }
            }
          }
        }
        chars.push(char)
      } catch (err) { logError(`跳过无效TXT角色文件: ${file}`, err) }
    }

    return chars
  } catch {
    return []
  }
}

export function parseCharacterFromAI(text: string): Partial<Character> {
  const char: Partial<Character> = {}
  const lines = text.split('\n')
  for (const line of lines) {
    const m = line.match(/^(.+?)[:：]\s*(.+)$/)
    if (m) {
      const rawLabel = m[1].trim()
      const rawValue = m[2].trim()
      const field = CHARACTER_FIELDS.find(f => f.label === rawLabel)
      if (field) {
        if (field.key === 'relationshipTags') {
          char.relationshipTags = rawValue.split(/[、,，]/).map((s: string) => s.trim()).filter(Boolean) as Character['relationshipTags']
        } else if (field.key === 'role') {
          char.role = normalizeRole(rawValue)
        } else if (field.isNumber) {
          Object.assign(char, { [field.key]: parseInt(rawValue, 10) || 0 })
        } else {
          Object.assign(char, { [field.key]: rawValue })
        }
      }
    }
  }
  return char
}
