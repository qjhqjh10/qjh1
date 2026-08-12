// v16.4.1(用户决策): 屏蔽 = 不注入——sections.json 中 hidden 部分对应的维度键应被排除
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockFs = vi.hoisted(() => {
  const fs = new Map<string, string>()
  return {
    fs,
    fileService: {
      listDir: async (dir: string) => {
        const prefix = dir.endsWith('/') ? dir : dir + '/'
        const out: string[] = []
        for (const key of fs.keys()) {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) out.push(key.slice(prefix.length))
        }
        if (out.length === 0 && ![...fs.keys()].some(k => k.startsWith(prefix))) throw new Error('ENOENT')
        return out
      },
      read: async (p: string) => {
        const v = fs.get(p)
        if (v === undefined) throw new Error('ENOENT')
        return v
      },
      write: async (p: string, c: string) => { fs.set(p, c) },
      deleteFile: async (p: string) => { fs.delete(p) },
      deleteDir: async () => {},
      ensureDir: async () => {},
    },
  }
})

vi.mock('@/services/fileService', () => ({ fileService: mockFs.fileService }))

import { hiddenOutlineDims } from '@/utils/outlineData'

const P = '/proj/1'
const fs = mockFs.fs

function seedSections(hiddenKeys: string[]) {
  const sections = [
    { key: 'story', name: '故事剧情', type: 'doc', fixed: true },
    { key: 'worldbuilding', name: '世界观', type: 'doc', fixed: true },
    { key: 'characters', name: '角色', type: 'entities', fixed: true },
    { key: 'items', name: '道具', type: 'entities' },
    { key: 'locations', name: '地点', type: 'entities' },
    { key: 'factions', name: '势力', type: 'entities' },
    { key: 'power_systems', name: '等级', type: 'entities' },
    { key: 'foreshadows', name: '伏笔', type: 'entities' },
    { key: 'emotions', name: '情绪', type: 'entities' },
    { key: 'threads', name: '故事线', type: 'entities' },
  ]
  fs.set(`${P}/outline/sections.json`, JSON.stringify({ sections: sections.map(s => hiddenKeys.includes(s.key) ? { ...s, hidden: true } : s) }))
}

beforeEach(() => { fs.clear() })

describe('hiddenOutlineDims (v16.4.1)', () => {
  it('无屏蔽 → 不排除任何维度', async () => {
    seedSections([])
    const hidden = await hiddenOutlineDims(P)
    expect(hidden.size).toBe(0)
  })

  it('屏蔽 items/locations/foreshadows → 对应维度键被排除', async () => {
    seedSections(['items', 'locations', 'foreshadows'])
    const hidden = await hiddenOutlineDims(P)
    expect(hidden.has('items')).toBe(true)
    expect(hidden.has('locations')).toBe(true)
    expect(hidden.has('foreshadowing')).toBe(true)
    expect(hidden.has('factions')).toBe(false)
    expect(hidden.has('powerSystem')).toBe(false)
    expect(hidden.has('emotion')).toBe(false)
    expect(hidden.has('plotThreads')).toBe(false)
  })

  it('屏蔽全部实体部分 → 全部维度排除', async () => {
    seedSections(['items', 'locations', 'factions', 'power_systems', 'foreshadows', 'emotions', 'threads'])
    const hidden = await hiddenOutlineDims(P)
    expect(hidden.size).toBe(7)
  })
})
