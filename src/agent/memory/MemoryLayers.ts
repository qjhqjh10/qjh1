// ── Memory Layers ──
// 4-layer memory system: CLAUDE.md → Auto-Memory → Session Context → Sub-agent Memory
// Key principle: "Memory is indexing, not storage" — don't store what can be reconstructed

export interface MemoryLayer {
  name: string
  priority: number       // higher = injected earlier
  lifetime: 'permanent' | 'session' | 'subagent'
  content: string
}

export class MemoryLayers {
  private layers: MemoryLayer[] = []

  addLayer(layer: MemoryLayer): void {
    // Replace existing layer of same name
    const idx = this.layers.findIndex(l => l.name === layer.name)
    if (idx !== -1) this.layers[idx] = layer
    else this.layers.push(layer)
  }

  getForContext(maxTokens: number): MemoryLayer[] {
    const sorted = [...this.layers].sort((a, b) => b.priority - a.priority)
    let used = 0
    const selected: MemoryLayer[] = []
    for (const layer of sorted) {
      const est = Math.ceil(layer.content.length / 3)
      if (used + est <= maxTokens) {
        selected.push(layer)
        used += est
      }
    }
    return selected
  }

  getSystemPrompt(maxTokens: number): string {
    const layers = this.getForContext(maxTokens)
    return layers.map(l => `[${l.name}]\n${l.content}`).join('\n\n')
  }

  clearSessionLayers(): void {
    this.layers = this.layers.filter(l => l.lifetime === 'permanent')
  }

  clearSubagentLayers(): void {
    this.layers = this.layers.filter(l => l.lifetime !== 'subagent')
  }

  getAll(): readonly MemoryLayer[] {
    return this.layers
  }
}
