// ── Chapter Collab Store (v16.1.0) ──
// AI 协作改写（章节创作界面 × AI 写作助手）的会话级状态。
//
// 设计要点:
//   - 独立 store（非 useStore/useAgentStore）——useStore 带 persist 会序列化全文快照
//     （可到数十 KB，纯浪费且动迁移链）；useAgentStore 语义是"agent 运行态"（isolatedStore 跳过），
//     混入"编辑器协作态"破坏语义。独立 store 可被 agent/ 与 components/ 干净 import，无模块环。
//   - 纯内存（无 persist）：会话级状态，切章/取消关联/新建对话时显式重置。
//   - 权威源 = 编辑器内存态（text 字段随编辑器 onChange 实时同步），磁盘文件只是落盘用途。
//   - 一次性 action 通道（pendingAction，仿 pendingMessage/insertionAction）：写入方 agent 工具
//     （editor_rewrite executor），消费方 ChapterWritingPage effect，消费后置 null 防重放。

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface CollabAction {
  chapterId: string
  anchor: string
  newText: string
}

export interface ChapterCollabState {
  /** 关联模式开关（true 且 chapterId 匹配才算"关联中"） */
  active: boolean
  /** 当前关联章节 id（≠编辑器当前章节即视为失效） */
  chapterId: string | null
  /** 最近 3 版锚点，index 0 = 最新（降级匹配链） */
  anchorStack: string[]
  /** 特效进行中（编辑器 setEditable(false) 的镜像） */
  streaming: boolean
  /** 每次成功改写 +1，注入块内提示模型 */
  chapterVersion: number
  /** 编辑器内存态权威源的快照（纯文本，stripHtml 后） */
  text: string
  /** 右键发送时选中的原文（建立关联的初始锚） */
  selectionAnchor: string | null
  /** 一次性 action 通道（仿 pendingMessage/insertionAction） */
  pendingAction: CollabAction | null
  /** v16.1.0(审查修复 D1): 最近一次改写的真实应用结果——由渲染层消费成功后写入，
   *  AIChatWindow 据此显示 ✅/⚠️ 而非"调用过工具即 ✅"。null=无结果 */
  lastRewriteApplied: boolean | null
  /** v16.2.0: AI 直接改文件后是否提示「刷新本章」——文件编辑通知与编辑器内容不一致时置 true */
  needsReload: boolean

  // ── actions ──
  /** 右键「发送到 AI」建立关联：记录锚 + 权威源快照 */
  attach: (chapterId: string, anchorText: string, fullTextPlain: string) => void
  /** 取消关联（chip ✕）：清空全部状态 */
  detach: () => void
  /** 编辑器 onChange 实时同步（权威源） */
  setText: (text: string) => void
  /** 改写成功后更新锚（unshift 新锚，超 3 截断）+ 版本 +1 */
  pushAnchor: (newAnchor: string) => void
  /** 特效状态镜像 */
  setStreaming: (v: boolean) => void
  /** 一次性通道写入（editor_rewrite executor 调用） */
  dispatchRewrite: (action: CollabAction) => void
  /** 幂等消费（ChapterWritingPage effect 调用） */
  consumeAction: () => CollabAction | null
  /** 记录最近一次改写应用结果（true=成功应用, false=锚失效等失败） */
  setLastRewriteApplied: (applied: boolean) => void
  /** v16.2.0: 标记/清除「AI 直接改文件 → 提示刷新」 */
  setNeedsReload: (v: boolean) => void
}const initialCollab = {
  active: false,
  chapterId: null as string | null,
  anchorStack: [] as string[],
  streaming: false,
  chapterVersion: 0,
  text: '',
  selectionAnchor: null as string | null,
  pendingAction: null as CollabAction | null,
  lastRewriteApplied: null as boolean | null,
  needsReload: false,
}

export const useChapterCollabStore = create<ChapterCollabState>()(
  immer((set) => ({
    ...initialCollab,

    attach: (chapterId, anchorText, fullTextPlain) => set((s) => {
      s.active = true
      s.chapterId = chapterId
      s.anchorStack = anchorText ? [anchorText] : []
      s.streaming = false
      s.chapterVersion = 0
      s.text = fullTextPlain || ''
      s.selectionAnchor = anchorText || null
      s.pendingAction = null
      // v16.3.0(审计 M2 修复): attach 重置改写结果——原只 detach 重置，
      // 连续关联场景下上一 run 的 true 残留 → 新 run 锚点校验失败（未应用）仍误报"✅ 已应用"
      s.lastRewriteApplied = null
    }),

    detach: () => set((s) => {
      s.active = false
      s.chapterId = null
      s.anchorStack = []
      s.streaming = false
      s.chapterVersion = 0
      s.text = ''
      s.selectionAnchor = null
      s.pendingAction = null
      s.lastRewriteApplied = null
      s.needsReload = false
    }),

    setText: (text) => set((s) => { s.text = text }),

    pushAnchor: (newAnchor) => set((s) => {
      if (!newAnchor) return
      // 防重复：与最新锚相同则只更新版本号
      if (s.anchorStack[0] !== newAnchor) {
        s.anchorStack = [newAnchor, ...s.anchorStack].slice(0, 3)
      }
      s.chapterVersion += 1
    }),

    setStreaming: (v) => set((s) => { s.streaming = v }),

    dispatchRewrite: (action) => set((s) => { s.pendingAction = action }),

    setLastRewriteApplied: (applied) => set((s) => { s.lastRewriteApplied = applied }),

    setNeedsReload: (v) => set((s) => { s.needsReload = v }),

    consumeAction: () => consumeCollabAction(),
  })),
)

/** 幂等消费（模块级函数——避免 store 自引用类型推断循环） */
function consumeCollabAction(): CollabAction | null {
  const state = useChapterCollabStore.getState()
  const action: CollabAction | null = state.pendingAction
  if (action) {
    useChapterCollabStore.setState((s) => { s.pendingAction = null })
  }
  return action
}
