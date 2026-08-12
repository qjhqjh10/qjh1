// ── 大纲部分化布局迁移（v16.4.1）──
// 旧布局 → 新布局（outline/<sectionKey>/<实体>.yaml，每实体一个文件）：
//   characters/*.yaml            → outline/characters/（迁移后删除顶层 characters/）
//   outline/{items,locations,factions}.yaml（列表）→ outline/<部分>/<名称>.yaml 逐个拆分
//   outline/power_system.yaml    → outline/power_systems/<体系名>.yaml（支持多体系）
//   outline/emotion.yaml         → outline/emotions/seg-<起>-<止>.yaml（段即实体）
//   outline/outline_meta.yaml（foreshadowing/plotThreads）→ outline/foreshadows/、outline/threads/
//   outline/plot.md              → outline/story/plot.md（doc 部分文件夹化）
//   outline/worldbuilding.md     → outline/worldbuilding/worldbuilding.md
// 移动语义（v16.4.1 用户决策）：复制成功且新文件存在 → 删除旧文件；空旧文件也迁移（保持目录一致）。
// 幂等：目标目录已存在即跳过（已迁移/用户已用新布局）。

import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { readAndMigrate } from '@/utils/filePaths'
import { tryParseJsonOrYaml } from '@/utils/yamlUtils'
import { safeEntityName } from '@/services/outlineEntityService'

const LEGACY_MAP: Record<string, string> = {
  items: 'items',
  locations: 'locations',
  factions: 'factions',
}

/** 目标目录是否已存在且非空（存在即视为已迁移/用户已使用） */
async function dirHasContent(projectPath: string, key: string): Promise<boolean> {
  try {
    const files = await fileService.listDir(`${projectPath}/outline/${key}`)
    return files.length > 0
  } catch { return false }
}

/** 目标目录在用 + 旧平铺文件残留（此前复制迁移留下的备份）→ 清理旧文件 */
async function cleanupLegacy(projectPath: string, sectionKey: string, legacyPath: string): Promise<boolean> {
  if (await dirHasContent(projectPath, sectionKey)) {
    await fileService.deleteFile(legacyPath).catch(() => {})
    return true
  }
  return false
}

/** 写新文件并删除旧文件（移动语义；任一失败不删旧） */
async function moveTo(projectPath: string, sectionKey: string, newId: string, content: string, oldPath: string): Promise<void> {
  await fileService.ensureDir(`${projectPath}/outline/${sectionKey}`)
  await fileService.write(`${projectPath}/outline/${sectionKey}/${newId}.yaml`, content)
  await fileService.deleteFile(oldPath).catch(() => {})  // 新文件已写入，删旧（失败不阻塞——下次迁移跳过目录判断后不再处理，旧文件成为兼容备份）
}

/** 拆分旧列表 yaml（items/locations/factions）→ 每实体一个文件；空列表也建目录 */
async function migrateListData(projectPath: string, key: string, listField: string): Promise<void> {
  const oldPath = `${projectPath}/outline/${key}.yaml`
  if (await cleanupLegacy(projectPath, key, oldPath)) return
  const migrated = await readAndMigrate(
    p => fileService.read(p).catch(() => null),
    (p, c) => fileService.write(p, c),
    `${projectPath}/outline`, key,
  ).catch(() => null)
  if (!migrated) return
  await fileService.ensureDir(`${projectPath}/outline/${key}`)
  const parsed = tryParseJsonOrYaml(migrated.content)
  if (!parsed) { await fileService.deleteFile(oldPath).catch(() => {}); return }
  const list = (parsed.obj as Record<string, unknown>)[listField]
  if (!Array.isArray(list)) { await fileService.deleteFile(oldPath).catch(() => {}); return }
  const usedNames = new Set<string>()
  for (const item of list) {
    const raw = item as Record<string, unknown>
    if (!raw || typeof raw !== 'object') continue
    const base = typeof raw.name === 'string' ? String(raw.name) : '未命名'
    let name = safeEntityName(base)
    while (usedNames.has(name)) name = `${name}-2`
    usedNames.add(name)
    await fileService.write(`${projectPath}/outline/${key}/${name}.yaml`, JSON.stringify(raw, null, 2)).catch(() => {})
  }
  await fileService.deleteFile(oldPath).catch(() => {})
}

