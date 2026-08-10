// H2: persist 迁移链验证（累积式迁移）
// 原实现每个分支提前 return + v5 排最后 → v5 永不可达、version=4 用户错过 v5/v7/v8。
// 修复后任意旧版本应一次性获得其版本之后的所有迁移。
import { describe, it, expect } from 'vitest'
import { migrateSettings } from '../index'

type AnyRecord = Record<string, unknown>

/** 构造 version=4 用户的持久化状态（v5/v6/v7/v8 均未应用） */
function makeV4State(): AnyRecord {
  return {
    configs: [{ id: 'c1', name: 'deepseek' }],
    activeConfigId: 'c1',
    prompts: [
      { id: 'p1', title: '润色模板', type: '润色', content: 'x', enabled: true },
      { id: 'p2', title: '章节模板', type: '章节', content: 'y', enabled: true },
    ],
    aiSettings: {
      customRoles: [
        { id: 'r1', name: '反派', prompt: '心狠手辣' },
        { id: 'r2', name: '助手', prompt: '温柔' },
      ],
      chapterGen: { useOutline: true, wordTarget: 3000 },
    },
    displaySettings: { theme: 'dark' },
  }
}

describe('migrateSettings (H2)', () => {
  it('version=4 用户一次性获得 v5+v6+v7+v8 全部迁移', () => {
    const out = migrateSettings(makeV4State(), 4)

    // v5: customRoles → roleTemplates
    const ai = out.aiSettings as AnyRecord
    const templates = ai.roleTemplates as AnyRecord[]
    expect(Array.isArray(templates)).toBe(true)
    expect(templates!.length).toBe(1)
    const tmpl = templates![0]
    expect(tmpl.name).toBe('经典模式')
    expect((tmpl.characters as unknown[]).length).toBe(3) // 写作者 + 反派 + 助手
    expect(ai.activeRoleTemplateId).toBe(tmpl.id)
    expect(String(tmpl.id)).toMatch(/^rt_mig_/)

    // v6: 润色 → 改写
    const prompts = out.prompts as Array<{ type: string; title: string }>
    expect(prompts.find(p => p.title === '润色模板')!.type).toBe('改写')

    // v7+v8+v9: kbSettings 分场景（v15.4.0: generation → chapterGen/characterGen 同值，agent 保留）
    const kb = ai.kbSettings as AnyRecord
    const agentKb = kb.agent as AnyRecord
    expect(typeof agentKb.searchTopK).toBe('number')
    expect((kb.chapterGen as AnyRecord).searchTopK).toBe(agentKb.searchTopK)
    expect((kb.characterGen as AnyRecord).searchTopK).toBe(agentKb.searchTopK)
    expect((kb.chapterGen as AnyRecord).injectMode).toBe('full')
    expect((kb.characterGen as AnyRecord).injectMode).toBe('full')
    expect((kb.generation as AnyRecord).searchTopK).toBe(agentKb.searchTopK)  // 兜底键保持同值

    // 既有字段不丢失
    expect((ai.chapterGen as AnyRecord).useOutline).toBe(true)
    expect((out.displaySettings as AnyRecord).theme).toBe('dark')
    expect((out.configs as unknown[]).length).toBe(1)
  })

  it('version=0 全链应用（含 v1 基础重建）', () => {
    const raw = makeV4State() as unknown
    const out = migrateSettings(raw, 0)
    // v1 重建: prompts 保留、aiSettings 合并默认值
    expect((out.prompts as unknown[]).length).toBe(2)
    expect((out.aiSettings as AnyRecord).customRoles).toBeDefined()
    // 后续 v2-v8+v5 都应用
    const ai = out.aiSettings as AnyRecord
    expect(ai.chapterGen).toBeDefined()
    expect(Array.isArray(ai.roleTemplates)).toBe(true)
    expect((ai.kbSettings as AnyRecord).agent).toBeDefined()
  })

  it('version=7 只应用 v8+v9（平铺 kbSettings → 分场景，保留用户值）', () => {
    const v4 = makeV4State()
    const state: AnyRecord = {
      ...v4,
      aiSettings: {
        ...(v4.aiSettings as AnyRecord),
        roleTemplates: [{ id: 'rt1', name: '已有模板' }],
        customRoles: undefined, // v5 已迁移过
        kbSettings: { searchTopK: 9, fallbackPerFileMaxChars: 3000, fallbackTotalMaxChars: 6000 },
      },
    }
    const out = migrateSettings(state, 7)
    const kb = (out.aiSettings as AnyRecord).kbSettings as AnyRecord
    // v8: 平铺 → 分场景，且保留已有值 9
    expect((kb.agent as AnyRecord).searchTopK).toBe(9)
    expect((kb.generation as AnyRecord).searchTopK).toBe(9)
    expect((kb.agent as AnyRecord).fallbackPerFileMaxChars).toBe(3000)
    // v9 (v15.4.0): generation → chapterGen/characterGen 同值 + injectMode 补全
    expect((kb.chapterGen as AnyRecord).searchTopK).toBe(9)
    expect((kb.characterGen as AnyRecord).searchTopK).toBe(9)
    expect((kb.chapterGen as AnyRecord).injectMode).toBe('full')
    // v5 不重复执行: 已有 roleTemplates 不被覆盖
    expect((out.aiSettings as AnyRecord).roleTemplates).toEqual([{ id: 'rt1', name: '已有模板' }])
  })

  it('version=8 应用 v9（generation → chapterGen/characterGen 同值拆分，用户自定义值保留）', () => {
    const v4 = makeV4State()
    const state: AnyRecord = {
      ...v4,
      aiSettings: {
        ...(v4.aiSettings as AnyRecord),
        kbSettings: {
          agent: { searchTopK: 3, fallbackPerFileMaxChars: 2000, fallbackTotalMaxChars: 5000, injectMode: 'full' as const },
          generation: { searchTopK: 7, fallbackPerFileMaxChars: 4000, fallbackTotalMaxChars: 9000, injectMode: 'full' as const },
        },
      },
    }
    const out = migrateSettings(state, 8)
    const kb = (out.aiSettings as AnyRecord).kbSettings as AnyRecord
    // agent 用户自定义值保留
    expect((kb.agent as AnyRecord).searchTopK).toBe(3)
    // generation 用户值同值复制到新键 + 兜底键保留
    expect((kb.chapterGen as AnyRecord).searchTopK).toBe(7)
    expect((kb.characterGen as AnyRecord).searchTopK).toBe(7)
    expect((kb.chapterGen as AnyRecord).fallbackPerFileMaxChars).toBe(4000)
    expect((kb.chapterGen as AnyRecord).injectMode).toBe('full')
    expect((kb.generation as AnyRecord).searchTopK).toBe(7)
  })

  it('version=2 应用 v3 主题映射 + v4 清空 configs（审查补强）', () => {
    const state = makeV4State()
    const out = migrateSettings(state, 2)
    // v3: dark → neon-dark（version=2 触发 v3 分支；v2 分支 2<2 不执行）
    expect((out.displaySettings as AnyRecord).theme).toBe('neon-dark')
    // v4: 清空旧 configs（ModelConfig 结构变更）
    expect(out.configs).toEqual([])
    // v6/v7/v8/v5 全部应用
    expect(Array.isArray((out.aiSettings as AnyRecord).roleTemplates)).toBe(true)
    expect((out.aiSettings as AnyRecord).chapterGen).toBeDefined()
  })

  it('version=10（当前版本）返回原状态', () => {
    const state = makeV4State()
    const out = migrateSettings(state, 10)
    expect(out).toEqual(state)
  })

  it('version=9 应用 v10（aiSettings 补 visionTemplate，无 image* 字段的 configs 不动）', () => {
    const state = makeV4State()
    const out = migrateSettings(state, 9)
    expect((out.aiSettings as AnyRecord).visionTemplate).toBe('standard')
    // configs 无 image* 字段 → 保持原样（不新增 secondary 字段）
    expect(out.configs).toEqual([{ id: 'c1', name: 'deepseek' }])
  })

  it('非对象持久化（undefined/null）安全降级', () => {
    const out = migrateSettings(undefined, 0)
    expect(Array.isArray(out.configs)).toBe(true)
    expect((out.aiSettings as AnyRecord).roleTemplates).toBeDefined() // v5 兜底确保数组存在
  })
})
