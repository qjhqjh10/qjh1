// ── 角色模板文件夹（v16.4.0）──
// 「一个模板 = 一个文件夹」持久化真源（用户决策）：
//   role_templates/<模板ID>/
//   ├── template.json          # 元数据（名称/角色顺序+id/知识库设定文件引用）
//   ├── characters/<角色名>.yaml  # 每角色一文件（对齐项目角色卡字段风格）
//   ├── 世界观.md              # 完整世界观（可写很长）
//   └── 场景对话设定.md        # 场景清单 + 对话规则（可写很长）
// localStorage（store）仍是运行时缓存/UI 数据源；模板增删改后由渲染层调用
// roleTemplate:export 写文件夹；启动时若 store 为空而文件夹非空则自动导入。
// 设计取舍：不反向自动同步（文件夹手工改动 → UI「从文件夹重新加载」显式导入），
// 防"正在编辑的文本框内容被磁盘旧版本覆盖"。

import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'

let templatesRoot = ''

function root(): string {
  return templatesRoot
}

function safeTplId(id: string): string {
  const safe = path.basename(id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 64)
  if (!safe.trim()) throw new Error('Invalid role template ID')
  return safe
}

function safeFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 60)
  return safe || '角色'
}

/** 角色内容字段（写 yaml 的字段子集——id 属模板归属，不在角色文件里） */
interface CharFileFields {
  name: string
  identity: string
  gender: string
  isUser: boolean
  avatar: string
  personality: string
  relationship: string
  firstMessage: string
  exampleDialogue: string
}