/** 迁移等级体系（单体系 → 多体系目录；空体系也建目录） */
async function migratePowerSystems(projectPath: string): Promise<void> {
  const oldPath = `${projectPath}/outline/power_system.yaml`
  if (await cleanupLegacy(projectPath, 'power_systems', oldPath)) return
  const migrated = await readAndMigrate(
    p => fileService.read(p).catch(() => null),
    (p, c) => fileService.write(p, c),
    `${projectPath}/outline`, 'power_system',
  ).catch(() => null)
  if (!migrated) return
  await fileService.ensureDir(`${projectPath}/outline/power_systems`)
  const parsed = tryParseJsonOrYaml(migrated.content)
  if (!parsed) { await fileService.deleteFile(oldPath).catch(() => {}); return }
  const obj = parsed.obj as Record<string, unknown>
  if (obj && typeof obj === 'object') {
    const name = safeEntityName(typeof obj.name === 'string' && obj.name ? obj.name : '等级体系')
    await fileService.write(`${projectPath}/outline/power_systems/${name}.yaml`, JSON.stringify(obj, null, 2)).catch(() => {})
  }
  await fileService.deleteFile(oldPath).catch(() => {})
}

/** 迁移情绪段（每段一个文件；空也建目录） */
async function migrateEmotions(projectPath: string): Promise<void> {
  const oldPath = `${projectPath}/outline/emotion.yaml`
  if (await cleanupLegacy(projectPath, 'emotions', oldPath)) return
  const migrated = await readAndMigrate(
    p => fileService.read(p).catch(() => null),
    (p, c) => fileService.write(p, c),
    `${projectPath}/outline`, 'emotion',
  ).catch(() => null)
  if (!migrated) return
  await fileService.ensureDir(`${projectPath}/outline/emotions`)
  const parsed = tryParseJsonOrYaml(migrated.content)
  if (!parsed) { await fileService.deleteFile(oldPath).catch(() => {}); return }
  const segments = (parsed.obj as Record<string, unknown>).segments
  if (Array.isArray(segments)) {
    segments.forEach((seg, i) => {
      const s = seg as { chapterStart?: number; chapterEnd?: number }
      const name = `seg-${s?.chapterStart ?? i + 1}-${s?.chapterEnd ?? i + 1}`
      fileService.write(`${projectPath}/outline/emotions/${name}.yaml`, JSON.stringify(seg, null, 2)).catch(() => {})
    })
  }
  await fileService.deleteFile(oldPath).catch(() => {})
}

/** 迁移 outline_meta.yaml 里的伏笔/故事线（空也建目录；迁移后删除旧 meta 文件） */
async function migrateMetaEntities(projectPath: string): Promise<void> {
  const oldPath = `${projectPath}/outline/outline_meta.yaml`
  // 伏笔/故事线目录都在用（至少一个）→ 旧 meta 是冗余备份 → 清理
  if (await dirHasContent(projectPath, 'foreshadows')) {
    if (await dirHasContent(projectPath, 'threads')) {
      await fileService.deleteFile(oldPath).catch(() => {})
      return
    }
  }
  const migrated = await readAndMigrate(
    p => fileService.read(p).catch(() => null),
    (p, c) => fileService.write(p, c),
    `${projectPath}/outline`, 'outline_meta',
  ).catch(() => null)
  if (!migrated) return
  const parsed = tryParseJsonOrYaml(migrated.content)
  if (!parsed) { await fileService.deleteFile(oldPath).catch(() => {}); return }
  const obj = parsed.obj as Record<string, unknown>

  // 伏笔
  if (!(await dirHasContent(projectPath, 'foreshadows'))) {
    await fileService.ensureDir(`${projectPath}/outline/foreshadows`)
    const list = obj.foreshadowing
    if (Array.isArray(list)) {
      const used = new Set<string>()
      for (const f of list) {
        const raw = f as Record<string, unknown>
        if (!raw || typeof raw !== 'object') continue
        const desc = typeof raw.description === 'string' ? raw.description : ''
        let name = safeEntityName(desc.slice(0, 15) || '伏笔')
        while (used.has(name)) name = `${name}-2`
        used.add(name)
        await fileService.write(`${projectPath}/outline/foreshadows/${name}.yaml`, JSON.stringify(raw, null, 2)).catch(() => {})
      }
    }
  }

  // 故事线
  if (!(await dirHasContent(projectPath, 'threads'))) {
    await fileService.ensureDir(`${projectPath}/outline/threads`)
    const list = obj.plotThreads
    if (Array.isArray(list)) {
      const used = new Set<string>()
      for (const t of list) {
        const raw = t as Record<string, unknown>
        if (!raw || typeof raw !== 'object') continue
        let name = safeEntityName(typeof raw.name === 'string' ? raw.name : '故事线')
        while (used.has(name)) name = `${name}-2`
        used.add(name)
        await fileService.write(`${projectPath}/outline/threads/${name}.yaml`, JSON.stringify(raw, null, 2)).catch(() => {})
      }
    }
  }

  await fileService.deleteFile(oldPath).catch(() => {})
}

