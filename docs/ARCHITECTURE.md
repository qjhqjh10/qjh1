# 架构

## 技术栈

- **桌面框架**：Electron 29
- **前端**：React 18 + TypeScript 5 + Zustand + TipTap
- **样式**：Tailwind CSS 3 + Framer Motion
- **构建**：electron-vite + electron-builder
- **测试**：Vitest + @testing-library/react

## 分层架构

```
┌─────────────────────────────────────────────┐
│  UI 层 (src/components/)                     │
│  12 路由页面 + 20 共享组件 + AI 聊天窗口      │
├─────────────────────────────────────────────┤
│  服务层 (src/services/)                      │
│  IPC 封装 + 业务协调 (14 文件)               │
│  electronBridge.ts — 类型安全聚合 (21 服务)  │
├─────────────────────────────────────────────┤
│  Agent 引擎 (src/agent/)                     │
│  V4 Runtime — 双协议 (OpenAI + Anthropic)    │
├─────────────────────────────────────────────┤
│  IPC 层 (electron/ipc/)                      │
│  19 handler 模块                                │
│  SSRF 防护: ssrfGuard.ts (共享模块)          │
├─────────────────────────────────────────────┤
│  Electron Main Process (electron/main.ts)    │
│  窗口管理 + 安全配置                          │
└─────────────────────────────────────────────┘
```

## Agent 引擎

### V4 运行时 (`src/agent/`)
V4 用**单一 while 循环**替代了 V3 的 13 态 FSM 及 8 个子系统（TaskPipeline/PlanEnforcer/ReflectionEngine/HallucinationDetector/BudgetManager/CheckpointManager/CircuitBreaker 等全部删除）。

- `V4AgentRuntime.ts` — OpenAI 协议核心编排器（request/response while 循环）
- `V4AnthropicRuntime.ts` — Anthropic 协议编排器（流式 content blocks 循环）
- `V4AgentChatBridge.ts` — OpenAI Bridge（整合 Runtime + SecurityFence + AuditTrail + LearningEngine）
- `V4AnthropicChatBridge.ts` — Anthropic Bridge（独立实现，共享依赖）
- `ChatBridgeInterface.ts` — 共享接口 + 协议工厂（根据配置自动选择）
- `V4SystemPrompt.ts` — 系统提示词 + 10 领域模块 + 动态选择
- `V4SecurityFence.ts` — 三层安全围栏（硬拦截 → JSON 校验 → 路径审批）
- `IntentClassifier.ts` — 意图分类器（chat/simple/complex + 要求数统计）

### 工具系统 (`src/agent/tools/`)
- `ToolRegistry.ts` — 工具注册表（38 工具，12 类别）
- `definitions/` — 12 个工具定义文件（file/kb/note/image/template/project/prompt/harness/http/browser/shell/lsp）
- 权限：AUTO / READ_ASK / PROJECT_ASK / DANGEROUS_ASK

### 上下文 (`src/agent/context/`)
- `ContextAssembler.ts` — 提供者架构（10 内容提供者，相关性评分，500K token 上限）
- `ContextCompressor.ts` — Claude 风格透明压缩
- `ContractExecutor.ts` — 工具结果过滤 + 渐进裁剪
- `FileCache.ts` — 共享文件读缓存
- `MemoryIndex.ts` — 全局项目文件索引

### 其他子系统
- `audit/AuditTrail.ts` — 飞行记录器（JSONL 事件日志）
- `learning/LearningEngine.ts` — AI 驱动学习（Agent 保存经验 → 注入提示词）
- `thinking/ThinkingEngine.ts` — 结构化思考协议
- `diagnostics/DiagnosticLogger.ts` — 诊断日志
- `store/AgentStore.ts` — Zustand Agent 运行时状态

## 数据目录

```
projects/         — 用户项目（gitignored）
knowledge_base/   — 知识库文件 + embedding
scene_templates/  — 场景模板
style_templates/  — 风格模板
agent-sessions/   — Agent 会话数据（gitignored）
```
