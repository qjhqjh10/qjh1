// v16.4.1: 大纲部分化布局迁移测试——移动语义（复制成功删旧）、空模板也建目录、幂等
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 内存文件系统 mock（vi.hoisted：mock 工厂在 import 前提升执行，不能引用外部变量）
const mockFs = vi.hoisted(() => {
  const fs = new Map<string, string>()
  return {
    fs,
    fileService: {
      listDir: async (dir: string) => {
        const prefix = dir.endsWith('/') ? dir : dir + '/'
        const out: string[] = []
        for (const key of fs.keys()) {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            out.push(key.slice(prefix.length))
          }
        }
        if (out.length === 0 && ![...fs.keys()].some(k => k.startsWith(prefix))) {
          throw new Error('ENOENT')
        }
        return out
      },
      read: async (p: string) => {
        const v = fs.get(p)
        if (v === undefined) throw new Error('ENOENT')
        return v
      },
      write: async (p: string, c: string) => { fs.set(p, c) },
      deleteFile: async (p: string) => { fs.delete(p) },
      deleteDir: async (p: string) => {
        const prefix = p.endsWith('/') ? p : p + '/'
        for (const key of [...fs.keys()]) {
          if (key.startsWith(prefix)) fs.delete(key)
        }
      },
      ensureDir: async (p: string) => {
        if (!fs.has(p)) fs.set(p, 'dir:')
      },
    },
  }
})

vi.mock('@/services/fileService', () => ({ fileService: mockFs.fileService }))

import { migrateOutlineLayout, migrateCharactersDir } from '@/services/outlineMigration'

const P = '/proj/1'
const fs = mockFs.fs

function seed(path: string, content: string) {
  const parts = path.split('/').slice(0, -1)
  let cur = ''
  for (const part of parts) {
    cur += (cur ? '/' : '') + part
    if (!fs.has(cur)) fs.set(cur, 'dir:')
  }
  fs.set(path, content)
}

beforeEach(() => {
  fs.clear()
})

describe('outlineMigration (v16.4.1)', () => {
  it('空模板列表也创建实体目录（修复：仅非空才建目录导致 items/locations/factions 缺失）', async () => {
    seed(`${P}/outline/items.yaml`, 'items:\n  # - name: 示例\n')
    seed(`${P}/outline/locations.yaml`, 'locations: []')
    seed(`${P}/outline/factions.yaml`, 'factions: []')
    seed(`${P}/outline/power_system.yaml`, "name: ''\nlevels: []\ndescription: ''")
    seed(`${P}/outline/emotion.yaml`, 'segments: []')
    seed(`${P}/outline/outline_meta.yaml`, 'foreshadowing: []\nplotThreads: []\nupdatedAt: ""')
    seed(`${P}/outline/plot.md`, '')
    seed(`${P}/outline/worldbuilding.md`, '')

    await migrateOutlineLayout(P)

    for (const dir of ['items', 'locations', 'factions', 'power_systems', 'emotions', 'foreshadows', 'threads', 'story', 'worldbuilding']) {
      expect(fs.has(`${P}/outline/${dir}`) || [...fs.keys()].some(k => k.startsWith(`${P}/outline/${dir}/`))).toBe(true)
    }
    // 旧文件已删除
    expect(fs.has(`${P}/outline/items.yaml`)).toBe(false)
    expect(fs.has(`${P}/outline/plot.md`)).toBe(false)
    expect(fs.has(`${P}/outline/outline_meta.yaml`)).toBe(false)
  })

  it('实际数据拆分：items 列表 → 每道具一个文件（移动语义）', async () => {
    seed(`${P}/outline/items.yaml`, JSON.stringify({ items: [{ id: 'i1', name: '龙泉剑', type: '武器' }, { id: 'i2', name: '聚气丹', type: '丹药' }] }))
    await migrateOutlineLayout(P)
    expect(fs.get(`${P}/outline/items/龙泉剑.yaml`)).toContain('龙泉剑')
    expect(fs.get(`${P}/outline/items/聚气丹.yaml`)).toContain('聚气丹')
    expect(fs.has(`${P}/outline/items.yaml`)).toBe(false)
  })

  it('伏笔/故事线从 outline_meta 拆出并删除旧文件', async () => {
    seed(`${P}/outline/outline_meta.yaml`, JSON.stringify({
      foreshadowing: [{ id: 'f1', description: '主角母亲的遗物', status: 'planted' }],
      plotThreads: [{ id: 't1', name: '复仇线', type: 'main' }],
    }))
    await migrateOutlineLayout(P)
    expect([...fs.keys()].some(k => k.includes('/foreshadows/') && fs.get(k)?.includes('母亲的遗物'))).toBe(true)
    expect([...fs.keys()].some(k => k.includes('/threads/') && fs.get(k)?.includes('复仇线'))).toBe(true)
    expect(fs.has(`${P}/outline/outline_meta.yaml`)).toBe(false)
  })

  it('顶层 characters/ 迁移后清理', async () => {
    seed(`${P}/characters/张三.yaml`, 'name: 张三\nrole: 男主')
    await migrateCharactersDir(P)
    expect(fs.get(`${P}/outline/characters/张三.yaml`)).toContain('张三')
    expect(fs.has(`${P}/characters/张三.yaml`)).toBe(false)
    expect(fs.has(`${P}/characters`)).toBe(false)
  })

  it('幂等：目录已有内容时跳过（不重复拆分）', async () => {
    seed(`${P}/outline/items.yaml`, JSON.stringify({ items: [{ id: 'i1', name: '龙泉剑' }] }))
    seed(`${P}/outline/items/龙泉剑.yaml`, 'name: 龙泉剑')
    await migrateOutlineLayout(P)
    await migrateOutlineLayout(P)
    // 只拆了一次（旧文件在第一次迁移后被删除）
    expect(fs.has(`${P}/outline/items.yaml`)).toBe(false)
    expect(fs.get(`${P}/outline/items/龙泉剑.yaml`)).toBe('name: 龙泉剑')
  })
})
