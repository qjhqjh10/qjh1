// ── 提示词模板类型定义 ──

/** 场景识别规则 — 定义一个场景类型及其触发条件 */
export interface SceneRule {
  id: string
  name: string           // 场景名称，如"恋爱场景""战斗场景""对话场景"等
  triggerCondition: string // 触发条件描述，帮助 AI 识别该场景
}

/** 提示词模板 — 管理分析/改写提示词的完整配置 */
export interface RewritePromptTemplate {
  id: string
  name: string                     // 模板名称
  systemPrompt: string             // 系统破甲（system prompt 级别的破甲/角色设定）
  sceneRules: SceneRule[]          // 场景识别规则列表
  universalGuidance: string        // 改写规则 — 通用指导（适用于所有场景）
  sceneGuidance: Record<string, string> // 改写规则 — 场景特定指导，key=sceneId, value=改写指导文本
  createdAt: string
  updatedAt: string
}

/** 创建模板时的输入（不含自动生成字段） */
export type CreatePromptTemplateInput = Omit<RewritePromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
