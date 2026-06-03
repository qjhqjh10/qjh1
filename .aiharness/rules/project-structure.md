# 项目结构速查

## 技术栈

Electron 29 + React 18 + TypeScript 5 + Zustand + TipTap + Tailwind CSS + OpenAI 兼容 API + G6 + Framer Motion + Vitest + electron-builder

## 目录结构

```
electron/ipc/     — IPC handler（文件/项目/AI/导出/KB/统计/风格/模板/反推/文件工具/Agent）
src/agent/        — Agent运行时（55文件: Runtime/FSM/Store/Tools/Context/Thinking/Permissions/Budget/Reflection/Constraint等）
src/services/     — 6个service（file/character/chapter/scene/extraction）
src/components/   — 12页面 + 20共享组件 + AI聊天悬浮窗
src/store/        — Zustand (AppState + SettingsState)
src/types/        — TypeScript 类型定义
src/utils/        — 工具函数
memory/           — 持久化记忆（跨会话 Agent 上下文）
```

## 数据格式

- **角色**: `characters/{中文名}.json` — 16 字段平铺(文件名用中文名如 林语晴.json, id字段用拼音保证唯一), role 标准化为 男主/女主/男配/女配/反派/其他
- **细纲**: `detailed_outline/{章节id}.json` — 每章一个 JSON
- **大纲**: `outline/plot.md` — 故事剧情 Markdown
- **世界观**: `outline/worldbuilding.md` — Markdown
- **章节正文**: `chapters/{章节id}.txt`
- **章节摘要**: `summaries/{章节id}.md`
- **草稿笔记**: `notes/` — 全局 Markdown 文件（非项目绑定）
- **风格模板**: `style_templates/`（全局共享）
- **场景模板**: `scene_templates/`（全局共享）
- **知识库**: `knowledge_base/`（全局共享，Embedding 索引）

## 核心功能模块

### 小说仿写 (ImitationPage) — 最核心
流程: 类型选择(11种) → 导入TXT → 维度选择 → 逐章提取 → 自动聚合(6模式) → 风格分析 → 大纲模仿(7维) → 细纲模仿 → 章节写作
7个Tab + 大纲模仿7维(角色/世界观/道具/等级/伏笔/情绪/情色) + 三栏编辑器

### 风格工坊 (StyleWorkshopPage)
导入TXT → 分章 → AI逐章分析16维文风 → 聚合StyleProfile → 应用到写作

### 场景工坊 (SceneWorkshopPage)
按章配置场景参数（角色状态/玩法/流程/技法），情色类型自动创建EroticSceneConfig

### 章节创作 (ChapterWritingPage)
TipTap编辑器 + AI生成/续写/审稿/摘要 + 批量生成 + 版本对比

### 续写工作台 (ContinuationWorkspacePage)
7步向导: 导入TXT → 逐章分析 → 原作理解 → 剧情走向 → 大纲融合 → 续写细纲 → 续写章节

### 大纲页 (OutlinePage)
5个Tab: 大纲/世界观/细纲/故事线/伏笔

### 细纲页 (DetailedOutlinePage)
章节CRUD + 拖拽排序 + 状态管理

### 角色页 (CharactersPage)
角色CRUD + AI生成 + 关系图谱

### 故事脉络 (StoryMapPage)
9标签页: 时间线/伏笔链/一致性/情绪曲线/出场热力图/节奏分析/支线/POV/成长

### 知识库 (KnowledgeBasePage)
文件上传 → 分块 → Embedding → 语义搜索。支持PDF/DOCX/TXT/MD

### AI 聊天窗口 (AIChatWindow)
29个工具，Function Calling 操作项目文件，编辑预览+Diff+自动备份，操作历史侧边栏

## 关键设计

- **数据格式**: characters/detailed_outline 为 JSON，向后兼容旧 TXT
- **IPC分层**: 每功能一个 handler 文件，main.ts 仅初始化
- **双视图**: library(项目列表) + detail(工作台) 模式复用
- **提取去重**: 已提取章节 `extractedAt` 标记，自动跳过
- **维度自定义**: 提取和风格分析均支持维度弹窗勾选
- **角色分类**: AI 输出的 role 标准化为 男主/女主/男配/女配/反派/其他
- **Agent一体化**: v6.2.0 起，AgentChatBridge 为唯一引擎，AIChatWindow 为薄壳
