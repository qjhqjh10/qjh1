import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import type { Character, CharacterRole } from '@/types/character'

/**
 * Normalize a character object from non-standard formats to the canonical
 * 16-field flat schema. Handles the nested-object anti-pattern that AI
 * sometimes produces (basicInfo/appearance/personality sub-objects).
 */
function normalizeCharacter(raw: Record<string, unknown>): Character {
  // If already flat format, just sanitize
  if (typeof raw.role === 'string' && typeof raw.gender === 'string') {
    return {
      id: String(raw.id || ''),
      name: String(raw.name || ''),
      role: normalizeRole(String(raw.role || '其他')),
      gender: String(raw.gender || '未知'),
      age: String(raw.age || '未知'),
      occupation: String(raw.occupation || ''),
      background: String(raw.background || ''),
      appearance: String(raw.appearance || ''),
      personality: String(raw.personality || ''),
      abilities: String(raw.abilities || ''),
      weaknesses: String(raw.weaknesses || ''),
      relationships: String(raw.relationships || ''),
      relationshipTags: Array.isArray(raw.relationshipTags)
        ? (raw.relationshipTags.map(t => String(t)) as Character['relationshipTags'])
        : [],
      arc: String(raw.arc || ''),
      importance: typeof raw.importance === 'number' ? raw.importance : 50,
    }
  }

  // Nested format: extract from sub-objects
  const bi = (raw.basicInfo || {}) as Record<string, unknown>
  const app = (raw.appearance || {}) as Record<string, unknown>
  const pers = (raw.personality || {}) as Record<string, unknown>

  const appearanceParts = [
    app.height, app.build, app.hair,
    typeof app.face === 'string' ? app.face : '',
    app.chest ? '胸围' + app.chest : '',
    app.distinguishingFeatures,
    app.typicalOutfit ? '常穿' + app.typicalOutfit : '',
  ].filter(Boolean)

  const persParts = [
    pers.type ? '性格类型:' + pers.type : '',
    Array.isArray(pers.traits) ? '特征:' + (pers.traits as string[]).join('、') : '',
    Array.isArray(pers.likes) ? '喜好:' + (pers.likes as string[]).join('、') : '',
    Array.isArray(pers.dislikes) ? '讨厌:' + (pers.dislikes as string[]).join('、') : '',
    pers.quirks,
  ].filter(Boolean)

  // Build comprehensive background from status + notes
  const status = (raw.status || {}) as Record<string, unknown>
  const backgroundParts = [
    status.positionWhenFrozen ? '在时间静止发生时' + status.positionWhenFrozen : '',
    bi.grade ? bi.grade + '学生' : '',
    bi.dorm ? '住' + bi.dorm : '',
    raw.notes || '',
    bi.background || '',
  ].filter(p => p && String(p).trim())

  // Build relationships from relationshipWithMC + testingNotes
  const rel = (raw.relationshipWithMC || {}) as Record<string, unknown>
  const test = (raw.testingNotes || {}) as Record<string, unknown>
  const relParts = [
    '张明（男主）',
    test.testOrder,
    test.mcFeeling,
    test.specialMark !== '无' ? test.specialMark : '',
    rel.impressionOfMC,
  ].filter(p => p && String(p).trim())

  // Build arc from testingNotes + notes
  const arcParts = [test.testOrder, test.physiologicalResponse, raw.notes].filter(p => p && String(p).trim())

  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    role: '女配' as CharacterRole,
    gender: String(bi.gender || '女'),
    age: bi.age ? String(bi.age) + '岁' : '未知',
    occupation: [bi.grade, bi.major].filter(Boolean).join('') || String(bi.occupation || '未知'),
    background: String(backgroundParts.length > 0 ? backgroundParts.join('，') : (raw.notes || bi.background || '')),
    appearance: appearanceParts.join('。') || String(app.description || app.face || ''),
    personality: persParts.join('。') || String(pers.description || pers.type || ''),
    abilities: String((raw as Record<string,unknown>).abilities || '无（普通大学女生，在静止世界中处于人偶状态）'),
    weaknesses: String((raw as Record<string,unknown>).weaknesses || '完全无意识，无法自主行动或防御'),
    relationships: relParts.length > 1 ? relParts.join(' → ') : String((raw as Record<string,unknown>).relationships || ''),
    relationshipTags: ['同伴'],
    arc: arcParts.length > 0 ? arcParts.join('；') : String(raw.notes || ''),
    importance: 20,
  }
}
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
]

import { yamlStringify, tryParseJsonOrYaml } from '@/utils/yamlUtils'
import { stripExtension, isStructuredDataFile, readAndMigrate } from '@/utils/filePaths'

function charPath(projectPath: string, id: string) {
  return `${projectPath}/characters/${id}.yaml`
}

export async function saveCharacter(projectPath: string, character: Character) {
  try {
    const yaml = yamlStringify(character)
    await fileService.write(charPath(projectPath, character.id), yaml)
  } catch (e) {
    logError(`保存角色失败: ${character.name}`, e)
    throw e
  }
}

export async function loadCharacters(projectPath: string): Promise<Character[]> {
  try {
    const files = await fileService.listDir(`${projectPath}/characters`)
    const chars: Character[] = []

    // Read .yaml files; auto-migrate old .json files
    const dataFiles = files.filter(f => isStructuredDataFile(f))
    const seenIds = new Set<string>()

    for (const file of dataFiles) {
      try {
        const baseName = stripExtension(file)
        if (seenIds.has(baseName)) continue

        const migrated = await readAndMigrate(
          p => fileService.read(p).catch(() => null),
          (p, c) => fileService.write(p, c),
          `${projectPath}/characters`,
          baseName,
        )
        if (!migrated) continue

        const parsed = tryParseJsonOrYaml(migrated.content)
        if (!parsed) throw new Error('解析失败')

        const char = normalizeCharacter(parsed.obj as Record<string, unknown>)
        char.role = normalizeRole(char.role as string)
        chars.push(char)
        seenIds.add(baseName)
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
