# AI写作软件—青剑 v11.8.1

Electron + React + TypeScript 桌面应用。AI 辅助小说创作：大纲→细纲→章节→仿写→续写→风格→场景→知识库。

## 技术栈

Electron 29 / React 18 / TypeScript 5 / Zustand + TipTap / Tailwind CSS / DeepSeek API (OpenAI+Anthropic双协议, thinking mode) / G6 + Framer Motion / Vitest / electron-builder

## 当前架构 (v11.6.0)

### 工具统一 (42→34)
- 删除冗余的 note/kb 专用工具（8个），统一使用 create_file/edit_file/read_file/list_directory/delete_file
- create_file/edit_file 支持所有目录（项目/notes/KB/模板/上传）
- 保留有独特逻辑的工具：search_notes, kb_append_file, kb_index_file, create_style_template, create_scene_template, create_project

### DeepSeek V4 Thinking Mode
- OpenAI + Anthropic 双协议启用深度推理（enableThinking/reasoningEffort 可配置）
- 工具调用时 temperature 自动降至 ≤0.3，减少幻觉
- reasoning_content 回传修复，支持多轮工具调用

### 模板系统
- `.aiharness/templates/` 目录，14 个文件格式模板
- 系统提示词从 ~3,500 tokens 压缩到 ~2,758 tokens
- AI 通过 read_file 按需查看格式，不再从提示词中读取

### 智能 Nudge + 死锁检测
- 知识问答自动识别，跳过探索推送
- 只读死锁从第 1 轮即检测并强制推送写入
- 分支 A（等用户选择）保护，不中断用户交互

## 硬规则（不可绕过）

1. **铁律**: 口头描述 ≠ 操作完成。只有 `status: "success"` 才算完成。
2. **项目隔离**: 所有文件操作限于当前项目目录内。
3. **精准执行**: 只做用户要求的操作，不确定时先询问。
4. **修改前先读**: create/edit/delete 前必须 read_file。
5. **不要自动 push / 不要自动更新版本号**: 等用户明确指令。

## 导航

| 你需要什么 | 去哪里 |
|-----------|--------|
| 项目结构 & 数据格式 | `.aiharness/rules/project-structure.md` |
| 金规则 | `.aiharness/rules/golden-rules.md` |
| Harness 配置 | `.aiharness/aiharness.json` |
| Agent 工具列表 | `src/agent/skills/tools/index.ts` (34 工具) |
| Agent Runtime | `src/agent/runtime/V4UnifiedRuntime.ts` |
| PhaseManager | `src/agent/runtime/PhaseManager.ts` (v11.0 simplified) |
| 协议适配器 | `src/agent/runtime/adapters/` |
| 格式模板 | `.aiharness/templates/` (14 个模板文件) |
| 版本历史 | `src/data/version_history.json` (当前 v10.1.0) |
| 跨会话记忆 | `~/.claude/projects/d--3/memory/MEMORY.md` |
| 验证脚本 | `.aiharness/scripts/` (3 个) |

## 验证命令

| 命令 | 用途 |
|------|------|
| `npx tsc --noEmit` | TypeScript 类型检查 |
| `npx vitest run` | 全量单元测试 (~530 用例) |
| `npx vitest run src/agent/__tests__/` | Agent 专项测试 (217 用例) |

## 15 场景集成测试

```bash
cd /d/3/novel-writing-app
export AI_API_KEY=sk-c9c30831df7243209435c60e811c879d

# 全部 15 场景 (~10分钟)
node scripts/comprehensive-test-suite.mjs

# 仅高优先 5 场景
node scripts/comprehensive-test-suite.mjs --phase=high

# 指定场景
node scripts/comprehensive-test-suite.mjs --scenario=T1,T2,T3

# 保留测试项目文件 (手动检查)
node scripts/comprehensive-test-suite.mjs --phase=high --keep

# 用 v4-pro 模型
AI_MODEL=deepseek-v4-pro node scripts/comprehensive-test-suite.mjs --phase=high
```

测试在每个场景最多 120s 内完成。失败原因通常是 AI 模型输出不满足验证条件（非代码问题）。T3 (ENOENT) 和 T15 (EISDIR) 是测试脚本预存问题。
