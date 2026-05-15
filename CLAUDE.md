# AI 小说写作助手

Electron + React + TypeScript 桌面应用，AI 辅助小说创作。

## 技术栈

- Electron 29 + React 18 + TypeScript 5
- Zustand (状态管理) + TipTap (富文本编辑器) + Tailwind CSS
- OpenAI 兼容 API + Embedding (知识库)
- G6 (关系图) + Framer Motion (动画)
- Vitest + Testing Library (测试)
- electron-builder (打包)

## 架构

```
electron/ipc/     — 9个IPC handler（文件读写/项目/AI/导出/知识库/统计/风格/模板/反推）
src/services/     — 6个service（fileService/characterService/chapterService/sceneService/extractionService）
src/components/   — 11个页面 + 17个共享组件 + AI聊天悬浮窗
src/store/        — Zustand (AppState + SettingsState)
src/types/        — TypeScript 类型定义
src/utils/        — 工具函数
```

## 核心功能模块

### 小说仿写 (ImitationPage) — v2.1.0
最核心的模块。统一了反推+风格分析+模仿生成的全流程。

**流程**: 类型选择(11种) → 导入TXT → 维度选择 → 逐章提取 → 自动聚合(6模式) → 风格分析(可选) → 大纲模仿(7维) → 细纲模仿(逐章) → 章节写作

**7个Tab**: 章节 → 原书大纲 → 原书细纲 → 生成 → 大纲 → 细纲 → 时间线

**大纲模仿(7维)**: 角色/世界观/道具/等级/伏笔/情绪/情色。每个维度独立生成，自动保存，✓标记。
**细纲模仿**: 逐章生成，每章精准对应原作章节，7维全部注入prompt。
**章节写作**: 细纲卡片「写本章」→ 三栏编辑器(左参考/中正文/右大纲) → AI生成 → 保存。

**数据持久化**: `outlineResults`, `detailGenResults`, `chapterContents` 全部写入 extraction JSON。

### 风格工坊 (StyleWorkshopPage)
导入TXT → 分章 → AI逐章分析16维文风 → 聚合StyleProfile → 应用到写作项目。

### 场景工坊 (SceneWorkshopPage)
按章配置场景参数（角色状态/玩法/流程/技法）。情色类型自动创建EroticSceneConfig。

### 章节创作 (ChapterWritingPage)
TipTap编辑器 + AI生成/续写/审稿/摘要 + 批量生成 + 版本对比。

### 大纲页 (OutlinePage) — v1.3重做
5个Tab: 大纲/世界观/细纲/故事线/伏笔。世界观已并入大纲。

### 细纲页 (DetailedOutlinePage)
章节CRUD + 拖拽排序 + 状态管理。存储格式为JSON。

### 角色页 (CharactersPage)
角色CRUD + AI生成 + 关系图谱。存储格式为JSON。

### 知识库 (KnowledgeBasePage)
文件上传 → 分块 → Embedding → 语义搜索。支持PDF/DOCX/TXT/MD。

### 故事脉络 (StoryMapPage)
9标签页: 时间线/伏笔链/一致性/情绪曲线/出场热力图/节奏分析/支线/POV/成长。

### 系统设置 (SystemSettingsPage)
模型配置/提示词库/AI写作助手/显示设置/Token统计/版本更新。

## 版本历史

| 版本 | 日期 | 核心变化 |
|------|------|---------|
| v2.1.0 | 2026-05-16 | 章节写作界面+细纲持久化+情色完善 |
| v2.0.0 | 2026-05-16 | 卡片式展示+持久化+自动保存+角色分类 |
| v1.9.0 | 2026-05-15 | 大纲卡片式+角色分类+prompt重写 |
| v1.8.0 | 2026-05-15 | 提取弹窗+逐章细纲+自动模仿+导入修复 |
| v1.7.0 | 2026-05-15 | 时间线Tab+细纲全维度注入 |
| v1.6.0 | 2026-05-15 | Tab重构6个+大纲细纲分层+维度切换+卡片式UI |
| v1.5.0 | 2026-05-15 | 小说仿写系统初版(11类型+自定义维度) |
| v1.4.0 | 2026-05-15 | 小说反推+风格+模仿生成合并 |
| v1.3.0 | 2026-05-14 | 反推引擎+大纲重做+格式统一(.txt→.json) |
| v1.2.0 | 2026-05-14 | 场景工坊+代码质量修复 |
| v1.1.0 | 2026-05-14 | 风格工坊+情色场景编排 |
| v1.0.0 | 2026-05-13 | 初始版本 |

完整版历见 `src/data/version_history.json`。

## 关键设计

- **数据格式**: characters/detailed_outline 为JSON，向后兼容旧TXT
- **IPC分层**: 每功能一个handler文件，main.ts仅初始化(~110行)
- **双视图**: library(项目列表) + detail(工作台) 模式复用
- **提取去重**: 已提取章节`extractedAt`标记，自动跳过
- **维度自定义**: 提取和风格分析均支持维度弹窗勾选
- **角色分类**: AI输出的role标准化为男主/女主/男配/女配/反派/其他
