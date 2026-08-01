# 青剑 v14.1.1 交接说明（新会话开工文档）

> 本文件是给新会话的完整交接说明。开工前请完整阅读本文档 + `.aiharness/design/subagent-next-steps.md`（后续功能详细设计）。
> 生成时间：2026-08-01

## 一、项目概况

- **项目**：d:\3\novel-writing-app（AI写作软件—青剑，Electron 桌面应用）
- **版本**：v14.1.1（package.json / version_history.json / CLAUDE.md / 记忆文件已同步）
- **技术栈**：Electron 29 + React 18 + TypeScript 5 + Zustand + TipTap + DeepSeek API（Anthropic + OpenAI 双协议）
- **测试基线**：498 passed + 15 skipped（513 用例）；25 场景对话测试（真实 DeepSeek API）

## 二、本会话已完成的工作（v14.1.0 + v14.1.1）

### v14.1.0 — 任务清单运行时状态（修复"中途停下"）
- `src/agent/utils/taskExtraction.ts`：编号任务提取（1.2.3./①②③，四重门控宁漏勿错）
- V4UnifiedRuntime 完成检测重写：每轮注入 `[当前任务] X/Y 剩余:...`、清单未清空不接受"完成"声明、GLOBAL_DONE_RE 严格全局完成正则、进度声明解析（已完成3/6/第2项完成/任务X/Y完成）、继续性文本检测
- 分支 1B 修复（分析型请求短文本不再被误 nudge）；S6 修复（提示词"删了重写→delete+create"）
- 测试：taskExtraction 13 + V4TaskList 12；对话场景 S_MT2（5 任务压力，实测 5/5）

### v14.1.1 — 子 agent 上下文隔离（解决大文件撑爆上下文）
- **新增**：`src/agent/subagent/`（SubagentService 工厂 / SubagentPrompt 两套提示词 / createSubagentAdapter 双协议路由）+ `src/agent/skills/tools/subagentTools.ts`（analyze_file 只读委托 / edit_file_task 读写委托，29 工具）
- **核心机制**：子代理 = 独立 V4UnifiedRuntime（isolatedStore + 64K 窗口 + 独立审计），主 agent 只收结构化 detail
- **关键改动**：isolatedStore 隔离共享 AgentStore（9 处守卫）；SERIAL_TOOLS 串行防并发；per-tool 超时查表（子代理 300s）；_hasWriteCall 计入 edit_file_task；subAgentUsage 主/子 tokens 分开统计（贯穿 ToolResult→Runtime→Bridge→UI 页脚紫色显示）
- **实测**：S_SUB1 大文件分析委托（13950 字→结构化摘要）✓；S_SUB2 长文件 150 处全局替换（batch_replace）✓
- 测试：SubagentService 5 + subagentTools 7 + V4RuntimeSubagent 4

### 版本/交付
- 版本更新：version_history.json（14.1.0/14.1.1 两条）、package.json、CLAUDE.md、softwareGuide.ts、记忆文件×4、docs/×2、打包安全审查
- git：**commit 3bbc308 已完成，push 未完成**（网络无法连接 github.com，待重试 `git push origin main`）
- 版本更新界面修复：VersionTab.tsx "检查更新"改为语义化版本比较（修复远端版本较旧时误报）

## 三、后续计划（三个功能，详细设计见 subagent-next-steps.md）

1. **跨 run 续跑**（解决 30 轮/5 分钟硬上限）：任务状态持久化（taskProgress 附 assistant 消息→IndexedDB）→ 中断恢复注入 `[续跑] 上次中断于 X/Y`——复用现有任务清单机制，改动集中在 AIChatWindow + Bridge 透传，**建议先做**
2. **批量并行分析**：analyze_file 归回并行管线（isolatedStore 已保证并发安全）+ 续写/仿写流水线接入（参照 RewriteWorkspacePage 每批 4 章先例）
3. **验收子代理**：`verify_task` 只读子代理对照验收标准逐项判定产物

## 四、开工步骤（新会话必须遵守）

1. **读文件**：CLAUDE.md → `.aiharness/design/subagent-next-steps.md` → 相关源码（见下）
2. **备份**：改动前复制将被修改的文件到 `.aiharness/backups/2026-XX-XX_<名称>/`（参照既有 backups 目录模式；同名文件如 types.ts 注意分开命名）
3. **改动**：遵循"不引入新 npm 依赖、双协议兼容、宁漏勿错"约束
4. **验证**（全绿才算完成）：
   ```bash
   cd /d/3/novel-writing-app
   npx tsc --noEmit
   npx vitest run                      # 基线 498+15
   export AI_API_KEY=sk-261bfa6ba8174a1981c63cd289e44087
   npx tsx scripts/test-ai-conversation.mjs --scenario=<新增场景>   # 先跑新增
   npx tsx scripts/test-ai-conversation.mjs                        # 全 25 场景 ~25 分钟
   ```
5. **通过后删除备份**；版本更新走 `memory/version-control-rules.md` 两阶段流程；不要自动 push（等用户指令）

## 五、关键文件地图

| 区域 | 文件 | 说明 |
|------|------|------|
| 主循环 | `src/agent/runtime/V4UnifiedRuntime.ts` | 任务清单注入/完成检测/isolatedStore/subAgentUsage 累加 |
| 工具执行 | `src/agent/runtime/ToolExecutor.ts` | per-tool 超时/SERIAL_TOOLS/reportSubAgentUsage |
| 任务提取 | `src/agent/utils/taskExtraction.ts` | 四重门控提取 |
| 子代理 | `src/agent/subagent/` | Service/Prompt/Adapter 三件套 |
| 委托工具 | `src/agent/skills/tools/subagentTools.ts` | analyze_file/edit_file_task |
| UI | `src/components/ai/AIChatWindow/index.tsx` | 消息 usage 页脚（子代理紫色显示） |
| 版本界面 | `src/components/pages/settings/VersionTab.tsx` | 语义化版本比较 |
| 测试 | `src/agent/__tests__/`（5 个新文件）+ `scripts/test-ai-conversation.mjs` | 新场景 S_MT2/S_SUB1/S_SUB2 |
| 记忆 | `C:\Users\qjh36\.claude\projects\d--3\memory\` | software-architecture / file-reference 已更新至 v14.1.1 |

## 六、注意事项

- **API key**：`sk-261bfa6ba8174a1981c63cd289e44087`（deepseek-v4-flash；旧 key 已失效 401）
- **对话测试需真实 API**：单测可离线；对话测试必须 export AI_API_KEY
- **push 未完成**：commit 3bbc308 在本地，网络恢复后 `git push origin main`；CI（typecheck+test）已本地等价验证
- **打包安全**：新功能不引入用户数据目录则无需动 electron-builder.yml/.gitignore；若有新增必须审查（memory/packaging-rules.md）
- **子代理测试注意**：vi.mock 工厂 hoisted 必须用 vi.hoisted 定义变量；mock 路径用 alias（`@/agent/...`）比相对路径可靠
- **测试脚本的项目文件在测试结束时被 cleanup() 删除**（正常行为，断言在删除前执行）
