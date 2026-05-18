import { Graph } from '@antv/g6'
import type { RelationshipGraph } from '@/types/character'
import { logError } from '@/utils/logger'

const NODE_COLORS: Record<string, string> = {
  '男主': '#7c3aed',
  '女主': '#ec4899',
  '男配': '#3b82f6',
  '女配': '#f59e0b',
  '反派': '#ef4444',
  '其他': '#6b7280',
}

export function renderRelationshipGraph(
  container: HTMLElement,
  data: RelationshipGraph,
  onNodeClick?: (characterId: string) => void,
): { destroy: () => void } {
  // Clear container
  container.innerHTML = ''

  const nodes = data.nodes.map(n => ({
    id: n.id,
    style: {
      fill: NODE_COLORS[n.role] || NODE_COLORS['其他'],
      stroke: '#fff',
      lineWidth: 2,
      size: 36,
      labelText: n.name,
      labelFill: '#2d2520',
      labelFontSize: 13,
      labelFontWeight: 600,
      labelOffsetY: 8,
      labelPlacement: 'bottom' as const,
    },
    data: { name: n.name, role: n.role },
  } as any))

  const edges = data.edges.map((e) => ({
    id: `edge_${e.source}_${e.target}_${e.relation || ''}`,
    source: e.source,
    target: e.target,
    style: {
      stroke: '#d4ccc4',
      lineWidth: 1.5,
      endArrow: true,
      labelText: e.relation,
      labelFill: '#6b5e54',
      labelFontSize: 10,
      labelBackground: true,
      labelBackgroundFill: '#fff',
      labelBackgroundOpacity: 0.9,
      labelBackgroundRadius: 4,
      labelBackgroundPadding: [2, 4],
    },
    data: { relation: e.relation, description: e.description },
  }))

  const graph = new Graph({
    container,
    width: container.clientWidth,
    height: container.clientHeight,
    data: { nodes, edges },
    layout: {
      type: 'force',
      preventOverlap: true,
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    autoFit: 'view',
    node: {
      style: {
        cursor: 'pointer',
      },
    },
  })

  graph.render()

  // Node click → edit character
  if (onNodeClick) {
    graph.on('node:click', (evt: any) => {
      const nodeId = evt.item?.getID?.() || evt.target?.id
      if (nodeId) onNodeClick(nodeId as string)
    })
  }

  const destroy = () => {
    try { graph.destroy() } catch (e) { logError('图表销毁失败', e) }
  }

  return { destroy }
}
