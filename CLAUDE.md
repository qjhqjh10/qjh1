# AI写作软件—青剑 v14.6.0

Electron + React + TypeScript 桌面应用。AI 辅助小说创作：大纲→细纲→章节→仿写→续写→改写→风格→场景→知识库。

## 技术栈

Electron 29 / React 18 / TypeScript 5 / Zustand + TipTap / Tailwind CSS / DeepSeek API (OpenAI+Anthropic双协议, thinking mode) / Framer Motion / Vitest / electron-builder

## 当前架构 (v14.5.0)

### AI 写作助手全面审计修复 (v14.5.0)
- 清单门控修复（GLOBAL_DONE_RE 裸锚点删除 + PARTIAL_DONE_RE 排除部分声明）；Anthropic 安全收窄（capabilities 接线 + toolsUsed 保留 + 子代理恒全量）
- thinking 双协议回传；停止生成 aborted 语义；HTTP 工具 detail 保留（4000 截断）；审批 60s 超时 + WAITING_APPROVAL + broad 条件审批
- 子代理 6 项（超时 abort/并发分片/操作记录隔离/会话池 TTL/verify 降级）；空响应角色交替；IME 防护；自动滚动；存储防抖合并；幻觉检测接线；token 条守卫；字数遵从（S_LEN）
- 615 passed + 15 skipped（630）；对话场景 32

### 安全与权限 (v14.4.0)
- find_files 条件审批（approvalGate：scope=project 免审批 / computer 仍审批）+ 子代理 find_files
- toolExecutorFactory 无审批路径时拒绝（防绕过）；IPC find_files dir_path 强制 containment
- 会话统计: 审计事件接线（api:call+cost/model、permission:decision）→ 聚合 cost/toolErrors/permissionDenied/lastUsed；deleteSession 完整 id
- RUN_TIMEOUT 动态化（maxIterations×60s，15min 封顶）；压缩 70% 保护最近 2 轮；子代理会话池 4→8
- Token 估算实测校准（CJK 1.2 / Latin 4.5）；KB embedding 记账（source='embedding'）

### 全自由模式 (2026-08-02, 个人使用安全姿态调整)
- **路径全自由**: safeResolve/resolveArgNoRealpath 统一归一化（path.resolve 处理中段 ../ 与混合分隔符），绝对路径放行；唯一硬边界 = 系统目录黑名单（C:\Windows/System32/Program Files、/dev /etc /usr /bin /sys /proc）+ UNC/网络路径 + 环境变量展开（V4SecurityFence Layer 1 与 IPC 层双侧拦截）
- **审批收窄**: list_directory(broad)/find_files(computer)/delete_file/rename_file 全部 AUTO（自动备份 .ai_backups + 操作历史留痕，事前审批 → 事后审计）；仅剩 update_prompt/delete_project 需确认
- **V4SecurityFence Layer 3 移除**: 外部路径不再要求审批（原 ../ 深度≥3 / 绝对路径确认逻辑删除）
- **B 类缺陷修复**: search_content 全局目录（../notes 等）不再静默空（safeWalk 改为仅挡系统目录）；batch_replace 全局替换语义（split/join）+ 空 old_string 拒绝 + 写前备份 + .json 校验；subagent_ask 描述如实（仅 analyze_file 会话可复用追问）；find_files 两 scope 的 dir_path 统一 safeResolve
- 相关: `electron/ipc/fileToolHandlers.ts` `src/agent/V4SecurityFence.ts` `src/agent/skills/tools/fileTools.ts`

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

### 工具精简 (42→34→27→31)
- v11.5: 删除冗余 note/kb 工具 (8个)
- v13.2: 删除 lsp_diagnose (纯开发工具) + update_config/list_audit (用户可手动操作)
- v14.1.1: +analyze_file/edit_file_task（子 agent 委托，独立上下文窗口）
- v14.2.0: +verify_task（验收子代理）
- v14.3.0: +subagent_ask（子代理会话追问，复用会话上下文）
- create_file/edit_file 支持所有目录（项目/notes/KB/模板/上传）
- 渐进披露: 首轮全量31工具 → 后续15核心 (含 tool_search 动态发现)

