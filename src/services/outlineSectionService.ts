// ── 大纲部分注册表服务（v16.4.1）──
// sections.json = 大纲页侧边栏的部分定义（可增删部分 + 字段模板）。
// 内置部分首次加载时自动写入；固定部分（故事剧情/世界观/角色）不可删除。
// 用途：动态渲染侧边栏 Tabs / 实体卡片表单 / 新建部分向导 / AI 生成实体。

import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { sectionsConfigPath } from '@/utils/filePaths'
import { BUILTIN_SECTIONS } from '@/data/builtinSections'
import type { OutlineSectionDef, OutlineSectionsData } from '@/types/outline'

export { BUILTIN_SECTIONS }

/** 加载部分注册表；不存在时写入内置定义并返回 */
export async function loadSections(projectPath: string): Promise<OutlineSectionDef[]> {
  try {
    const content = await fileService.read(sectionsConfigPath(projectPath)).catch(() => null)
    if (content) {
      const parsed = JSON.parse(content) as OutlineSectionsData
      if (parsed?.sections?.length) return parsed.sections
    }
  } catch (err) { logError('解析 sections.json 失败，使用内置定义', err) }
  // 首次：写入内置定义
  await saveSections(projectPath, BUILTIN_SECTIONS)
  return BUILTIN_SECTIONS
}

export async function saveSections(projectPath: string, sections: OutlineSectionDef[]): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(sectionsConfigPath(projectPath), JSON.stringify({ sections, updatedAt: new Date().toISOString() }, null, 2))
  } catch (err) { logError('保存 sections.json 失败', err) }
}
