// ── 全自由模式路径解析单测 (v14.5.1) ──
// 覆盖审计发现: 中段 ..\ 混合分隔符、../ 前缀、全局目录、绝对路径、
// 系统目录黑名单、UNC、percent-encoding 解码、realpath 复核

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { resolveArg, isBlockedSystemPath, safeResolveArg, GLOBAL_DIR_NAMES } from '../pathResolution'

const PROJECT = path.resolve('D:/app/projects/test-project')
const APP_ROOT = path.dirname(PROJECT)  // D:/app/projects

describe('resolveArg — 相对路径', () => {
  it('项目内普通路径', () => {
    expect(resolveArg('outline/plot.md', PROJECT)).toBe(path.join(PROJECT, 'outline/plot.md'))
  })

  it('中段 ../ 与混合分隔符归一化（修复审计 #1 list_directory 越界路径——现在统一归一化）', () => {
    // 'sub/..\..\..\Users' → 归一化后逃出项目目录（全自由模式允许，非系统目录）
    const r = resolveArg('a/b/..\\..\\..\\Users', PROJECT)
    expect(r).toBe(path.resolve(PROJECT, 'a/b/../../../Users'))
    expect(r!.toLowerCase()).not.toContain('windows')
  })

  it('../ 前缀逐级上跳（../notes/x.md → appRoot/notes/x.md）', () => {
    expect(resolveArg('../notes/x.md', PROJECT)).toBe(path.join(APP_ROOT, 'notes/x.md'))
  })

  it('中段 .. 正确归一化（read_file 修复：outline/../notes/x.md → notes/x.md）', () => {
    expect(resolveArg('outline/../notes/x.md', PROJECT)).toBe(path.join(PROJECT, 'notes/x.md'))
  })

  it('全局资源目录按首段解析到 appRoot', () => {
    for (const g of GLOBAL_DIR_NAMES) {
      expect(resolveArg(`${g}/x.md`, PROJECT)).toBe(path.join(APP_ROOT, g, 'x.md'))
    }
  })
})

describe('resolveArg — 绝对路径（全自由）', () => {
  it('非系统绝对路径放行', () => {
    expect(resolveArg('C:/Users/test/data.txt', PROJECT)).toBe(path.normalize('C:/Users/test/data.txt'))
  })

  it('系统目录拦截（大小写不敏感）', () => {
    expect(resolveArg('C:/Windows/test.txt', PROJECT)).toBeNull()
    expect(resolveArg('c:/windows/system32/x.dll', PROJECT)).toBeNull()
    expect(resolveArg('C:/Program Files/x/app.exe', PROJECT)).toBeNull()
    expect(resolveArg('/etc/passwd', PROJECT)).toBeNull()
    expect(resolveArg('/usr/bin/x', PROJECT)).toBeNull()
    expect(resolveArg('/dev/null', PROJECT)).toBeNull()
  })

  it('相对路径向上逃逸不触发系统目录拦截（黑名单仅限 C: 系统盘；D:\\Windows 非系统目录，允许）', () => {
    expect(resolveArg('../../../../../../Windows/x.txt', PROJECT)).toBe(path.normalize('D:/Windows/x.txt'))
  })

  it('UNC 网络路径拦截', () => {
    expect(resolveArg('//server/share/x.txt', PROJECT)).toBeNull()
    expect(resolveArg('\\\\server\\share\\x.txt', PROJECT)).toBeNull()
  })

  it('percent-encoding 解码（%2e%2e%2f = ../、%2f = /）', () => {
    expect(resolveArg('..%2f..%2fx', PROJECT)).toBe(path.resolve(PROJECT, '../../x'))
    expect(resolveArg('%2e%2e%2f%2e%2e%2fx', PROJECT)).toBe(path.resolve(PROJECT, '../../x'))
  })
})

describe('safeResolveArg — realpath 复核', () => {
  it('不存在的文件返回归一化路径（不抛错）', async () => {
    expect(await safeResolveArg('outline/plot.md', PROJECT)).toBe(path.join(PROJECT, 'outline/plot.md'))
  })

  it('系统目录仍被拦截', async () => {
    expect(await safeResolveArg('C:/Windows/x.txt', PROJECT)).toBeNull()
  })
})

describe('isBlockedSystemPath', () => {
  it('黑名单判定', () => {
    expect(isBlockedSystemPath('c:\\windows\\x')).toBe(true)
    expect(isBlockedSystemPath('D:/Projects/novel.txt')).toBe(false)
    expect(isBlockedSystemPath('/etc/')).toBe(true)
  })
})
