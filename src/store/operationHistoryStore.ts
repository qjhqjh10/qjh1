import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'

export interface OpHistoryEntry {
  id: string
  timestamp: string
  conversationId: string
  toolName: string
  filePath: string
  args: Record<string, unknown>
  status: 'success' | 'error' | 'confirmed' | 'denied' | 'undone'
  summary: string
  detail?: string
  backupPath?: string
}

export interface OpHistoryState {
  entries: OpHistoryEntry[]
  addEntry: (entry: OpHistoryEntry) => void
  clearEntries: () => void
  removeEntry: (id: string) => void
  updateEntry: (id: string, updates: Partial<OpHistoryEntry>) => void
}

export const useOpHistoryStore = create<OpHistoryState>()(
  persist(
    immer((set) => ({
      entries: [],
      addEntry: (entry) => set(s => { s.entries.unshift(entry) }),
      clearEntries: () => set({ entries: [] }),
      removeEntry: (id) => set(s => {
        s.entries = s.entries.filter(e => e.id !== id)
      }),
      updateEntry: (id, updates) => set(s => {
        const idx = s.entries.findIndex(e => e.id === id)
        if (idx !== -1) Object.assign(s.entries[idx], updates)
      }),
    })),
    { name: 'novel-writer-op-history', version: 1 },
  ),
)