/** 角色文件 yaml 序列化（导出用，纯函数可测——长文本/特殊字符 round-trip 安全） */
export function buildCharYaml(fields: CharFileFields): string {
  return yaml.dump(fields, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"' })
}

/** 角色文件 yaml 反序列化（导入用，纯函数可测；损坏返回 null） */
export function parseCharYaml(raw: string): Partial<CharFileFields> | null {
  try {
    const c = yaml.load(raw)
    return c && typeof c === 'object' ? (c as Partial<CharFileFields>) : null
  } catch {
    return null
  }
}

export function registerRoleTemplateHandlers(ipcMain: IpcMain, parentDir: string) {
  templatesRoot = path.join(parentDir, 'role_templates')

  const tplDir = (id: string) => path.join(root(), safeTplId(id))

  // ── 导出模板到文件夹（模板增删改后调用；覆盖写，先清残留角色文件）──
  // tpl: 完整 RoleTemplate（id/name/characters[]/worldSetting/scenarioSetting/worldKbFileIds/scenarioKbFileIds）
  ipcMain.handle('roleTemplate:export', async (_event, tpl: any) => {
    if (!tpl?.id) throw new Error('模板缺少 id')
    const dir = tplDir(tpl.id)
    const charsDir = path.join(dir, 'characters')
    await fs.mkdir(charsDir, { recursive: true })

    // 1. template.json — 元数据（角色顺序 + id 归属；内容在 yaml）
    const meta = {
      id: tpl.id,
      name: tpl.name || '',
      characterRefs: (tpl.characters || []).map((c: any) => ({ id: c.id, name: c.name })),
      worldKbFileIds: tpl.worldKbFileIds || [],
      scenarioKbFileIds: tpl.scenarioKbFileIds || [],
      updatedAt: new Date().toISOString(),
    }
    await fs.writeFile(path.join(dir, 'template.json'), JSON.stringify(meta, null, 2), 'utf-8')

    // 2. 清残留角色文件（重命名后旧文件不再导出——防导入时变出"幽灵角色"）
    const existing = await fs.readdir(charsDir).catch(() => [] as string[])
    const currentNames = new Set((tpl.characters || []).map((c: any) => `${safeFileName(c.name)}.yaml`))
    for (const f of existing) {
      if (f.endsWith('.yaml') && !currentNames.has(f)) {
        await fs.rm(path.join(charsDir, f), { force: true }).catch(() => {})
      }
    }

    // 3. 每角色一个 yaml（长文本字段用块标量，js-yaml dump 自动处理换行）
    for (const c of tpl.characters || []) {
      const fields: CharFileFields = {
        name: c.name || '',
        identity: c.identity || '自定义',
        gender: c.gender || '男',
        isUser: !!c.isUser,
        avatar: c.avatar || '',
        personality: c.personality || '',
        relationship: c.relationship || '',
        firstMessage: c.firstMessage || '',
        exampleDialogue: c.exampleDialogue || '',
      }
      await fs.writeFile(
        path.join(charsDir, `${safeFileName(fields.name)}.yaml`),
        buildCharYaml(fields),
        'utf-8',
      )
    }

    // 4. 世界观 / 场景对话设定（与 UI 文本框互为镜像——文本框即文件）
    await fs.writeFile(path.join(dir, '世界观.md'), tpl.worldSetting || '', 'utf-8')
    await fs.writeFile(path.join(dir, '场景对话设定.md'), tpl.scenarioSetting || '', 'utf-8')

    return { ok: true, folder: safeTplId(tpl.id) }
  })

  // ── 从文件夹读模板（「从文件夹重新加载」+ 启动导入）──
  // 返回 RoleTemplate 形状（id 取 template.json，角色 id 按 characterRefs 恢复）
  ipcMain.handle('roleTemplate:readFolder', async (_event, id: string) => {
    const dir = tplDir(id)
    const metaRaw = await fs.readFile(path.join(dir, 'template.json'), 'utf-8').catch(() => null)
    if (!metaRaw) return null
    const meta = JSON.parse(metaRaw) as {
      id?: string; name?: string
      characterRefs?: Array<{ id: string; name: string }>
      worldKbFileIds?: string[]; scenarioKbFileIds?: string[]
    }
    const world = await fs.readFile(path.join(dir, '世界观.md'), 'utf-8').catch(() => '')
    const scenario = await fs.readFile(path.join(dir, '场景对话设定.md'), 'utf-8').catch(() => '')
    const refs = meta.characterRefs || []
    const characters: any[] = []
    const charFiles = await fs.readdir(path.join(dir, 'characters')).catch(() => [] as string[])
    for (const f of charFiles.filter(f => f.endsWith('.yaml'))) {
      try {
        const raw = await fs.readFile(path.join(dir, 'characters', f), 'utf-8')
        const c = parseCharYaml(raw)
        if (!c?.name) continue
        const ref = refs.find(r => r.name === c.name)
        characters.push({
          id: ref?.id || `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: c.name,
          identity: c.identity || '自定义',
          gender: c.gender || '男',
          isUser: !!c.isUser,
          avatar: c.avatar || '',
          personality: c.personality || '',
          relationship: c.relationship || '',
          firstMessage: c.firstMessage || '',
          exampleDialogue: c.exampleDialogue || '',
        })
      } catch { /* 单个文件损坏跳过 */ }
    }
    return {
      id: meta.id || id,
      name: meta.name || id,
      characters,
      worldSetting: world,
      scenarioSetting: scenario,
      worldKbFileIds: meta.worldKbFileIds || [],
      scenarioKbFileIds: meta.scenarioKbFileIds || [],
    }
  })

  // ── 列出文件夹模板（启动导入 + 设置页展示已导出状态）──
  ipcMain.handle('roleTemplate:listFolders', async () => {
    try {
      const entries = await fs.readdir(root())
      const out: Array<{ id: string; name: string }> = []
      for (const e of entries) {
        try {
          const metaRaw = await fs.readFile(path.join(root(), e, 'template.json'), 'utf-8')
          const meta = JSON.parse(metaRaw) as { id?: string; name?: string }
          out.push({ id: meta.id || e, name: meta.name || e })
        } catch { /* 非模板文件夹跳过 */ }
      }
      return out
    } catch {
      return []
    }
  })

  // ── 删除文件夹（删模板时联动清理磁盘）──
  ipcMain.handle('roleTemplate:deleteFolder', async (_event, id: string) => {
    await fs.rm(tplDir(id), { recursive: true, force: true })
    return true
  })
}
