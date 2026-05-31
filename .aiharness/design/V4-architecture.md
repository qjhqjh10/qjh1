# 青剑 V4 架构设计方案

## 背景

- AI 模型: DeepSeek V4 Pro，**1M context window**
- V3 现状: TaskPipeline(分类+规划) → AgentRuntime(FSM执行) 两段式架构
- 对标: Claude Code 单循环架构（模型统一推理→工具调用→继续推理）
- 目标: AI 写作助手像 Claude 一样智能——聊天和任务无缝切换，出错自行修正

---

## 一、架构对比

```
V3 (当前):
┌──────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────┐
│ 用户输入  │ → │ TaskPipeline  │ → │ AgentRuntime   │ → │ 结果   │
│          │   │ (1次LLM调用)  │   │ (N次LLM调用)   │   │        │
│          │   │ 分类+意图+方案 │   │ FSM循环+12道门  │   │        │
└──────────┘   └──────────────┘   └───────────────┘   └────────┘
               独立阶段，单独API   独立阶段，多数API
               正则降级fallback    PlanEnforcer限制工具

V4 (目标):
┌──────────┐   ┌────────────────────────────────────────────┐   ┌────────┐
│ 用户输入  │ → │           Unified Agent Loop               │ → │ 结果   │
│          │   │                                            │   │        │
│          │   │  ① 组装上下文 (system + project + history)  │   │        │
│          │   │  ② while (未完成):                         │   │        │
│          │   │      API调用(全量工具) → 执行 → 结果注入    │   │        │
│          │   │  ③ 模型自行: 理解意图、选工具、纠错、回复   │   │        │
│          │   │  ④ 安全围栏: 仅拦截危险操作                 │   │        │
│          │   │                                            │   │        │
│          │   │  一次推理完成全部: 分类+规划+执行+反思       │   │        │
└──────────┘   └────────────────────────────────────────────┘   └────────┘
               模型是唯一决策者，代码只是工具执行器+安全围栏
```

## 二、1M 上下文带来的设计自由

### 不再需要的东西

| V3 组件 | 为什么可以移除 | 1M 上下文的替代 |
|---------|---------------|----------------|
| TaskPipeline (分类+规划) | 模型推理时自然判断 | 不需要单独的 API 调用 |
| V2-6 ToolSubsetRouter | 全量工具 Schema ~5K tokens | 只占 1M 的 0.5%，无需剪裁 |
| ProgressiveCompressor (5级压缩) | 1M 足够放下几乎所有内容 | 可简化为单级"超限提醒" |
| ReflectionEngine | 模型自己读错误信息→自然换策略 | 错误注入上下文即可 |
| HallucinationDetector | 模型能力强，幻觉减少 | 保留但降级为可选 |
| PlanEnforcer | 模型灵活选择工具 | 保留但仅拦截 delete/shell |

### 可以增强的东西

| 能力 | V3 | V4 (1M 上下文) |
|------|-----|---------------|
| 项目上下文 | 按 priority 截断 50K tokens | 可注入完整大纲+所有角色卡+细纲 |
| 对话历史 | 5级压缩，接近上限时裁剪 | 保留完整对话历史，几乎不需要压缩 |
| 知识库 | 语义搜索返回前3条 | 可注入更多搜索结果 |
| 工具输出 | ContractExecutor 去 detail | 保留更多 detail，模型能利用 |
| 写作上下文 | 摘要文件替代读正文 | 可直接读多章正文，上下文足够 |

---

## 三、V4 核心架构

### 3.1 Unified Agent Loop

```
async function unifiedAgentLoop(userMessage, context, history, tools) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },        // 写作助手规则
    ...buildProjectContext(context),                         // 项目文件
    ...history,                                              // 完整对话历史
    { role: 'user', content: userMessage },                  // 用户输入
  ]

  let iteration = 0
  const MAX_ITERATIONS = 30
  const abortController = new AbortController()

  while (iteration < MAX_ITERATIONS) {
    iteration++

    // ① API 调用 — 全量工具，模型自行决策
    const response = await aiService.chatWithTools(messages, configId, projectId, tools)

    // ② 安全层 — 仅拦截危险操作
    const safeToolCalls = securityCheck(response.toolCalls)

    // ③ 无工具调用 → 模型完成，回复用户
    if (!safeToolCalls || safeToolCalls.length === 0) {
      return { text: response.text, phase: 'done', ... }
    }

    // ④ 执行工具 — 并行安全工具，顺序写入工具
    for (const tc of safeToolCalls) {
      const result = await executeToolWithSafety(tc, context)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
    }

    // ⑤ 模型读取工具结果，自行决定下一步
    // （无需 PlanEnforcer、ReflectionEngine — 模型自己会判断）
  }

  // 达到最大迭代 → 强制模型回复
  const finalResponse = await aiService.chat(messages, configId)
  return { text: finalResponse, phase: 'done', ... }
}
```

