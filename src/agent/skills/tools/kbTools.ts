// ── Knowledge Base Tools (2 tools) ──
// v11.5: kb_list/kb_create_file REMOVED.
// Use universal tools instead: list_directory("../knowledge_base/files") /
//   create_file("../knowledge_base/files/xxx.md", content)
// Kept: kb_append_file (uses file_id, not path) and kb_index_file (triggers embedding)

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

/** v14.8: kb_analyze detail 回灌主上下文截断上限（对齐 analyze_file 8000） */
const MAX_DETAIL_CHARS_KB_ANALYZE = 8000

export const kbTools: ToolDefinition[] = [
  {
    schema: {
      name: 'kb_search',
      description:
        '语义搜索知识库。输入查询关键词，返回最相关的 N 个文本片段（每段约500字符）及来源文件名。匹配到相关内容后，如需完整上下文，用 read_file 读取对应文件。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
          topK: { type: 'number', description: '返回片段数，默认5，最大20' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        const topK = Math.min(Math.max(Number(args.topK) || 5, 1), 20)
        // v14.3.1: 工具检索**不受用户勾选限定**——模型自主检索时覆盖全部知识库文件：
        // 用户可能在对话中直接指定某文件（未勾选/未开知识库按钮），工具必须能搜到。
        // projectId 传 '' → 全库检索（不受项目归属过滤；知识库为全局目录，projects[] 仅归属标记）
        // v14.8: 排除已注入上下文的知识库文件（per-run 经 ToolExecutionContext 传递——
        // 原模块级单例被并发 run/子 agent 共享串扰；子 agent ctx 恒空，检索全库）
        const excludeFileIds = ctx.kbInjectedFileIds && ctx.kbInjectedFileIds.length > 0
          ? ctx.kbInjectedFileIds
          : undefined
        const results = await kbService.search(
          String(args.query || '').slice(0, 4000),
          '',  // 全库检索
          ctx.configId,
          topK,
          undefined,
          excludeFileIds,
        )
        if (!results || results.length === 0) {
          return { status: 'success', summary: '未找到匹配的知识库内容' }
        }
        const detail = results.map((r: any) =>
          `📄 ${r.fileName || '(未知)'} (相关度: ${r.score})\n${r.content || ''}`
        ).join('\n---\n')
        return {
          status: 'success',
          summary: `找到 ${results.length} 个相关片段`,
          detail,
        }
      } catch (e) {
        return { status: 'error', summary: `知识库搜索失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    // v14.8: Agentic RAG — 委托只读子代理深度分析知识库（多次 kb_search + read_file 全文 → 结构化总结）。
    // 与 analyze_file 同款委托链（subagentTools）；子代理上下文无 KB 预注入、ctx.kbInjectedFileIds 恒空，
    // 其内部 kb_search 全库检索不受 5 条/500 字预注入限制，可反复搜索直到找到有用信息。
    schema: {
      name: 'kb_analyze',
      description:
        '委托子分析代理（独立上下文窗口）深度分析知识库：子代理自主多次语义搜索（可按不同检索词变换）、' +
        '对命中的高相关文件 read_file 读取全文，综合后输出结构化分析总结（按主题归纳、标注来源文件、提取关键设定要点），' +
        '不占用你的上下文。适合需要跨文件综合、设定一致性核对、按主题整理知识库内容的场景。' +
        '轻量检索请直接用 kb_search。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '分析主题或问题（如"世界观中的修炼体系""女主的成长脉络"）' },
          focus: { type: 'string', description: '关注的侧面（可选，如"时间线""设定矛盾""与主角的关系"）' },
          topK: { type: 'number', description: '首轮检索片段数，默认5，最大20' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const query = String(args.query || '').trim()
      if (!query) return { status: 'error', summary: 'query 为空' }

      try {
        // v14.8: 惰性加载（同 subagentTools — 顶层 import 会经 V4UnifiedRuntime 拉到 @/store 链）
        const { runSubagent } = await import('../../subagent/SubagentService')
        const focus = String(args.focus || '').trim()
        const topK = Math.min(20, Math.max(1, Number(args.topK) || 5))
        const taskMessage = [
          `知识库分析任务: ${query}`,
          focus ? `关注侧面: ${focus}` : '',
          `检索建议: 先按主题做一次 kb_search（topK ${topK}），再变换 1-2 个相关检索词补充搜索；` +
            '对命中片段中高相关度的文件用 read_file 读取全文深入。',
          '输出要求（≤8000字符）: 按主题归纳要点、标注每个结论的来源文件名、提取关键设定/数据/时间线、' +
            '指出文件间的冲突或空白。若知识库无相关内容，如实说明。',
        ].filter(Boolean).join('\n')
        // 会话 key 固定为 kb-analyze — subagent_ask 可按此追问（须传相同文件路径，此处为知识库分析场景）
        // v14.8 审查修复(P2): key 加 kb:: 前缀——与 analyze_file 的 ${projectId}::${filePath} 同构，
        // 若项目存在名为 kb-analyze 的文件会会话池碰撞串到错误上下文
        // v14.9(审计): key 纳入查询指纹——原固定 key 使同项目不同主题的 kb_analyze 复用同一会话
        // 历史（第二次带着第一次的任务与检索结果运行，分析互相污染）；同查询文本可复用追问
        const result = await runSubagent({
          role: 'analyze',
          projectId: ctx.projectId,
          configId: ctx.configId,
          userMessage: taskMessage,
          signal: ctx.signal,
          sessionKey: `${ctx.projectId ?? 'global'}::kb::kb-analyze::${query.slice(0, 40).replace(/\s+/g, '_') || 'empty'}`,
        })

        return {
          status: result.success ? 'success' : 'error',
          summary: result.success
            ? `知识库分析完成: ${query}（子代理 ${result.usage?.calls ?? 1} 次调用）`
            : `知识库分析失败: ${query}`,
          detail: result.text.slice(0, MAX_DETAIL_CHARS_KB_ANALYZE),
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `知识库分析异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },

  {
    schema: {
      name: 'kb_append_file',
      description:
        '追加内容到知识库文件。新建用 create_file("../knowledge_base/files/"), 追加后自动重建索引（无需再调 kb_index_file）。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件 ID' },
          content: { type: 'string', description: '要追加的内容' },
        },
        required: ['file_id', 'content'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        await kbService.append(args.file_id as string, args.content as string, ctx.configId)
        return { status: 'success', summary: '已追加到知识库文件' }
      } catch (e) {
        return { status: 'error', summary: `追加知识库文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'kb_index_file',
      description:
        '对知识库文件建立语义搜索索引。新建文件（create_file 到 knowledge_base/files/）后索引；kb_append_file 追加后已自动重建索引，无需再调。',
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
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        const fileId = String(args.file_id || '')
        const result = await kbService.index(fileId, ctx.configId)
        // v16.0.1(审计 S3): 如实报告——embedding 部分失败不再报"索引完成"假成功
        // v16.0.2(D-3): 全失败（failed === chunkCount，含 chunkCount=0 空文件）→ status:'error'
        // ——原实现全失败仍报 success（"索引完成 0 个片段，N 个失败"），模型会认为索引成功
        const failed = (result as { failedCount?: number })?.failedCount || 0
        const chunkCount = (result as { chunkCount?: number })?.chunkCount ?? 0
        if (failed > 0 && chunkCount === 0) {
          return {
            status: 'error',
            summary: `索引失败: ${failed} 个片段全部 embedding 失败（请检查模型配置/网络后重新索引）`,
          }
        }
        return {
          status: 'success',
          summary: failed > 0
            ? `索引完成 ${chunkCount} 个片段，${failed} 个失败（embedding 失败，请检查模型配置/网络后重新索引）`
            : `索引完成: ${chunkCount} 个片段`,
        }
      } catch (e) {
        return { status: 'error', summary: `索引失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },
]
