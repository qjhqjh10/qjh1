// ── Knowledge Base Tools (4 tools) ──
// Self-contained for skill system. Uses kbService from @/services/fileService.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const kbTools: ToolDefinition[] = [
  {
    schema: {
      name: 'kb_list',
      description:
        '列出知识库中所有文件的名称、ID 和类型。何时使用：保存内容到知识库之前，先查看已有文件列表。根据已有文件决定追加到现有文件（kb_append_file）还是创建新文件（kb_create_file）。返回文件列表含名称和ID——后续追加/索引操作需要用到ID。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permission: 'AUTO',
    category: 'kb',
    availableInPlanMode: true,
    executor: async (_args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        const meta = (await kbService.list()) as { files: { id: string; originalName: string; type: string }[] }
        const fileList = meta.files
          .map((f) => `${f.originalName} (id: ${f.id}, 类型: ${f.type})`)
          .join('\n')
        return {
          status: 'success',
          summary: `${meta.files.length} 个文件`,
          detail: fileList || '(知识库为空)',
        }
      } catch (e) {
        return { status: 'error', summary: `知识库列表失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'kb_create_file',
      description:
        '在知识库创建新文件保存资料。何时使用：要保存的内容不匹配任何已有知识库文件时。先调用 kb_list 确认是否需要新建。文件名应描述性（如"古风服饰描写收集.md"）。创建后必须调用 kb_index_file 建立语义搜索索引（索引不会自动建立）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名（建议含中文描述）' },
          content: { type: 'string', description: '文件内容（Markdown）' },
        },
        required: ['name', 'content'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { sanitizeFileName } = await import('@/utils/security')
        const nameCheck = sanitizeFileName(args.name)
        if (!nameCheck.valid) return { status: 'error', summary: nameCheck.error! }
        const { kbService } = await import('@/services/fileService')
        const result = await kbService.create(
          nameCheck.value || '未命名.md',
          (args.content as string) || '',
          ctx.projectId || undefined,
        )
        // v9.5.3: 不再自动索引 — 由模型通过 kb_index_file 手动控制索引时机
        return {
          status: 'success',
          summary: `已创建知识库文件: ${result.name}`,
          detail: `文件ID: ${result.id}（提示：调用 kb_index_file 建立语义搜索索引）`,
        }
      } catch (e) {
        return {
          status: 'error',
          summary: `创建知识库文件失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },

  {
    schema: {
      name: 'kb_append_file',
      description:
        '向知识库已有文件末尾追加内容。何时使用：新内容与已有知识库文件主题相关时。先 kb_list 获取文件列表，确认目标文件的 ID（不是名称）。追加内容会以分隔线隔开。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件 ID（从 kb_list 获取）' },
          content: { type: 'string', description: '要追加的内容' },
        },
        required: ['file_id', 'content'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        await kbService.append(args.file_id as string, args.content as string, ctx.projectId || undefined)
        return { status: 'success', summary: '已追加到知识库文件' }
      } catch (e) {
        return {
          status: 'error',
          summary: `追加知识库文件失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },

  {
    schema: {
      name: 'kb_index_file',
      description:
        '对知识库文件建立语义搜索索引。何时使用：创建或追加知识库文件内容后，调用此工具使内容可被语义搜索检索。需要从 kb_list 获取目标文件的 ID。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件 ID' },
        },
        required: ['file_id'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        const fileId = String(args.file_id || '')
        const result = await kbService.index(fileId, ctx.configId)
        return { status: 'success', summary: `索引完成: ${result.chunkCount} 个片段` }
      } catch (e) {
        return { status: 'error', summary: `索引失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },
]
