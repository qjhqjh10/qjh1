import { useState } from 'react'
import type { Character, RelationshipGraph } from '@/types/character'
import { fileService, aiService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { logError } from '@/utils/logger'

interface UseRelationshipGraphProps {
  projectPath: string
  activeProjectId: string | null
  activeConfigId: string | null
}

export function useRelationshipGraph({ projectPath, activeProjectId, activeConfigId }: UseRelationshipGraphProps) {
  const [showGraph, setShowGraph] = useState(false)
  const [graphData, setGraphData] = useState<RelationshipGraph | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState('')

  const saveGraph = async (pp: string, data: RelationshipGraph) => {
    await fileService.write(`${pp}/relationship_graph.json`, JSON.stringify(data, null, 2))
  }

  const loadGraphData = async (pp: string): Promise<RelationshipGraph | null> => {
    try {
      const raw = await fileService.read(`${pp}/relationship_graph.json`)
      if (raw) {
        const data = JSON.parse(raw) as RelationshipGraph
        if (data.nodes && data.edges) return data
      }
    } catch { /* no saved graph yet */ }
    return null
  }

  const handleOpenGraph = async () => {
    if (!projectPath) return
    const existing = await loadGraphData(projectPath)
    if (existing) {
      setGraphData(existing)
      setGraphError('')
      setShowGraph(true)
    } else {
      handleAnalyzeRelationships(false)
    }
  }

  const handleAnalyzeRelationships = async (incremental = false, overrideChars?: Character[], overrideGraph?: RelationshipGraph | null) => {
    const genConfigId = activeConfigId
    if (!genConfigId || !activeConfigId) {
      setGraphError('请先在系统设置中配置AI模型')
      setShowGraph(true)
      return
    }
    const chars = overrideChars
    if (!chars || chars.length < 2) {
      setGraphError('至少需要2个角色才能分析关系。请先创建角色并填写"角色关系网"字段。')
      setShowGraph(true)
      return
    }

    setGraphLoading(true)
    setGraphError('')
    setShowGraph(true)

    try {
      const activeGraph = overrideGraph !== undefined ? overrideGraph : graphData
      const existingEdges = incremental && activeGraph ? activeGraph.edges : []
      const existingNodeIds = new Set(incremental && activeGraph ? activeGraph.nodes.map(n => n.id) : [])
      const charList = chars.map(c => ({
        id: c.id, name: c.name, role: c.role,
        relationships: c.relationships || '暂无',
      }))

      let prompt: string
      if (incremental && existingEdges.length > 0) {
        const newChars = charList.filter(c => !existingNodeIds.has(c.id))
        prompt = `你是小说角色关系分析专家。以下是已有角色关系图，现在新增了角色。

已有关系（请保留，不要修改或删除）：
${JSON.stringify(existingEdges, null, 2)}

新增角色列表：
${JSON.stringify(newChars, null, 2)}

已有全部角色（供参考姓名）：
${JSON.stringify(charList.map(c => ({ name: c.name, role: c.role })), null, 2)}

请仅分析新增角色与其他角色之间的新关系，输出 JSON（不要 markdown）：
{ "relationships": [
  { "source": "角色精确姓名", "target": "角色精确姓名", "relation": "关系类型", "description": "简述" }
] }

注意：只输出与新增角色相关的新关系，已有关系已在上面列出，不要重复。`
      } else {
        prompt = `你是小说角色关系分析专家。根据以下角色列表和各自的"角色关系网"描述，提取所有角色之间的两两关系。

角色列表：
${JSON.stringify(charList, null, 2)}

请分析每个角色的"角色关系网"描述，推断角色之间的所有关系，输出严格 JSON 格式（不要包含 markdown 标记）：

{
  "relationships": [
    { "source": "角色A的精确姓名", "target": "角色B的精确姓名", "relation": "关系类型(如师徒、父子、恋人、仇敌等)", "description": "关系简述，基于角色关系网描述" }
  ]
}

注意：
- source 和 target 必须使用角色列表中精确的姓名
- 如果角色关系网中提到了其他角色名字，务必提取该关系
- 如果两个角色在各自的关系网中互相提及，只输出一条关系
- 只输出有明确关系描述的角色对，不要臆测`
      }

      const messages = [{ role: 'user' as const, content: prompt }]
      const reply = await chatAI(messages, genConfigId, activeProjectId || undefined)

      let jsonStr = reply
      const jsonMatch = reply.match(/\{[\s\S]*"relationships"[\s\S]*\}/)
      if (jsonMatch) jsonStr = jsonMatch[0]

      const parsed = JSON.parse(jsonStr)
      const newEdges = (parsed.relationships || []).map((r: { source: string; target: string; relation: string; description: string }) => ({
        source: r.source, target: r.target, relation: r.relation, description: r.description,
      }))

      const nameToId = new Map(chars.map(c => [c.name, c.id]))

      const idNewEdges = newEdges
        .filter((e: { source: string; target: string }) => nameToId.has(e.source) && nameToId.has(e.target))
        .map((e: { source: string; target: string; relation: string; description: string }) => ({
          source: nameToId.get(e.source)!, target: nameToId.get(e.target)!,
          relation: e.relation, description: e.description,
        }))

      const allEdges = incremental ? [...existingEdges] : []
      const edgeKey = (s: string, t: string) => [s, t].sort().join('||')
      const seenPairs = new Set(allEdges.map(e => edgeKey(e.source, e.target)))
      for (const e of idNewEdges) {
        if (!seenPairs.has(edgeKey(e.source, e.target))) {
          allEdges.push(e); seenPairs.add(edgeKey(e.source, e.target))
        }
      }

      const referencedIds = new Set<string>()
      for (const e of allEdges) { referencedIds.add(e.source); referencedIds.add(e.target) }

      const graph: RelationshipGraph = {
        nodes: chars.filter(c => referencedIds.has(c.id)).map(c => ({ id: c.id, name: c.name, role: c.role })),
        edges: allEdges,
        generatedAt: new Date().toISOString(),
      }

      setGraphData(graph)
      if (projectPath) saveGraph(projectPath, graph)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '分析失败'
      logError('AI 分析角色关系失败', err)
      setGraphError(msg)
    }
    setGraphLoading(false)
  }

  return {
    showGraph, setShowGraph,
    graphData, setGraphData,
    graphLoading, graphError,
    handleOpenGraph,
    handleAnalyzeRelationships,
  }
}
