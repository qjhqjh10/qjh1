# AI写作软件—青剑

Electron + React + TypeScript 桌面应用。AI 辅助小说创作：大纲→细纲→章节→仿写→续写→风格→场景→知识库。

## 技术栈

Electron 29 / React 18 / TypeScript 5 / Zustand + TipTap / Tailwind CSS / OpenAI 兼容 API / G6 + Framer Motion / Vitest / electron-builder

## 硬规则（不可绕过）

1. **铁律**: 口头描述 ≠ 操作完成。只有 `status: "success"` 才算完成。
2. **项目隔离**: 所有文件操作限于当前项目目录内。
3. **精准执行**: 只做用户要求的操作，不确定时先询问。
4. **修改前先读**: create/edit/delete 前必须 read_file。
5. **失败即记录**: 工具连续失败 3 次自动 learn_rule。

## 导航（指针，不是内容）

| 你需要什么 | 去哪里 |
|-----------|--------|
| 项目结构 & 数据格式 | `.aiharness/rules/project-structure.md` |
| 金规则（编码约束） | `.aiharness/rules/golden-rules.md` |
| Harness 配置 | `.aiharness/aiharness.json` |
| Agent 工具列表 | `src/agent/tools/toolSchemas.ts` |
| 版本历史 | `src/data/version_history.json` |
| 跨会话记忆 | `~/.claude/projects/d--3/memory/MEMORY.md` |
| 已学习规则 | `.aiharness/rules/auto-learned/`（用 list_rules 查看） |
| 测试 | `npx vitest run` |

## 架构

```
electron/ipc/      — IPC handler 层
src/agent/         — V4 Agent 运行时（Runtime/Tools/Context/Learning/Diagnostics）
  tools/           — 37 工具（file/kb/note/image/template/project/prompt/harness/http/browser/shell/lsp）
  context/         — 10 上下文 Provider + Compressor + Assembler + MemoryIndex
  utils/           — tokenEstimation, taskDetection
src/services/      — 服务层（file/character/chapter/scene/extraction/chatStorage）
src/utils/         — 共享工具（security, logger, textUtils）
src/components/    — UI 层（12 页面 + AIChatWindow + ErrorBoundary + VirtualMessageList）
src/store/         — Zustand 状态（useStore, useSettingsStore, useAgentStore）
src/types/         — 类型定义
```

## 关键工具

| 文件 | 用途 |
|------|------|
| `src/utils/safeJsonParse.ts` | 安全 JSON 解析（多策略回退） |
| `src/utils/dimTiers.ts` | 26 维度适用层级表（单一数据源） |
| `src/utils/imageCompress.ts` | 头像图片压缩+存盘（256px JPEG） |
| `src/data/softwareGuide.ts` | 软件功能说明单一数据源（UI+AI共用） |
| `src/utils/security.ts` | 路径消毒/URL验证/命令白名单 |
| `src/utils/fileReadCache.ts` | 共享文件读缓存（GUI+AI共用，读写删自动同步） |
| `src/agent/utils/tokenEstimation.ts` | CJK 感知 token 估算 |

## 验证命令

| 命令 | 用途 |
|------|------|
| `npx tsc --noEmit` | TypeScript 类型检查 |
| `npx vitest run` | 运行全部测试（477 用例） |
| `node scripts/test-v5-anth.mjs` | Anthropic协议CLI仿真测试 |
| `node scripts/openai-sim-test.mjs` | OpenAI协议CLI仿真测试 |

## 操作原则

- 项目目录: `projects/{项目名}/`，全局数据: `style_templates/` `scene_templates/` `knowledge_base/`
- 编辑 Markdown/JSON 前 read_file 确认，用 edit_file 精确替换，失败用 `__FULL_REPLACE__`
- 创建 JSON 时系统自动校验格式，失败根据错误提示修正
- 工具按需选择：闲聊不用工具，任务才启用，优先读取直接路径而非遍历
- 安全验证使用 `src/utils/security.ts` 共享模块，不要在各工具内联实现
- Token 估算使用 `src/agent/utils/tokenEstimation.ts`，不要手写 `chars/3`
- 对话持久化使用 `src/services/chatStorageService.ts`，不要直接操作 localStorage
