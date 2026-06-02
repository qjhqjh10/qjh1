import type { ContextProvider } from '../ContextAssembler'
import { fileService } from '@/services/fileService'
import { cachedRead } from '../FileCache'
import { estimateTokensFromLines } from '../../utils/tokenEstimation'

// Static schema documentation (fallback when no project)
const SCHEMA_DOC = [
  '## 角色 JSON Schema',
  '角色文件存储在 characters/{拼音id}.json，每个角色一个文件，必须是 16 个平铺字段（禁止嵌套对象）：',
  '',
  '必填字段 (15个): id, name, role(男主|女主|男配|女配|反派|其他), gender, age, occupation, background, appearance, personality, abilities, weaknesses, relationships, relationshipTags(数组), arc, importance(0-100)',
  '可选字段: image',
  '',
  '创建角色前，先用 read_file 查看已有角色文件了解格式。不要使用嵌套对象。',
].join('\n')

export const characterProvider: ContextProvider = {
  domain: 'characters',
  relevance: (userMessage) => {
    if (/创建.*角色|添加.*人物|新建.*角色|写.*角色/.test(userMessage)) return 1.0
    if (/检查.*角色|角色.*矛盾|角色.*一致|人物.*矛盾|人物.*一致/.test(userMessage)) return 1.0
    if (/角色|人物|男主|女主|配角|反派|character/i.test(userMessage)) return 0.8
    // V4: chapter writing tasks need character context (who appears in this chapter)
    if (/写.*第.*章|创作.*第.*章|生成.*第.*章|续写|章节.*写/i.test(userMessage)) return 0.6
    return 0.2
  },

  buildContext: async (projectId, userMessage) => {
    if (!projectId) {
      return { domain: 'characters', priority: 80, estimatedTokens: 300, content: SCHEMA_DOC }
    }

    const msg = userMessage || ''
    const isConsistencyCheck = /检查.*角色|角色.*矛盾|角色.*一致|人物.*矛盾|人物.*一致/.test(msg)
    const isCreateCharacter = /创建.*角色|添加.*人物|新建.*角色|写.*角色/.test(msg)

    // Extract specific character names from user message
    const mentionedNames = extractMentionedNames(msg)

    try {
      const files = await fileService.listDir(`${projectId}/characters`)
      const jsonFiles = files.filter((f: string) => f.endsWith('.json'))
      if (jsonFiles.length === 0) {
        return { domain: 'characters', priority: 80, estimatedTokens: 200, content: '## 角色\n当前项目暂无角色文件。\n\n' + SCHEMA_DOC }
      }

      // Consistency check: inject key fields, batch by relevance
      if (isConsistencyCheck) {
        const lines: string[] = ['## 角色一致性检查 — 角色关键信息', '']
        const targetFiles = mentionedNames.length > 0
          ? filterByName(jsonFiles, mentionedNames)
          : jsonFiles.slice(0, 20)

        for (const f of targetFiles) {
          try {
            const content = await cachedRead(`${projectId}/characters/${f}`, projectId)
            const obj = JSON.parse(content)
            lines.push(`### ${obj.name || f} (${obj.role || '未知'})`)
            lines.push(`- 性别: ${obj.gender || '-'}  年龄: ${obj.age || '-'}  职业: ${obj.occupation || '-'}`)
            lines.push(`- 性格: ${(obj.personality || '-').slice(0, 100)}`)
            lines.push(`- 关系: ${(obj.relationships || '-').slice(0, 100)}`)
            lines.push(`- 弧光: ${(obj.arc || '-').slice(0, 80)}`)
            lines.push('')
          } catch { /* skip broken file */ }
        }
        if (mentionedNames.length > 0 && targetFiles.length < jsonFiles.length) {
          lines.push(`共 ${jsonFiles.length} 个角色，已读取与"${mentionedNames.join('、')}"相关的 ${targetFiles.length} 个。如需查看更多角色，请指定角色名。`)
        }
        return { domain: 'characters', priority: 80, estimatedTokens: Math.min(estimateTokensFromLines(lines), 4000), content: lines.join('\n') }
      }

      // Create character or general reference: inject summary
      const summaries: string[] = ['## 已有角色概览', '']
      const maxShow = mentionedNames.length > 0 ? 30 : 15
      for (const f of jsonFiles.slice(0, maxShow)) {
        try {
          const content = await cachedRead(`${projectId}/characters/${f}`, projectId)
          const obj = JSON.parse(content)
          const rel = obj.relationships && Array.isArray(obj.relationships)
            ? ` | 关系: ${obj.relationships.map((r: any) => r.name || r.character || String(r)).join(', ').slice(0, 50)}`
            : obj.relationships ? ` | 关系: ${String(obj.relationships).slice(0, 50)}` : ''
          summaries.push(`- ${obj.name || f} (${obj.role || '-'}): ${(obj.personality || '-').slice(0, 40)}${rel}`)
        } catch { summaries.push(`- ${f.replace('.json', '')}`) }
      }
      if (jsonFiles.length > maxShow) summaries.push(`... 共 ${jsonFiles.length} 个角色`)

      const extra = isCreateCharacter
        ? '\n\n创建新角色时，请确保 name 不与已有角色重复，relationships 字段要引用已有角色名。\n\n' + SCHEMA_DOC
        : '\n\n如需查看某个角色的完整设定，使用 read_file("characters/{id}.json")。'

      return { domain: 'characters', priority: 80, estimatedTokens: Math.min(estimateTokensFromLines(summaries), 2000), content: summaries.join('\n') + extra }
    } catch {
      return { domain: 'characters', priority: 80, estimatedTokens: 300, content: SCHEMA_DOC }
    }
  },
}

function extractMentionedNames(msg: string): string[] {
  const namePattern = /(?:角色|人物|关于|检查|看看|查看)?([^\s,，。、]{2,4})(?:的|是否|有没有|存在)/g
  const names: string[] = []
  let m
  while ((m = namePattern.exec(msg)) !== null) {
    const name = m[1].trim()
    if (name.length >= 2 && !/^(角色|人物|矛盾|一致|检查|创建|新建|添加|大纲|细纲|章节|风格)$/.test(name)) {
      names.push(name)
    }
  }
  return [...new Set(names)]
}

function filterByName(files: string[], names: string[]): string[] {
  return files.filter(f => {
    const base = f.replace('.json', '')
    return names.some(n => base.includes(n) || n.includes(base))
  })
}