### 任务清单运行时状态 (v14.1.0)
- taskExtraction 四重门控提取编号任务 → 每轮注入 [当前任务] 进度 → 完成检测对照清单
- 未清空清单不接受"完成"声明；进度声明解析（已完成3/6/第2项完成/任务X/Y完成）
- 相关: `src/agent/utils/taskExtraction.ts` + V4UnifiedRuntime 完成检测重写

### 子 agent 上下文隔离 (v14.1.1)
- analyze_file（只读子代理）/ edit_file_task（读写子代理）→ 独立上下文窗口处理大文件
- SubagentService 工厂（isolatedStore + 64K 窗口 + 独立审计）；SERIAL_TOOLS 串行
- tokens 主/子分开统计（subAgentUsage 字段 + UI 消息页脚）
- 相关: `src/agent/subagent/` + `src/agent/skills/tools/subagentTools.ts`


### 跨 run 续跑 + 批量并行 + 验收 (v14.2.0)
- taskProgress 任务快照随消息持久化 → 中断恢复注入 [续跑] 上次中断于 X/Y（V4UnifiedRuntime + AIChatWindow.maybeInjectResume）
- analyze_file 分片 ≤3 并行（PARALLEL_READ_TOOLS）；edit_file_task 串行（SERIAL_WRITE_TOOLS）
- verify_task 验收子代理（第 30 工具）+ 清单完成验收提示（一次不强制）
- 子代理窗口跟随模型配置（64K → 配置值/128K 兜底）；tokens 按来源统计（main/subagent/pipeline/image）
### DeepSeek V4 Thinking Mode
- OpenAI + Anthropic 双协议启用深度推理（enableThinking/reasoningEffort 可配置）
- 工具调用时 temperature 由阶段感知系统控制
- reasoning_content 回传修复，支持多轮工具调用

### 模板系统
- `.aiharness/templates/` 目录，15 个根目录格式模板 + 7 写作手册（writing-handbook/）
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
| Agent 工具列表 | `src/agent/skills/tools/index.ts` (31 工具) |
| Agent Runtime | `src/agent/runtime/V4UnifiedRuntime.ts` |
| 协议适配器 | `src/agent/runtime/adapters/` |
| 格式模板 | `.aiharness/templates/` (15 格式 + 7 写作手册) |
| 版本历史 | `src/data/version_history.json` (当前 v14.4.0) |
| 跨会话记忆 | `~/.claude/projects/d--3/memory/MEMORY.md` |
| 验证脚本 | `scripts/check-consistency.sh` + `scripts/measure-token-density.mjs` + `scripts/test-ai-conversation.mjs` |
| 遗留工作 | `.aiharness/design/pending-fixes-v14.3.md` (9 项全部完成；④ 校准数据在 token-estimation-data-2026-08-01.md) |

## 验证命令

| 命令 | 用途 |
|------|------|
| `npx tsc --noEmit` | TypeScript 类型检查 |
| `npx vitest run` | 全量单元测试 (615 passed + 15 skipped，共 630) |
| `npx vitest run src/agent/__tests__/` | Agent 专项测试 (238 passed + 14 skipped，共 252) |

## 32 场景对话测试

```bash
cd /d/3/novel-writing-app
export AI_API_KEY=sk-xxx  # 替换为你的 DeepSeek API key

# 全部 32 场景 (~35分钟)
npx tsx scripts/test-ai-conversation.mjs

# 指定场景
npx tsx scripts/test-ai-conversation.mjs --scenario=S1,S2,S10,S_R1

# 仅新增能力测试
npx tsx scripts/test-ai-conversation.mjs --scenario=S_R1,S_R2,S_PD
npx tsx scripts/test-ai-conversation.mjs --scenario=S_SUB_MEM,S_ASK,S_VERIFY_FIX   # v14.3 新增: 快照复用/会话追问/验收闭环
npx tsx scripts/test-ai-conversation.mjs --scenario=S_RESUME,S_PAR,S_VERIFY   # v14.2 新增: 跨run续跑/批量并行/验收
npx tsx scripts/test-ai-conversation.mjs --scenario=S_MT2,S_SUB1,S_SUB2   # v14.1 新增: 多任务压力/子代理委托
```

测试通过真实 Bridge → Runtime → Adapter 运行，mock window.electron IPC 层。
场景覆盖：读取分析/跨轮记忆/多任务/编辑/删除重建/内容转化/联网搜索/知识库/角色扮演/渐进披露/多任务压力/子代理委托。
