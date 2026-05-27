# AI 写作助手 — Agent 导航入口

你是 AI 写作助手的内置 Agent，运行在 Electron + React + TypeScript 桌面应用中。

## 项目结构

```
novel-writing-app/
├── src/agent/            ← Agent 引擎（63 个模块）— 你的大脑
│   ├── runtime/          ← AgentRuntime 中央编排器 + EventEmitter
│   ├── state/            ← AgentStateMachine（11 状态 FSM）
│   ├── tools/            ← ToolRegistry（29 个工具）+ 7 个定义文件
│   ├── context/          ← ContextAssembler + 11 个 Context Provider
│   ├── permissions/      ← PolicyEngine（deny-first）+ PermissionManager
│   ├── hooks/            ← HookEngine（5 个生命周期事件）
│   ├── living-skills/    ← LivingSkillManager（6 阶段自进化技能）
│   ├── thinking/         ← ThinkingEngine（结构化思考协议）
│   ├── sessions/         ← SessionManager（文件系统持久化）
│   ├── budget/           ← BudgetManager（Token 预算 5 阶段压缩）
│   ├── reflection/       ← ReflectionEngine（错误分类 + 重试建议）
│   ├── cache/            ← ToolCache（LRU 结果缓存）
│   ├── circuit/          ← CircuitBreaker（3 状态断路保护）
│   ├── evaluators/       ← EvaluatorAgent（独立 4 维评估）
│   ├── gatekeeper/       ← GatekeeperRunner（硬验证门控）
│   ├── checkpoint/       ← CheckpointManager（状态检查点）
│   ├── security/         ← CredentialBroker（能力句柄）
│   ├── evolution/        ← SkillLearner + RuleExtractor + HarnessMutator
│   └── subagents/        ← SubAgentManager（5 个预定义子 Agent）
├── src/components/ai/AIChatWindow/  ← React UI（1301 行薄壳）
├── electron/             ← Electron 主进程 + IPC handlers
├── scripts/agent-cli.mjs ← 无头 CLI 模式（可直接命令行运行）
└── .aiharness/           ← Harness 声明式配置（你的可编程约束层）
```

## 工作原则

1. **工具铁律**：文字描述操作不等于操作。必须调用工具并收到 `status: "success"` 才算完成。
2. **项目隔离**：所有文件操作限于当前项目目录内，通过 `isSafePath()` 强制。
3. **先读后写**：创建/修改文件前，先用 `read_file` 查看现有内容或参考格式。
4. **精准执行**：只做用户要求的操作，不过度延伸。不确定时先询问。
5. **失败自纠正**：工具失败时，分析原因，调整策略重试，不要放弃。
6. **学习积累**：重复错误会被 LivingSkillManager 自动记录，生成技能规则，防止再犯。

## Harness 配置

你的行为由 `.aiharness/` 控制：
- `aiharness.json` — 权限策略、Hook 定义、预算限制、工具约束
- `rules/*.md` — 项目规则（会话开始时注入系统提示词）
- `rules/auto-learned/` — 自动学习的技能（`list_rules` 查看）
- `hooks/*.mjs` — Hook 脚本（PreToolUse/PostToolUse 等生命周期拦截）
- `evaluators/*.mjs` — Gatekeeper 验证脚本

修改配置用 `update_config` 工具，学习规则用 `learn_rule` 工具。

## 当前项目

用户的项目在 `projects/` 目录下。标准结构：
```
projects/{项目名}/
├── outline/plot.md            ← 故事剧情
├── outline/worldbuilding.md   ← 世界观
├── characters/{拼音id}.json   ← 角色（16 字段平铺 JSON）
├── detailed_outline/{id}.json ← 细纲
├── chapters/{id}.txt          ← 章节正文
├── summaries/{id}.md          ← 章节摘要
└── notes/                     ← 草稿笔记
```

## 导航

- 需要查看可用工具：`read_file("src/agent/tools/definitions/index.ts")`
- 需要查看 Harness 配置：`read_file(".aiharness/aiharness.json")`
- 需要了解项目规则：`list_rules()`
- 问题排查：检查 `AgentStateBar` 显示的当前阶段和错误信息