### 3.2 精简后的组件清单

**保留（核心安全 + 质量）:**

| 组件 | 角色 | 改动 |
|------|------|------|
| CircuitBreaker | API 连续失败→熔断 | 不变 |
| CredentialBroker | 能力句柄隔离凭据 | 不变 |
| PolicyEngine | deny-first 权限 | 不变 |
| ConstraintEngine | 架构约束 | 不变 |
| AuditTrail | 完整审计 | 不变 |
| BudgetManager | Token 追踪（简化） | 移除 5 级压缩，改为单级提醒 |
| ContractExecutor | 工具结果去 detail | 保留，但策略放宽 |
| CheckpointManager | 长任务断点 | 不变 |
| LearningEngine | 跨会话学习 | 不变 |
| GCAgent | 小说健康扫描 | 不变 |
| EvaluationPipeline | 事后评估 | 间隔从 5 次延长到 20 次 |

**移除（模型能力已覆盖）:**

| 组件 | 替代方案 |
|------|---------|
| TaskPipeline | 模型推理时自然判断 |
| AgentOrchestrator | 模型自己规划，不需要子Agent编排 |
| PlanEnforcer | 仅 PolicyEngine 拦截 delete/shell |
| ReflectionEngine | 错误信息直接给模型 |
| HallucinationDetector | 现代模型幻觉率低（可选保留） |
| ProgressiveCompressor | 1M 上下文不需要 |
| ToolSubsetRouter | 全量工具永远可见 |
| AgentStateMachine | 简化为 while 循环 + iteration 计数 |

### 3.3 安全围栏 — 3 层而非 12 层

```
工具调用
  ├─ 层 1: CircuitBreaker.beforeCall()   ← API 故障保护
  ├─ 层 2: PolicyEngine.evaluate()        ← 权限 (仅拦截 DANGEROUS_ASK)
  │         · delete_file → 需用户确认
  │         · shell_exec → 拒绝
  │         · 其余全部 → 允许
  └─ 层 3: ConstraintEngine.check()       ← 项目隔离
            · 路径必须在项目目录内
            · 不修改系统文件
```

## 四、System Prompt 设计

核心原则: **像 Claude Code 一样，一份 prompt 同时定义"你是谁"和"你可以调用什么工具"**。

```markdown
你是"青剑"AI写作助手，运行在 DeepSeek V4 Pro 上。

## 核心身份
你是小说创作者的智能搭档。你的任务是在自然对话中帮助用户完成写作。
你可以在聊天和任务执行之间无缝切换——自己判断什么时候该回复，
什么时候该调用工具。

## 行为准则

1. **你决定何时用工具**。用户的每句话你都自己判断：
   - "你好" → 闲聊，直接回复
   - "列出角色" → 调 list_directory
   - "写第3章" → 先读大纲/角色/细纲 → 再写章节

2. **犯错是正常的，修正它**。如果工具调用失败：
   - 读错误信息 → 判断原因 → 换方法重试
   - 文件不存在? 先 list_directory 看看有什么
   - 路径不对? 换路径再试
   - 连续失败? 告诉用户你遇到了什么问题

3. **在思考中规划，不在代码块中**。
   - 做复杂任务前，在回复中用文字简述你的计划
   - 不需要 ```json 格式 —— 你是写给用户看的，不是给代码解析的

4. **工具调用是透明但低摩擦的**。
   - 用户不需要"批准每一步" —— 批准任务本身就够了
   - 但删除文件、删除项目前必须明确确认
   - 写入文件前确保你读过原文件

