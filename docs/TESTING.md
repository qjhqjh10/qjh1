# 测试

## 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # watch 模式
npx vitest run --coverage  # 生成覆盖率报告
```

## 测试结构

```
src/agent/__tests__/        — Agent 引擎测试（11 文件）
  ├── PolicyEngine.test.ts
  ├── CircuitBreaker.test.ts
  ├── AgentStateMachine.test.ts
  └── intentAnalyzer.test.ts  ← 新增

electron/ipc/__tests__/     — IPC handler 测试（7 文件）
  ├── fileToolHandlers.test.ts  ← 最佳测试（405 行，真实文件系统）
  ├── ssrfGuard.test.ts        ← 新增（21 测试）
  ├── httpHandlers.test.ts     ← 新增
  └── browserHandlers.test.ts  ← 新增

tests/                       — 共享测试基础设施
  ├── mocks/electron.ts      — 完整 IPC mock（24 服务）
  └── utils/testHelpers.ts   — 工具函数

src + components/            — 单元测试
  ├── services/__tests__/
  ├── store/__tests__/
  ├── components/__tests__/
  └── utils/__tests__/
```

## 测试策略

### 优先级
1. **安全模块**（SSRF、密钥处理、沙箱）— 必须有回归测试
2. **Agent 引擎**（Runtime、FSM、工具执行）— 核心逻辑
3. **IPC handlers**（文件操作、HTTP）— 安全边界
4. **服务层**（chapterService、characterService）— 业务逻辑

### 模式
- **纯函数**：标准单元测试（`describe`/`it`/`expect`）
- **IPC handler**：真实文件系统集成测试（参考 `fileToolHandlers.test.ts`）
- **Agent 集成**：mock AI 服务 + 控制响应（参考 `E2EFlow.test.ts`）

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
