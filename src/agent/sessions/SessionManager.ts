// ── Session Types ──

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  tags: string[]
  messageCount: number
  totalTokens: number
  projectId: string | null
}

export interface SessionMessage {
  role: string
  content: string
  timestamp: number
  tool_calls?: unknown[]
  tool_call_id?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }
}

export interface SessionData {
  meta: AgentSessionMeta
  messages: SessionMessage[]
}

export interface SessionFilter {
  projectId?: string
  tag?: string
  searchQuery?: string
}

// ── Manager ──

export class SessionManager {
  private basePath: string
  private cache = new Map<string, SessionData>()

  constructor(basePath: string) {
    this.basePath = basePath
  }

  private sessionPath(id: string): string {
    return `${this.basePath}/${id}.json`
  }

  // ── CRUD ──

  async create(title: string, projectId: string | null = null): Promise<AgentSessionMeta> {
    const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    const meta: AgentSessionMeta = {
      id, title, createdAt: now, updatedAt: now,
      tags: [], messageCount: 0, totalTokens: 0, projectId,
    }
    const data: SessionData = { meta, messages: [] }
    this.cache.set(id, data)
    await this.persist(id, data)
    return meta
  }

  async load(id: string): Promise<SessionData | null> {
    if (this.cache.has(id)) return this.cache.get(id)!

    try {
      const { fileService } = await import('@/services/fileService')
      const raw = await fileService.read(this.sessionPath(id))
      const data = JSON.parse(raw) as SessionData
      this.cache.set(id, data)
      return data
    } catch {
      return null
    }
  }

  async save(id: string, messages: SessionMessage[], tokensUsed: number): Promise<void> {
    const existing = await this.load(id)
    if (!existing) throw new Error(`Session not found: ${id}`)

    existing.messages = messages
    existing.meta.messageCount = messages.length
    existing.meta.totalTokens = (existing.meta.totalTokens || 0) + tokensUsed
    existing.meta.updatedAt = new Date().toISOString()

    this.cache.set(id, existing)
    await this.persist(id, existing)
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id)
    try {
      const { fileService } = await import('@/services/fileService')
      await fileService.deleteFile(this.sessionPath(id))
    } catch { /* already deleted */ }
  }

  async list(filter?: SessionFilter): Promise<AgentSessionMeta[]> {
    const ids = await this.scanIds()
    const results: AgentSessionMeta[] = []

    for (const id of ids) {
      const data = await this.load(id)
      if (!data) continue
      let match = true
      if (filter?.projectId && data.meta.projectId !== filter.projectId) match = false
      if (filter?.tag && !data.meta.tags.includes(filter.tag)) match = false
      if (filter?.searchQuery) {
        const q = filter.searchQuery.toLowerCase()
        if (!data.meta.title.toLowerCase().includes(q)
          && !data.meta.tags.some(t => t.toLowerCase().includes(q))) {
          match = false
        }
      }
      if (match) results.push(data.meta)
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async search(query: string): Promise<AgentSessionMeta[]> {
    return this.list({ searchQuery: query })
  }

  async addTag(id: string, tag: string): Promise<void> {
    const data = await this.load(id)
    if (!data || data.meta.tags.includes(tag)) return
    data.meta.tags.push(tag)
    this.cache.set(id, data)
    await this.persist(id, data)
  }

  // ── Export / Import ──

  async export(id: string, format: 'json' | 'markdown' = 'json'): Promise<string> {
    const data = await this.load(id)
    if (!data) throw new Error(`Session not found: ${id}`)

    if (format === 'markdown') {
      const lines = [`# ${data.meta.title}`, '', `日期: ${data.meta.createdAt}`, `消息数: ${data.meta.messageCount}`, '']
      for (const m of data.messages) {
        const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role
        lines.push(`### ${role}`, '', m.content.slice(0, 2000), '')
      }
      return lines.join('\n')
    }
    return JSON.stringify(data, null, 2)
  }

  async import(raw: string): Promise<AgentSessionMeta> {
    const data = JSON.parse(raw) as SessionData
    if (!data.meta?.id) data.meta = { ...data.meta, id: `s_import_${Date.now().toString(36)}` }
    this.cache.set(data.meta.id, data)
    await this.persist(data.meta.id, data)
    return data.meta
  }

  // ── Internal ──

  private async persist(id: string, data: SessionData): Promise<void> {
    const { fileService } = await import('@/services/fileService')
    const dir = this.basePath
    // Ensure directory exists (ensureDir creates recursively, listDir does not)
    try { await fileService.ensureDir(dir) } catch { return /* base path not writable, skip persist */ }
    await fileService.write(this.sessionPath(id), JSON.stringify(data, null, 2))
  }

  private async scanIds(): Promise<string[]> {
    try {
      const { fileService } = await import('@/services/fileService')
      const files = await fileService.listDir(this.basePath)
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
    } catch {
      return []
    }
  }
}
