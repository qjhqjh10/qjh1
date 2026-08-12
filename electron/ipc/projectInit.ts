// ── 项目骨架初始化（v16.4.1 审查修复: 双通道统一）──
// projectHandlers 的 project:create（首页）与 fileToolHandlers 的 create_project（AI 工具）
// 原各自内联实现（产物不同）——抽公共函数，两边调用。
// v16.4.1: 部分化布局——doc 进子文件夹（story/worldbuilding），实体部分目录按注册表预建。

import * as fs from 'fs/promises'
import * as path from 'path'
import { BUILTIN_SECTIONS } from '../../src/data/builtinSections'

export interface ProjectSkeletonOptions {
  /** 故事剧情初始内容（默认空） */
  plotMd?: string
  /** 世界观初始内容（默认空） */
  wbMd?: string
}

export async function initProjectSkeleton(pp: string, opts: ProjectSkeletonOptions = {}): Promise<void> {
  for (const dir of ['outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']) {
    await fs.mkdir(path.join(pp, dir), { recursive: true })
  }
  // doc 部分子文件夹
  await fs.mkdir(path.join(pp, 'outline', 'story'), { recursive: true })
  await fs.mkdir(path.join(pp, 'outline', 'worldbuilding'), { recursive: true })
  await fs.writeFile(path.join(pp, 'outline', 'story', 'plot.md'), opts.plotMd ?? '', 'utf-8')
  await fs.writeFile(path.join(pp, 'outline', 'worldbuilding', 'worldbuilding.md'), opts.wbMd ?? '', 'utf-8')
  // 实体部分目录预建（与 UI 侧边栏一一对应）
  for (const section of BUILTIN_SECTIONS) {
    if (section.type === 'entities') {
      await fs.mkdir(path.join(pp, 'outline', section.key), { recursive: true })
    }
  }
  // 部分注册表
  await fs.writeFile(path.join(pp, 'outline', 'sections.json'), JSON.stringify({ sections: BUILTIN_SECTIONS, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
}
