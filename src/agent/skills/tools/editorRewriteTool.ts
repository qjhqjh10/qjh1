// ── Editor Rewrite Tool (v16.1.0) ──
// 章节协作改写的渲染层驱动工具——AI 改写当前关联章节的锚点段落，直接应用到编辑器（不经文件系统）。
//
// 设计:
//   - 仅「已关联:第N章」激活时可用（chapterCollabStore.active）
//   - executor 校验参数 → dispatchRewrite 写入一次性通道 → ChapterWritingPage effect 消费
//   - 不等待特效完成（特效 ~1-2s，等待会让 agent 轮空转）——结果确认走 lastRewriteApplied 回链
//   - 锚点失效时 executor 用 collab.text（权威源）定位，失败返回错误引导 AI search_content 重试
//   - 不落盘、不写文件 → 与只读围栏互补（围栏拦写工具，此工具是唯一改写通道）

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'
import { locateAnchor } from '@/utils/anchorMatch'

// v16.1.0: 惰性 import 模式（同 subagentTools getSettingsStore——避免模块环与 vitest mock 竞态）
let collabStorePromise: Promise<typeof import('@/store/chapterCollabStore')> | null = null
function getCollabStore(): Promise<typeof import('@/store/chapterCollabStore')> {
  if (!collabStorePromise) collabStorePromise = import('@/store/chapterCollabStore')
  return collabStorePromise
}

export const editorRewriteTools: ToolDefinition[] = [
  {
    schema: {
      name: 'editor_rewrite',
      description:
        '改写当前关联章节中锚点对应的段落——直接应用到你正在编辑的编辑器（特效动画），不经文件系统。' +
        '仅当聊天窗「已关联:第N章」激活时可用。' +
        '用法：anchor 必须是章节协作参考块中标明的锚点（原样引用，不得增删字）；newText 为改写后的完整段落。' +
        '若在注入的章节全文中找不到该锚点（内容已变化），先用 search_content 在项目 chapters/ 中定位当前文本，' +
        '再以定位结果作为 anchor 调用。改写后锚点自动更新，后续轮次使用新锚点。',
      parameters: {
        type: 'object',
        required: ['anchor', 'newText'],
        properties: {
          anchor: { type: 'string', description: '关联锚点文本（在注入的章节全文末尾标注）——必须原样引用，不得改动' },
          newText: { type: 'string', description: '替换后的新段落文本（≤5000 字符）' },
        },
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { useChapterCollabStore } = await getCollabStore()
      const collab = useChapterCollabStore.getState()
      if (!collab.active || !collab.chapterId) {
        return {
          status: 'error',
          summary: '未启用章节协作改写。请在编辑器选中文字 → 右键「发送到 AI 写作助手」建立关联后再试。',
        }
      }

      const anchor = String(args.anchor ?? '').trim()
      const newText = String(args.newText ?? '').trim()
      if (!anchor || !newText) {
        return { status: 'error', summary: '参数缺失: anchor 与 newText 必填' }
      }
      if (anchor === newText) {
        return { status: 'error', summary: 'newText 与 anchor 相同，未发生改写。请实际修改内容后再调用。' }
      }
      if (newText.length > 5000) {
        return { status: 'error', summary: `newText 过长（${newText.length} 字符，上限 5000）。请缩小改写范围或拆分调用。` }
      }

      // 锚点预校验（基于编辑器内存态权威源，防错改）
      const anchorStack = collab.anchorStack.length > 0 ? collab.anchorStack : [anchor]
      const loc = collab.text ? locateAnchor(collab.text, anchorStack) : null
      if (!loc || !loc.matchedBy) {
        return {
          status: 'error',
          summary: '锚点在当前编辑器内容中未找到。请用 search_content 在项目 chapters/ 目录定位当前文本，再以定位结果作为 anchor 重试。',
        }
      }

      // 写入一次性通道 → 渲染层消费
      useChapterCollabStore.getState().dispatchRewrite({ chapterId: collab.chapterId, anchor, newText })
      return {
        status: 'success',
        summary: `已提交编辑器改写（${newText.length} 字符，锚点匹配方式: ${loc.matchedBy}）。特效播放中，用户可直接看到结果。`,
      }
    },
  },
]
