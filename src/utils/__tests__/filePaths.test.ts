// M1: 路径集中管理 — 路径构造函数与 TAB_FILE_MAP 验证
// v16.4.1: 大纲部分化布局——角色迁移至 outline/characters/；doc 部分文件夹化
import { describe, it, expect } from 'vitest'
import { characterPath, detailedOutlinePath, outlineTabPath, sceneConfigPath, outlineSectionDir, outlineEntityPath, sectionsConfigPath } from '../filePaths'

describe('filePaths (M1)', () => {
  it('characterPath 输出角色 YAML 路径（v16.4.1: outline/characters/）', () => {
    expect(characterPath('proj1', '张三')).toBe('proj1/outline/characters/张三.yaml')
  })

  it('detailedOutlinePath 输出细纲 YAML 路径', () => {
    expect(detailedOutlinePath('proj1', 'ch3')).toBe('proj1/detailed_outline/ch3.yaml')
  })

  it('sceneConfigPath 输出场景 YAML 路径', () => {
    expect(sceneConfigPath('proj1', 'ch1')).toBe('proj1/scenes/ch1.yaml')
  })

  it('outlineTabPath: doc 部分文件夹化（story/worldbuilding）+ 旧路径兼容', () => {
    expect(outlineTabPath('proj1', 'story')).toBe('proj1/outline/story/plot.md')
    expect(outlineTabPath('proj1', 'storyLegacy')).toBe('proj1/outline/plot.md')
    expect(outlineTabPath('proj1', 'worldbuilding')).toBe('proj1/outline/worldbuilding/worldbuilding.md')
    expect(outlineTabPath('proj1', 'worldbuildingLegacy')).toBe('proj1/outline/worldbuilding.md')
  })

  it('outlineTabPath: 未映射 tab 回退默认 .yaml（实体部分走目录不再经本表）', () => {
    expect(outlineTabPath('proj1', 'unknownTab')).toBe('proj1/outline/unknownTab.yaml')
  })

  it('v16.4.1: 实体部分目录/文件路径 + sections.json', () => {
    expect(outlineSectionDir('proj1', 'items')).toBe('proj1/outline/items')
    expect(outlineEntityPath('proj1', 'items', '龙泉剑')).toBe('proj1/outline/items/龙泉剑.yaml')
    expect(sectionsConfigPath('proj1')).toBe('proj1/outline/sections.json')
  })
})
