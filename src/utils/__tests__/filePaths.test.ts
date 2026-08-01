// M1: 路径集中管理 — 路径构造函数与 TAB_FILE_MAP 验证
import { describe, it, expect } from 'vitest'
import { characterPath, detailedOutlinePath, outlineTabPath, sceneConfigPath } from '../filePaths'

describe('filePaths (M1)', () => {
  it('characterPath 输出角色 YAML 路径', () => {
    expect(characterPath('proj1', '张三')).toBe('proj1/characters/张三.yaml')
  })

  it('detailedOutlinePath 输出细纲 YAML 路径', () => {
    expect(detailedOutlinePath('proj1', 'ch3')).toBe('proj1/detailed_outline/ch3.yaml')
  })

  it('sceneConfigPath 输出场景 YAML 路径', () => {
    expect(sceneConfigPath('proj1', 'ch1')).toBe('proj1/scenes/ch1.yaml')
  })

  it('outlineTabPath: basic/worldbuilding 为 .md（与 OutlinePage 实际文件名一致）', () => {
    expect(outlineTabPath('proj1', 'basic')).toBe('proj1/outline/plot.md')
    expect(outlineTabPath('proj1', 'worldbuilding')).toBe('proj1/outline/worldbuilding.md')
  })

  it('outlineTabPath: 其余 tab 为 snake_case .yaml（powerSystem → power_system）', () => {
    expect(outlineTabPath('proj1', 'powerSystem')).toBe('proj1/outline/power_system.yaml')
    expect(outlineTabPath('proj1', 'items')).toBe('proj1/outline/items.yaml')
    expect(outlineTabPath('proj1', 'locations')).toBe('proj1/outline/locations.yaml')
    expect(outlineTabPath('proj1', 'factions')).toBe('proj1/outline/factions.yaml')
    expect(outlineTabPath('proj1', 'emotion')).toBe('proj1/outline/emotion.yaml')
  })

  it('outlineTabPath: 未映射 tab 回退默认 .yaml', () => {
    expect(outlineTabPath('proj1', 'unknownTab')).toBe('proj1/outline/unknownTab.yaml')
  })
})
