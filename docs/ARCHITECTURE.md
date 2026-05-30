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
│  运行时/FSM/工具/上下文/思考 (63 文件)        │
├─────────────────────────────────────────────┤
│  IPC 层 (electron/ipc/)                      │
│  19 handler 模块, 103 通道                    │
│  SSRF 防护: ssrfGuard.ts (共享模块)          │
├─────────────────────────────────────────────┤
│  Electron Main Process (electron/main.ts)    │
│  窗口管理 + 安全配置                          │
└─────────────────────────────────────────────┘
```

## Agent 引擎

### 运行时 (`src/agent/runtime/`)
- `AgentRuntime.ts` — 核心编排器
- `AgentEventEmitter.ts` — 事件总线
- `intentAnalyzer.ts` — 意图分析（纯函数，零依赖）
- `HallucinationDetector.ts` — 幻觉检测
- `ToolResultPersister.ts` — 工具结果持久化

### 状态机 (`src/agent/state/`)
- 11 个阶段，44 条转换规则
- 守卫函数保护关键转换

### 工具系统 (`src/agent/tools/`)
- `ToolRegistry.ts` — 工具注册表（26 工具）
- `definitions/` — 14 个工具定义文件
- 权限：AUTO / READ_ASK / PROJECT_ASK / DANGEROUS_ASK

### 上下文 (`src/agent/context/`)
- `ContextAssembler.ts` — 提供者架构（11 内容提供者）
- `FileRouter.ts` — 文件路由
- `ProgressiveCompressor.ts` — 消息压缩

### 安全子系统
- `CircuitBreaker.ts` — 3 态熔断器
- `PolicyEngine.ts` — 否认优先策略引擎
- `CredentialBroker.ts` — API 密钥能力句柄
- `GatekeeperRunner.ts` — 硬验证门控
- `PlanEnforcer.ts` — 计划强制执行

## 数据目录

```
projects/         — 用户项目（gitignored）
knowledge_base/   — 知识库文件 + embedding
scene_templates/  — 场景模板
style_templates/  — 风格模板
agent-sessions/   — Agent 会话数据（gitignored）
```