5. **保持对话感**。
   - 即使在执行工具，也要用自然的语言告诉用户你在做什么
   - "好，让我先看看大纲..." → 调用 read_file
   - "找到了，现在来写第3章..." → 调用 create_file

## 可用工具
[全部 37 个工具的完整 schema]

## 文件结构
[项目文件结构说明]
```

### 关键设计决策

**1. 不要求计划 JSON**

V3 的错误：
```
AI 必须输出: ```plan { "steps": [...], "neededTools": [...] }```
→ 然后代码解析 JSON → 检查格式 → 验证 → 展示 PlanCard
```

V4 的设计：
```
AI 自然输出: "好的，我需要先读大纲和角色设定，然后写第3章。开始吧。"
→ 然后直接调用 read_file(...)
```

模型在 reasoning 中规划步骤，代码不强制结构化输出。这让模型更灵活，不会因为 JSON 格式错误而被惩罚。

**2. 不展示 PlanCard**

V3: 复杂任务 → 弹出审批卡片 → 等用户点击
V4: 任务开始 → 模型简述计划 → 直接执行 → 用户随时可以打断

只有在遇到 delete_file、delete_project 等危险操作时才弹出确认。

**3. 错误处理交给模型**

V3:
```
工具失败 → ReflectionEngine.reflect() → 分析错误模式
→ buildReflectionInject() → 注入修正指令 → 模型执行
```

V4:
```
工具失败 → 错误信息直接加入 messages
→ 模型自己读 → 自己决定下一步
```

Claude Code 证明这是最有效的纠错方式——模型对错误的理解比正则分析精确得多。

---

## 五、实施路径

### 阶段 1: 核心循环 (3天)

- 新建 `src/agent/V4/UnifiedAgent.ts` — 单一 while 循环
- 简化 `AgentChatBridge.ts` — 移除 Pipeline 初始化
- 更新 system prompt — 移除 JSON 格式要求

### 阶段 2: 清理旧代码 (2天)

- 移除 `TaskPipeline.ts`、`AgentOrchestrator.ts`
- 移除 `PlanEnforcer.ts`、`ReflectionEngine.ts`
- 简化 `BudgetManager.ts` — 移除 ProgressiveCompressor
- 移除 `ToolSubsetRouter.ts` — 全量工具
- 移除 `HallucinationDetector.ts` (或改为可选)

### 阶段 3: UI 适配 (1天)

- 移除 `PlanCard` — 不需要审批卡片
- 简化 `BatchApprovalPanel` — 仅展示危险操作
- 简化 `AgentStatusBar` — 减少状态显示

### 阶段 4: 测试 (2天)

- 更新测试文件
- 端到端测试：聊天、简单任务、复杂任务、错误恢复
- 1M 上下文压力测试

---

## 六、风险与保留

### 保留的 V3 组件

| 组件 | 保留原因 |
|------|---------|
| CircuitBreaker | 防止 API 配额耗尽 |
| CredentialBroker | 安全隔离 |
| PolicyEngine | 危险操作必须拦截 |
| AuditTrail | 可追溯 |
| CheckpointManager | 长任务恢复 |
| LearningEngine | 差异化能力 |
| ContractExecutor | Context 管理（1M 也不能浪费） |

### 风险缓解

| 风险 | 缓解 |
|------|------|
| 模型过度自由导致误删 | PolicyEngine 拦截 delete，需用户确认 |
| 1M 上下文 API 响应慢 | CircuitBreaker + 超时保护 |
| 对话历史无限膨胀 | BudgetManager 保留简单阈值提醒 |
| 模型幻觉"已创建"但没调工具 | 保留轻量 post-hoc 检查（不阻断） |

---

## 七、关键代码量对比

| 指标 | V3 | V4 | 变化 |
|------|-----|-----|------|
| Agent 核心文件 | 80+ | ~40 | -50% |
| 安全围栏层数 | 12 | 3 | -75% |
| Pipeline 文件 | 6 | 0 | 移除 |
| Agent 循环代码 | ~2000行(FSM) | ~200行(while) | -90% |
| System Prompt | 692行 + 单独分类Prompt | ~300行(统一) | -60% |
| UI 审批组件 | PlanCard + BatchPanel | 仅危险操作确认 | -80% |