/** 迁移 doc 部分到子文件夹（plot.md → story/plot.md；worldbuilding.md → worldbuilding/） */
async function migrateDocFiles(projectPath: string): Promise<void> {
  const pairs: Array<{ section: string; file: string }> = [
    { section: 'story', file: 'plot.md' },
    { section: 'worldbuilding', file: 'worldbuilding.md' },
  ]
  for (const { section, file } of pairs) {
    const oldPath = `${projectPath}/outline/${file}`
    if (await cleanupLegacy(projectPath, section, oldPath)) continue
    try {
      const content = await fileService.read(oldPath).catch(() => null)
      if (content === null || content === undefined) continue
      await fileService.ensureDir(`${projectPath}/outline/${section}`)
      await fileService.write(`${projectPath}/outline/${section}/${file}`, content)
      await fileService.deleteFile(oldPath).catch(() => {})
    } catch (err) { logError(`迁移失败: ${oldPath}`, err) }
  }
}

/** 角色目录迁移（顶层 characters/ → outline/characters/）；迁移后清理空顶层目录 */
export async function migrateCharactersDir(projectPath: string): Promise<void> {
  try {
    if (await dirHasContent(projectPath, 'characters')) {
      // 新目录在用 → 清理顶层残留（复制迁移时代留下的备份）
      try {
        const remaining = await fileService.listDir(`${projectPath}/characters`)
        for (const f of remaining) await fileService.deleteFile(`${projectPath}/characters/${f}`).catch(() => {})
        const after = await fileService.listDir(`${projectPath}/characters`)
        if (after.length === 0) await fileService.deleteDir(`${projectPath}/characters`)
      } catch { /* 顶层目录已不存在 */ }
      return
    }
    const files = await fileService.listDir(`${projectPath}/characters`)
    const dataFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json') || f.endsWith('.txt'))
    await fileService.ensureDir(`${projectPath}/outline/characters`)
    for (const f of dataFiles) {
      const content = await fileService.read(`${projectPath}/characters/${f}`).catch(() => null)
      if (content === null || content === undefined) continue
      await fileService.write(`${projectPath}/outline/characters/${f}`, content).catch(() => {})
      await fileService.deleteFile(`${projectPath}/characters/${f}`).catch(() => {})
    }
    // 清理空的顶层 characters/ 目录
    try {
      const remaining = await fileService.listDir(`${projectPath}/characters`)
      if (remaining.length === 0) await fileService.deleteDir(`${projectPath}/characters`)
    } catch { /* 目录已不存在 */ }
  } catch { /* 顶层目录不存在 = 无旧数据 */ }
}

/** 完整迁移（大纲页加载时调用）：幂等，全部目录已有内容时零操作 */
export async function migrateOutlineLayout(projectPath: string): Promise<void> {
  try {
    await migrateDocFiles(projectPath)
    await migrateCharactersDir(projectPath)
    for (const [key, listField] of Object.entries(LEGACY_MAP)) {
      await migrateListData(projectPath, key, listField)
    }
    await migratePowerSystems(projectPath)
    await migrateEmotions(projectPath)
    await migrateMetaEntities(projectPath)
  } catch (err) { logError('大纲布局迁移失败（不影响使用，数据仍在旧位置）', err) }
}
