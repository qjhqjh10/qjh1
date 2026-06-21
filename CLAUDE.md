# AI写作软件—青剑 v13.2.0

Electron + React + TypeScript 桌面应用。AI 辅助小说创作：大纲→细纲→章节→仿写→续写→改写→风格→场景→知识库。

## 技术栈

Electron 29 / React 18 / TypeScript 5 / Zustand + TipTap / Tailwind CSS / DeepSeek API (OpenAI+Anthropic双协议, thinking mode) / G6 + Framer Motion / Vitest / electron-builder

## 当前架构 (v13.2.0)

### 项目目录分离
- `projects/` — 普通写作项目
- `imitation_projects/` — 仿写项目独立目录
- `continuation_project_dirs/` — 续写项目独立目录
- `continuation_projects/` — 续写 JSON 数据
- `rewrite_projects/` — 改写项目（独立 service）
- ProjectHubLayout 统一三个入口页的主从布局

### 操作记录 (v13.1.0)
- ToolExecutor 执行每个工具后自动写入 OpHistoryEntry
- Zustand persist 持久化到 localStorage
- 页面路径: /operation-history

### 风格模板 v5 — 全类型维度分层系统 (27维)
- **全类型覆盖**: 17种小说类型各有 DIM_PRIORITY 分层（T0总基调/T1技法核心/T2结构支撑/T3辅助）
- **类型特别注意**: 7种热门类型（情色/修仙/都市/恋爱/玄幻/科幻/奇幻）有专属分析指导
- **动态篇幅分配**: 根据 novelType 自动匹配各维度的字数范围
- **紧凑纯文本输出**: 分析 prompt 要求无 Markdown 格式符号
- **注入类型感知**: 感官温度锚/直白程度锚/绕过指导仅情色类型触发
- **极端内容绕过**: 分隔符/拼音/英文/同音字四种方法

### 全类型 DIM_PRIORITY 分层
- 17种类型各有独立的维度优先级和字数范围
- 情色: T0(3)+T1(5)+T2(5)+T3(3)=16维
- 通用: T0(2)+T1(5)+T2(4)+T3(1)=12维
- 每种类型自动插入专属维度(socialRealism/cultivationCombat/romanceArc等)

### 工具精简 (42→34→27)
- v11.5: 删除冗余 note/kb 工具 (8个)
- v13.2: 删除 lsp_diagnose (纯开发工具) + update_config/list_audit (用户可手动操作)
- create_file/edit_file 支持所有目录（项目/notes/KB/模板/上传）
- 渐进披露: 首轮全量27工具 → 后续12核心 (含 tool_search 动态发现)

### DeepSeek V4 Thinking Mode
- OpenAI + Anthropic 双协议启用深度推理（enableThinking/reasoningEffort 可配置）
- 工具调用时 temperature 由阶段感知系统控制
- reasoning_content 回传修复，支持多轮工具调用

### 模板系统
- `.aiharness/templates/` 目录，23 个文件（16 格式模板 + 7 写作手册）
- 系统提示词从 ~5,800 tokens 瘦身到 ~3,600 tokens (v13.2.0: 写作规范手册移出)
- AI 通过 read_file 按需查看格式和操作手册，不再从提示词中读取

### 智能 Nudge + 死锁检测
- 知识问答自动识别，跳过探索推送
- 只读死锁从第 1 轮即检测并强制推送写入
- 分支 A（等用户选择）保护，不中断用户交互

## 硬规则（不可绕过）

1. **铁律**: 口头描述 ≠ 操作完成。只有 `status: "success"` 才算完成。
2. **项目隔离**: 所有文件操作限于当前项目目录内。
3. **精准执行**: 只做用户要求的操作，不确定时先询问。
4. **修改前先读（按操作区分）**: create_file 新建不读、FULL_REPLACE 覆盖只确认存在、局部替换才读原文。已读取过的文件不重复读。
5. **不要自动 push / 不要自动更新版本号**: 等用户明确指令。

## 导航

| 你需要什么 | 去哪里 |
|-----------|--------|
| 项目结构 & 数据格式 | `.aiharness/rules/project-structure.md` |
| 金规则 | `.aiharness/rules/golden-rules.md` |
| Harness 配置 | `.aiharness/aiharness.json` |
| Agent 工具列表 | `src/agent/skills/tools/index.ts` (27 工具) |
| Agent Runtime | `src/agent/runtime/V4UnifiedRuntime.ts` |
| — | PhaseManager 已在 v11.7.0 移除 |
| 协议适配器 | `src/agent/runtime/adapters/` |
| 格式模板 | `.aiharness/templates/` (16 格式 + 7 写作手册) |
| 版本历史 | `src/data/version_history.json` (当前 v10.1.0) |
| 跨会话记忆 | `~/.claude/projects/d--3/memory/MEMORY.md` |
| 验证脚本 | `.aiharness/scripts/` (3 个) |

## 验证命令

| 命令 | 用途 |
|------|------|
| `npx tsc --noEmit` | TypeScript 类型检查 |
| `npx vitest run` | 全量单元测试 (~530 用例) |
| `npx vitest run src/agent/__tests__/` | Agent 专项测试 (217 用例) |

## 22 场景对话测试

```bash
cd /d/3/novel-writing-app
export AI_API_KEY=sk-xxx  # 替换为你的 DeepSeek API key

# 全部 22 场景 (~25分钟)
npx tsx scripts/test-ai-conversation.mjs

# 指定场景
npx tsx scripts/test-ai-conversation.mjs --scenario=S1,S2,S10,S_R1

# 仅新增能力测试
npx tsx scripts/test-ai-conversation.mjs --scenario=S_R1,S_R2,S_PD
```

测试通过真实 Bridge → Runtime → Adapter 运行，mock window.electron IPC 层。
场景覆盖：读取分析/跨轮记忆/多任务/编辑/删除重建/内容转化/联网搜索/知识库/角色扮演/渐进披露。
