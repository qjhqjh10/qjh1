// ── 文件路径工具 ──
// 集中化管理所有结构化数据文件的路径构造和扩展名逻辑。
// 所有服务层、UI 层、Provider 层应通过此模块构造路径，
// 而不是各自硬编码 `${projectPath}/characters/${name}.yaml`。
//
// 扩展名变更只需改此文件顶部的常量。

// ═══════════════════════════════════════════════════
//  扩展名常量
// ═══════════════════════════════════════════════════

/** AI 生成的结构化数据文件扩展名（当前使用 YAML） */
const STRUCTURED_DATA_EXT = '.yaml' as const

/** 旧版 JSON 扩展名（向后兼容读取） */
const LEGACY_JSON_EXT = '.json' as const

// ═══════════════════════════════════════════════════
//  扩展名判断
// ═══════════════════════════════════════════════════

function isYamlFile(fp: string): boolean {
  return fp.endsWith('.yaml') || fp.endsWith('.yml')
}

function isJsonFile(fp: string): boolean {
  return fp.endsWith('.json')
}

/** 判断是否为结构化数据文件（AI 生成的内容文件，YAML 或 JSON） */
export function isStructuredDataFile(fp: string): boolean {
  return isYamlFile(fp) || isJsonFile(fp)
}

// ═══════════════════════════════════════════════════
//  路径构造（项目数据文件）
// ═══════════════════════════════════════════════════
// M1: projectId 实为路径前缀（projectPath），命名对齐；路径构造函数统一由此产出。

/** 角色文件路径（v16.4.1: 统一迁移至 outline/characters/，与大纲其他部分同布局） */
export function characterPath(projectPath: string, name: string): string {
  return `${projectPath}/outline/characters/${name}${STRUCTURED_DATA_EXT}`
}

/** 细纲文件路径 */
export function detailedOutlinePath(projectPath: string, chapterId: string): string {
  return `${projectPath}/detailed_outline/${chapterId}${STRUCTURED_DATA_EXT}`
}

// ═══════════════════════════════════════════════════
//  v16.4.1: 大纲部分化布局（outline/<sectionKey>/<实体>.yaml）
//  每部分一个文件夹；doc 部分文件夹内一个文件，entities 部分每实体一个文件。
// ═══════════════════════════════════════════════════

/** 大纲部分目录路径 */
export function outlineSectionDir(projectPath: string, sectionKey: string): string {
  return `${projectPath}/outline/${sectionKey}`
}

/** 大纲实体文件路径（文件名 = 实体 id，与角色约定一致） */
export function outlineEntityPath(projectPath: string, sectionKey: string, entityId: string): string {
  return `${projectPath}/outline/${sectionKey}/${entityId}${STRUCTURED_DATA_EXT}`
}

/** 大纲部分注册表文件（sections.json） */
export function sectionsConfigPath(projectPath: string): string {
  return `${projectPath}/outline/sections.json`
}

// M1: 大纲 Tab → 实际文件名映射（与 OutlinePage/create_project 初始文件对齐）。
// v16.4.1: doc 部分文件夹化（story/worldbuilding → outline/<key>/<file>）；
// *Legacy = 旧平铺路径（迁移兼容，fileEditNotify 双向命中）。
// 实体部分（items/foreshadows/threads 等）已改为 outline/<sectionKey>/<实体>.yaml 目录，
// 不再经本表（fileEditNotify 直接按目录前缀命中）。
const TAB_FILE_MAP: Record<string, string> = {
  story: 'story/plot.md',
  storyLegacy: 'plot.md',
  worldbuilding: 'worldbuilding/worldbuilding.md',
  worldbuildingLegacy: 'worldbuilding.md',
}

/** 大纲 Tab 文件路径（按 TAB_FILE_MAP 解析真实文件名） */
export function outlineTabPath(projectPath: string, tabName: string): string {
  const file = TAB_FILE_MAP[tabName]
  return `${projectPath}/outline/${file || tabName + STRUCTURED_DATA_EXT}`
}

/** 场景配置文件路径 */
export function sceneConfigPath(projectPath: string, chapterId: string): string {
  return `${projectPath}/scenes/${chapterId}${STRUCTURED_DATA_EXT}`
}

// ═══════════════════════════════════════════════════
//  扩展名操作
// ═══════════════════════════════════════════════════

/** 去除扩展名 */
export function stripExtension(fp: string): string {
  return fp.replace(/\.(json|ya?ml)$/, '')
}

// ═══════════════════════════════════════════════════
//  旧文件自动迁移
// ═══════════════════════════════════════════════════

/**
 * 读取结构化数据文件，自动迁移旧 .json → .yaml。
 *
 * 逻辑：
 *   1. 先读 .yaml → 存在则返回
 *   2. 不存在 → 读 .json → 存在则自动转为 .yaml 保存 → 返回
 *   3. 都不存在 → 返回 null
 *
 * @param readFile  文件读取函数 (path) => Promise<string|null>
 * @param writeFile 文件写入函数 (path, content) => Promise<void>
 * @param dirPath   目录路径
 * @param baseName  文件基础名（不含扩展名）
 */
export async function readAndMigrate(
  readFile: (path: string) => Promise<string | null>,
  writeFile: (path: string, content: string) => Promise<void>,
  dirPath: string,
  baseName: string,
): Promise<{ content: string; migrated: boolean } | null> {
  const yamlPath = `${dirPath}/${baseName}.yaml`

  // 1. 先读 .yaml
  const yamlContent = await readFile(yamlPath)
  if (yamlContent !== null && yamlContent !== undefined && yamlContent !== '') {
    return { content: yamlContent, migrated: false }
  }

  // 2. 不存在 → 读 .json
  const jsonPath = `${dirPath}/${baseName}.json`
  const jsonContent = await readFile(jsonPath)
  if (jsonContent === null || jsonContent === undefined || jsonContent === '') {
    return null
  }

  // 3. JSON 存在 → 自动转为 YAML
  const { tryParseJsonOrYaml, yamlStringify } = await import('./yamlUtils')
  const parsed = tryParseJsonOrYaml(jsonContent, 'json')
  if (!parsed) return null

  const yaml = yamlStringify(parsed.obj)
  await writeFile(yamlPath, yaml)
  return { content: yaml, migrated: true }
}
