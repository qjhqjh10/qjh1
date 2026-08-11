// ── 写工具集合一致性（v16.3.1 审计 D8 回归防护） ──
// 4 处消费集合必须满足派生关系，防止未来新增写工具时漏同步：
//   WRITE_TOOLS（副作用串行化）⊇ FILE_WRITER_NAMES
//   FILE_WRITE_TOOLS = FILE_WRITER_NAMES + create_project/edit_file_task/editor_rewrite
//   FENCE_WRITE_TOOLS = FILE_WRITER_NAMES + edit_file_task
//   WRITE_TOOL_NAMES  = WRITE_TOOLS + edit_file_task
import { describe, it, expect } from 'vitest'
import { WRITE_TOOLS, FILE_WRITE_TOOLS, FENCE_WRITE_TOOLS, WRITE_TOOL_NAMES } from '../skills/tools/writeToolSets'
import { WRITE_TOOLS as TOOL_EXECUTOR_WRITE_TOOLS } from '../runtime/ToolExecutor'

const FILE_WRITER_NAMES = ['create_file', 'edit_file', 'batch_replace', 'delete_file', 'rename_file', 'kb_append_file', 'kb_index_file']

describe('写工具集合一致性', () => {
  it('ToolExecutor 与真源 WRITE_TOOLS 完全一致（re-export 无漂移）', () => {
    expect([...TOOL_EXECUTOR_WRITE_TOOLS].sort()).toEqual([...WRITE_TOOLS].sort())
  })

  it('WRITE_TOOLS 包含全部文件写工具 + create/delete_project + 网络写 + editor_rewrite', () => {
    for (const name of FILE_WRITER_NAMES) expect(WRITE_TOOLS.has(name)).toBe(true)
    for (const name of ['create_project', 'delete_project', 'http_get', 'http_fetch', 'browser_open', 'browser_search', 'editor_rewrite']) {
      expect(WRITE_TOOLS.has(name)).toBe(true)
    }
    // 网络写与 delete_project 不是文件写证据
    expect(FILE_WRITE_TOOLS.has('http_get')).toBe(false)
    expect(FILE_WRITE_TOOLS.has('delete_project')).toBe(false)
  })

  it('FILE_WRITE_TOOLS = 文件写工具 + create_project/edit_file_task/editor_rewrite（完成证据语义）', () => {
    expect([...FILE_WRITE_TOOLS].sort()).toEqual(
      [...FILE_WRITER_NAMES, 'create_project', 'edit_file_task', 'editor_rewrite'].sort(),
    )
  })

  it('FENCE_WRITE_TOOLS = 文件写工具 + edit_file_task，不含 editor_rewrite（围栏不拦协作改写）', () => {
    expect([...FENCE_WRITE_TOOLS].sort()).toEqual([...FILE_WRITER_NAMES, 'edit_file_task'].sort())
    expect(FENCE_WRITE_TOOLS.has('editor_rewrite')).toBe(false)
    expect(FENCE_WRITE_TOOLS.has('create_project')).toBe(false)
  })

  it('WRITE_TOOL_NAMES ⊇ WRITE_TOOLS（含 editor_rewrite——v16.3.1 修复项，原镜像缺失）', () => {
    for (const name of WRITE_TOOLS) expect(WRITE_TOOL_NAMES.has(name)).toBe(true)
    expect(WRITE_TOOL_NAMES.has('edit_file_task')).toBe(true)
    expect(WRITE_TOOL_NAMES.has('editor_rewrite')).toBe(true)
  })
})
