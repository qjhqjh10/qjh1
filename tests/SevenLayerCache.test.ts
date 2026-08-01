/**
 * 共享文件读缓存 + 缓存失效 真实实现测试 (M4 重写)
 *
 * 原测试自写 7 层缓存模拟（Map + 自造 LRU/失效逻辑），与真实实现零关联，无法防回归。
 * 重写后直接测真实模块：
 *   - src/utils/fileReadCache.ts（纯内存 LRU 缓存，GUI 与 AI 共享）
 *   - src/agent/context/CacheInvalidator.ts（工具执行后的失效逻辑）
 * FileCache.cachedRead 依赖 electron IPC（fileService），只测可独立运行的部分。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getFileCache, setFileCache, invalidateFileCache, invalidateDirCache,
  invalidateProjectFiles, clearAllFileCache, getFileCacheStats, getFileCacheDiagnostics,
} from '../src/utils/fileReadCache'
import { invalidateAfterTool } from '../src/agent/context/CacheInvalidator'

beforeEach(() => {
  clearAllFileCache() // 模块级单例，测试间必须清理
})

// ══════════════════════════════════════════════════════════
// fileReadCache — 真实 LRU 缓存
// ══════════════════════════════════════════════════════════

describe('fileReadCache（真实实现）', () => {
  it('set/get 命中返回内容', () => {
    setFileCache('/p/a.yaml', '内容A')
    expect(getFileCache('/p/a.yaml')).toBe('内容A')
  })

  it('normalizePath: 反斜杠/正斜杠/重复斜杠视为同一键', () => {
    setFileCache('p\\a.yaml', '内容A')
    expect(getFileCache('p/a.yaml')).toBe('内容A')
    expect(getFileCache('p//a.yaml')).toBe('内容A')
  })

  it('normalizePath: ../ 前缀剥离后同键', () => {
    setFileCache('../p/a.yaml', '内容A')
    expect(getFileCache('p/a.yaml')).toBe('内容A')
  })

  it('miss 返回 undefined 并计数', () => {
    expect(getFileCache('missing.yaml')).toBeUndefined()
    expect(getFileCacheDiagnostics().misses).toBeGreaterThan(0)
  })

  it('LRU: 超过 500 条时淘汰最早条目', () => {
    for (let i = 0; i < 500; i++) setFileCache(`/p/file${i}.yaml`, `内容${i}`)
    // 第 500 条之后再次写入 → 最早的 file0 被淘汰
    setFileCache('/p/file500.yaml', '内容500')
    expect(getFileCache('/p/file0.yaml')).toBeUndefined()
    expect(getFileCache('/p/file499.yaml')).toBe('内容499')
    expect(getFileCacheStats().entries).toBe(500)
  })

  it('命中提升 MRU（不被最早淘汰）', () => {
    for (let i = 0; i < 500; i++) setFileCache(`/p/file${i}.yaml`, `内容${i}`)
    // 命中 file0 → 提升 MRU
    expect(getFileCache('/p/file0.yaml')).toBe('内容0')
    setFileCache('/p/file500.yaml', '内容500')
    // file1（未命中过的最早条目）被淘汰，file0 保留
    expect(getFileCache('/p/file1.yaml')).toBeUndefined()
    expect(getFileCache('/p/file0.yaml')).toBe('内容0')
  })

  it('invalidateFileCache 删除单文件', () => {
    setFileCache('/p/a.yaml', '内容A')
    invalidateFileCache('/p/a.yaml')
    expect(getFileCache('/p/a.yaml')).toBeUndefined()
  })

  it('invalidateDirCache 边界安全（只删前缀目录内，不误伤兄弟目录）', () => {
    setFileCache('/p/outline/plot.md', '大纲')
    setFileCache('/p/outline/meta.yaml', '元数据')
    setFileCache('/p/outline_ext/x.yaml', '兄弟目录')
    setFileCache('/p/other/x.yaml', '无关')
    invalidateDirCache('/p/outline')
    expect(getFileCache('/p/outline/plot.md')).toBeUndefined()
    expect(getFileCache('/p/outline/meta.yaml')).toBeUndefined()
    expect(getFileCache('/p/outline_ext/x.yaml')).toBe('兄弟目录') // 前缀陷阱
    expect(getFileCache('/p/other/x.yaml')).toBe('无关')
  })

  it('invalidateDirCache 目录本身被缓存时也删除', () => {
    setFileCache('/p/outline', '目录内容')
    invalidateDirCache('/p/outline')
    expect(getFileCache('/p/outline')).toBeUndefined()
  })

  it('invalidateProjectFiles 只删指定 projectId 的条目', () => {
    setFileCache('/p/a.yaml', 'A', 'proj1')
    setFileCache('/p/b.yaml', 'B', 'proj2')
    setFileCache('/p/c.yaml', 'C', null) // 全局
    invalidateProjectFiles('proj1')
    expect(getFileCache('/p/a.yaml')).toBeUndefined()
    expect(getFileCache('/p/b.yaml')).toBe('B')
    expect(getFileCache('/p/c.yaml')).toBe('C')
  })

  it('stats/diagnostics 计数正确', () => {
    setFileCache('/p/a.yaml', '内容A')
    getFileCache('/p/a.yaml') // hit
    getFileCache('/p/miss.yaml') // miss
    const diag = getFileCacheDiagnostics()
    expect(diag.hits).toBeGreaterThanOrEqual(1)
    expect(diag.misses).toBeGreaterThanOrEqual(1)
    expect(diag.hitRate).toBeGreaterThan(0)
    expect(diag.hitRate).toBeLessThan(1)
    expect(getFileCacheStats().entries).toBeGreaterThanOrEqual(1)
  })
})

// ══════════════════════════════════════════════════════════
// CacheInvalidator — 工具执行后的失效逻辑
// ══════════════════════════════════════════════════════════

describe('CacheInvalidator.invalidateAfterTool（真实实现）', () => {
  const callbacks = (onChanged: (fp: string) => void) => ({ onFileChanged: onChanged })

  it('edit_file/batch_replace 只失效单文件', async () => {
    setFileCache('/p/chapters/ch1.md', '旧内容')
    const changed: string[] = []
    await invalidateAfterTool('edit_file', { file_path: '/p/chapters/ch1.md' }, callbacks(fp => changed.push(fp)))
    expect(getFileCache('/p/chapters/ch1.md')).toBeUndefined()
    expect(changed).toEqual(['/p/chapters/ch1.md'])
  })

  it('delete_file 失效文件 + 所在目录', async () => {
    setFileCache('/p/chapters/ch1.md', '旧内容')
    setFileCache('/p/chapters/ch2.md', '其他内容')
    await invalidateAfterTool('delete_file', { file_path: '/p/chapters/ch1.md' }, callbacks(() => {}))
    expect(getFileCache('/p/chapters/ch1.md')).toBeUndefined()
    expect(getFileCache('/p/chapters/ch2.md')).toBeUndefined() // 目录失效
  })

  it('rename_file 新旧路径都失效', async () => {
    setFileCache('/p/a.md', 'A')
    setFileCache('/p/b.md', 'B')
    await invalidateAfterTool('rename_file', { file_path: '/p/a.md', new_path: '/p/b.md' }, callbacks(() => {}))
    expect(getFileCache('/p/a.md')).toBeUndefined()
    expect(getFileCache('/p/b.md')).toBeUndefined()
  })

  it('create_file 触发 onFileChanged 通知', async () => {
    const changed: string[] = []
    await invalidateAfterTool('create_file', { file_path: '/p/new.md' }, callbacks(fp => changed.push(fp)))
    expect(changed).toEqual(['/p/new.md'])
  })

  it('知识库追加不报错且不误失效项目缓存', async () => {
    setFileCache('/p/chapters/ch1.md', '内容')
    const changed: string[] = []
    await invalidateAfterTool('kb_append_file', { file_path: 'kb/files/x.md' }, callbacks(fp => changed.push(fp)))
    expect(changed).toEqual(['kb/files/x.md'])
    expect(getFileCache('/p/chapters/ch1.md')).toBe('内容')
  })
})
