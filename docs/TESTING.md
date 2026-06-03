# 测试

## 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # watch 模式
npx vitest run --coverage  # 生成覆盖率报告
```

## 测试结构

```
src/agent/__tests__/                  — Agent 引擎测试
  ├── V4AgentRuntime.integration.test.ts   ← 新增：OpenAI 协议集成测试（25 用例）
  ├── V4AnthropicRuntime.integration.test.ts ← 新增：Anthropic 协议集成测试（18 用例）
  ├── V4Integration.test.ts            — V4 集成冒烟测试（系统提示词/安全围栏/ToolRegistry）
  ├── V4Simulation.test.ts             — V4 仿真测试（简单任务/多工具/多轮对话）
  ├── ContextCompressor.test.ts        — 上下文压缩
  ├── AIAssistantFunctional.test.ts    — AI 助手功能测试
  ├── FunctionalSmoke.test.ts          — 功能冒烟
  ├── UploadReadEditWorkflow.test.ts   — 上传→读取→编辑 工作流
  └── taskDetection.test.ts            — 任务检测

electron/ipc/__tests__/               — IPC handler 测试
  ├── fileToolHandlers.test.ts         — 文件工具（真实文件系统）
  ├── aiHandlers.test.ts               — AI handler
  ├── browserHandlers.test.ts          — 浏览器 handler
  ├── httpHandlers.test.ts             — HTTP handler
  ├── ssrfGuard.test.ts               — SSRF 防护
  ├── schemaValidation.test.ts         — Schema 校验
  └── utils.test.ts                    — 工具函数

src/                                  — 单元测试（与源码同目录）
  ├── services/__tests__/
  ├── components/ai/AIChatWindow/__tests__/
  ├── utils/__tests__/
  └── types/fileOps/__tests__/
```

## Agent 运行时集成测试

### 是什么

用 mock API 驱动**真实**的 `V4AgentRuntime` + `ToolRegistry` + `SecurityFence` + `ContextCompressor`，验证整个 while 循环的逻辑正确性。零 API 费用，每次提交秒级完成。

### 与 CLI 仿真测试的区别

| | CLI 仿真测试 (`scripts/*-sim-*.mjs`) | Agent 集成测试 (`vitest`) |
|---|---|---|
| 运行方式 | `node scripts/openai-sim-test.mjs` | `npx vitest run` |
| API | 直连 DeepSeek 真实 API（消耗 token） | mock，零费用 |
| Runtime | 脚本内手写简化版 while 循环 | 真实的 `V4AgentRuntime` 类 |
| 工具 | 脚本内手写简化版 | 真实的 `ToolRegistry` + 37 工具 |
| 安全围栏 | 无 | 真实的 `V4SecurityFence` |
| 断言 | 人工观察输出 | 自动化 assert |
| 用途 | 验证模型行为（理解提示词吗？输出质量好吗？） | 验证代码逻辑（循环死锁吗？压缩损坏上下文吗？安全拦截生效吗？） |

两者互补，不冲突。

### 覆盖场景

**V4AgentRuntime（OpenAI 协议）** — `V4AgentRuntime.integration.test.ts`：
- 上下文压缩（低窗口触发、H10 保护最近消息）
- 渐进工具展开（iteration 3+ 追加扩展工具、最后一轮移除工具强制文本）
- Abort 处理（API 前/工具中/controller 信号）
- API 瞬态错误重试（timeout/429/503 → 1次重试，认证错误不重试）
- 空响应兜底（H5：模型返回空文本+无工具 → 注入提示重启）
- 轮次提示注入（iteration 3+ "第N轮"提示、最后轮次 "[最后轮次]"）
- 只读工具并行 + 写入工具串行 执行排序
- 工具超时 Promise.race 机制 + JSON 解析失败拦截
- ContractExecutor 输出过滤（iteration>1 截断到 500 字）
- SecurityFence 集成（系统路径硬拦截、JSON 格式校验）
- 端到端角色创建工作流

**V4AnthropicRuntime（Anthropic 协议）** — `V4AnthropicRuntime.integration.test.ts`：
- 流式纯文本响应、空响应补充提示重启
- 流式 tool_use（单个/多个并行/多轮往返）
- 消息格式转换（system→顶层参数、tools→input_schema、tool_results 合并）
- Abort 处理（流前/工具中/controller 信号）
- 上下文压缩
- 工具超时 + 错误状态传播
- API 异常捕获 + 部分结果保留
- 端到端角色创建工作流

## 测试策略

### 优先级
1. **安全模块**（SSRF、密钥处理、沙箱）— 必须有回归测试
2. **Agent 运行时**（Runtime 主循环、工具执行、安全围栏）— 核心逻辑
3. **IPC handlers**（文件操作、HTTP）— 安全边界
4. **服务层**（chapterService、characterService）— 业务逻辑

### 模式
- **纯函数**：标准单元测试（`describe`/`it`/`expect`）
- **IPC handler**：真实文件系统集成测试（参考 `fileToolHandlers.test.ts`）
- **Agent 集成**：mock AI 服务 + 控制响应（参考 `V4AgentRuntime.integration.test.ts`）

### Mock 基础设施
- `tests/mocks/electron.ts` — 所有 IPC 服务的 mock
- `tests/utils/testHelpers.ts` — `createDeferred()`、`mockProjectPath()`、`spyConsole()`

## 覆盖率

目标目录：`src/agent/` + `src/services/` + `src/utils/` + `src/store/` + `electron/ipc/`

基线阈值 (vitest.config.ts):
- statements: 10%
- branches: 8%
- functions: 10%
- lines: 10%

## CI/CD

`.github/workflows/ci.yml`：
1. `typecheck` — `tsc --noEmit`
2. `test` — `vitest run --coverage`

每次 push 到 `main` 和 PR 时自动运行。
