import { describe, it, expect } from 'vitest'
import { validateFileContent } from '../schemaValidation'

// validateFileContent(filePath: string, content: string) — content must be a JSON string

describe('validateFileContent — characters', () => {
  const validChar = {
    id: 'linghu', name: '令狐冲', role: '男主', gender: '男', age: '28',
    occupation: '华山派弟子', background: '自幼被岳不群收养', appearance: '英俊潇洒',
    personality: '豪迈不羁', abilities: '独孤九剑', weaknesses: '太重感情',
    relationships: '任盈盈(恋人)、岳灵珊(师妹)',
    arc: '从浪子到侠之大者', importance: 95,
  }

  it('accepts a valid character JSON string', () => {
    const result = validateFileContent('characters/linghu.json', JSON.stringify(validChar))
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects a character with missing required fields', () => {
    const result = validateFileContent('characters/bad.json', JSON.stringify({ id: 'bad', name: 'Bad' }))
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects a character with nested objects (AI common mistake)', () => {
    const nested = { ...validChar, basicInfo: { name: 'test' } }
    const result = validateFileContent('characters/nested.json', JSON.stringify(nested))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'basicInfo')).toBe(true)
  })

  it('rejects invalid role value', () => {
    const invalid = { ...validChar, role: '战士' }
    const result = validateFileContent('characters/invalidRole.json', JSON.stringify(invalid))
    expect(result.valid).toBe(false)
  })

  it('rejects malformed JSON string', () => {
    const result = validateFileContent('characters/x.json', '{not valid json')
    expect(result.valid).toBe(false)
  })

  it('accepts valid role values (男主/女主/男配/女配/反派/其他)', () => {
    for (const role of ['男主', '女主', '男配', '女配', '反派', '其他']) {
      const ch = { ...validChar, id: `test_${role}`, role }
      const result = validateFileContent('characters/test.json', JSON.stringify(ch))
      expect(result.valid).toBe(true)
    }
  })

  it('rejects array root', () => {
    const result = validateFileContent('characters/x.json', JSON.stringify([1, 2, 3]))
    expect(result.valid).toBe(false)
  })

  it('handles empty string', () => {
    const result = validateFileContent('characters/test.json', '')
    expect(result.valid).toBe(false)
  })

  it('handles null gracefully', () => {
    // JSON.stringify(null) = "null", which after JSON.parse gives null
    // null is not an object, so it is rejected
    const result = validateFileContent('characters/test.json', 'null')
    expect(result.valid).toBe(false)
  })

  it('handles very long field values', () => {
    const longChar = {
      id: 'long', name: 'x'.repeat(100), role: '男主', gender: '男', age: '30',
      occupation: 'a', background: 'a', appearance: 'a', personality: 'a',
      abilities: 'a', weaknesses: 'a', relationships: 'a', relationshipTags: [],
      arc: 'a', importance: 50,
    }
    const result = validateFileContent('characters/long.json', JSON.stringify(longChar))
    expect(result.valid).toBe(true)
  })
})

// ── Detailed Outline Schema Validation ──

describe('validateFileContent — detailed_outline', () => {
  const validOutline = {
    id: 'ch1', title: '第一章', order: 0, status: 'incomplete',
    plotOverview: '主角登场', characters: '主角', location: '华山',
    keyEvents: ['主角被逐出师门'], emotionalTone: '悲壮',
  }

  it('accepts a valid detailed outline', () => {
    const result = validateFileContent('detailed_outline/ch1.json', JSON.stringify(validOutline))
    expect(result.valid).toBe(true)
  })

  it('rejects missing required fields', () => {
    const result = validateFileContent('detailed_outline/ch1.json', JSON.stringify({ title: 'only title' }))
    expect(result.valid).toBe(false)
  })

  it('rejects order as non-number', () => {
    const invalid = { ...validOutline, order: 'not a number' }
    const result = validateFileContent('detailed_outline/ch1.json', JSON.stringify(invalid))
    expect(result.valid).toBe(false)
  })

  it('rejects invalid status', () => {
    const invalid = { ...validOutline, status: 'invalid_status' }
    const result = validateFileContent('detailed_outline/ch1.json', JSON.stringify(invalid))
    expect(result.valid).toBe(false)
  })
})

// ── Project JSON Validation ──

describe('validateFileContent — project.json', () => {
  it('accepts a valid project.json', () => {
    const result = validateFileContent('project.json', JSON.stringify({ type: 'writing', novelCategory: '玄幻小说' }))
    expect(result.valid).toBe(true)
  })

  it('accepts any project.json (no schema validator — handled by create_project)', () => {
    // project.json is created by the create_project handler, not validated here
    const result = validateFileContent('project.json', JSON.stringify({ type: 'unknown_type', novelCategory: 'test' }))
    // No specific project.json validator exists — falls through to default accept
    expect(result.valid).toBe(true)
  })
})

// ── Non-JSON paths ──
// validateFileContent is called ONLY for .json files in production.
// Non-JSON strings cannot be parsed as JSON so they will be rejected.

describe('validateFileContent — non-JSON content', () => {
  it('rejects plain text since it is not valid JSON', () => {
    const result = validateFileContent('notes/some_note.md', 'any string content')
    expect(result.valid).toBe(false)
  })

  it('rejects markdown as invalid JSON', () => {
    const result = validateFileContent('chapters/ch1.txt', '# Title\n\nSome text')
    expect(result.valid).toBe(false)
  })
})

// ── Edge Cases ──

describe('validateFileContent — edge cases', () => {
  it('handles string "just a string" as invalid JSON', () => {
    const result = validateFileContent('characters/x.json', '"just a string"')
    // After JSON.parse this becomes "just a string" (a string primitive, not object)
    expect(result.valid).toBe(false)
  })

  it('handles valid JSON that is not a recognisable schema path', () => {
    // A valid JSON object but from an unknown path — no schema to validate against → valid
    const result = validateFileContent('some/unknown/file.json', JSON.stringify({ key: 'value' }))
    // No recognized schema for this path → no errors → valid
    expect(result.valid).toBe(true)
  })

  it('handles empty object', () => {
    const result = validateFileContent('characters/test.json', '{}')
    expect(result.valid).toBe(false) // missing all required fields
  })
})
