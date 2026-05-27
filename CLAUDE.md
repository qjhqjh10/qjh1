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
electron/ipc/     — 10个IPC handler（文件读写/项目/AI/导出/知识库/统计/风格/模板/反推/文件工具）
src/services/     — 6个service（fileService/characterService/chapterService/sceneService/extractionService）
src/components/   — 12个页面 + 17个共享组件 + AI聊天悬浮窗
src/store/        — Zustand (AppState + SettingsState + OperationHistoryState)
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

### AI 文件系统操作 (AIChatWindow) — v3.7.0
AI 可通过 OpenAI Function Calling 操作项目文件。10 个工具: list_directory/read_file/search_files/search_content(只读), edit_file(预览确认+DiffView+自动备份), list_backups/restore_backup(备份管理), create_file/delete_file/rename_file(需用户确认)。编辑自动备份去重(每文件10份)，操作历史持久化到侧边栏。

### 系统设置 (SystemSettingsPage)
模型配置/提示词库/AI写作助手/显示设置/Token统计/版本更新。

## 版本历史

| 版本 | 日期 | 核心变化 |
|------|------|---------|
| v6.0.0 | 2026-05-28 | 大规模代码重构：12文件拆为81子文件(CharactersPanel重写/StyleWorkshopPage架构重写/ImitationPage handler提取/AIChatWindow拆分/ChapterGenerationModal拆分等) |
| v5.8.0 | 2026-05-26 | 路径安全加固(isSafePath大小写+safeResolve绝对路径拦截+百分号防御)+跨项目隔离(list_directory限定+无项目拒绝)+前端路径归一化+generateImage修复+死代码清理+AI诊断事件流+任务级审批+审批面板重构+精准执行铁律 |
| v5.7.0 | 2026-05-26 | 章节摘要独立存储(summaries/*.md)+批量审批门控+审批面板UI重构+精准执行铁律+操作拒绝反馈循环+细纲自动组装+工具结果合并+批量读取限制 |
| v5.6.0 | 2026-05-26 | edit_file 5级模糊匹配+__FULL_REPLACE__全量替换+幻觉检测增强(间隔匹配+即时自纠)+三重幻觉防御(关键词/按钮/智能提示)+fileEditNotify彻底修复(补projectPath依赖+toLowerCase)+AI路径自动加项目前缀+风格模板21维度全生效+对话风格强制约束+风格强度三级+API连接预检+死代码清理+UX多项优化 |
| v5.4.1 | 2026-05-24 | Token优化3(config.systemPrompt前移仅首条)+死代码清理(buildContextPrefix 112行+customRole+contextPriority+setWritingChapter)+模板去重修复(AI同名不覆盖)+场景模板参数修复(intensity双名+path.basename崩溃)+代码注释增强(工具选择/历史精简/scene_handler/fileEditNotify/上传三入口)+READ_ONLY_TOOLS注释+工具关键词补全 |
| v5.4.0 | 2026-05-24 | 欢迎信息升级(19模块+关闭开关)+系统提示词补全(角色/风格/场景/KB/草稿/图片)+场景模板修复(bodyFocus/sensory写入config+isEmpty增强)+模板去重修复+卡片AI自动标识+全代码审计 |
| v5.3.0 | 2026-05-24 | 场景模板重构(26维卡片+预设扩充2-3倍+15工具参数)+文件上传系统(全局uploads+拖拽+附件)+模板文件中文命名+风格/场景模板创建修复+upload/notes全局搜索+Token调试右键分解 |
| v5.2.0 | 2026-05-24 | Token深度优化3(工具调用不跨轮+历史限20条+首条消息计数判断修复14k重复发送)+工具按需选择(闲聊0个/任务8个/特定领域动态添加)+Token调试面板(用量展开显示构成明细)+系统提示词强化(用工具前先思考:最少工具+一步到位+禁止验证读) |
| v5.1.0 | 2026-05-24 | Markdown存储迁移(HTML→MD存取自动转换)+Token优化2(contextPrefix移除+KB默认关闭)+fileEditNotify全面修复(大小写+条件清除6组件)+细纲重构(JSON解析增强+MD兼容+customContent字段+系统提示词补全)+RichTextEditor修复(HTML检测)+WordCount双计数(纯文字+原始文件)+备份关闭(backupFile空函数+2工具移除)+Modal全站可拖拽(17个)+左栏滚动修复+路径大小写兼容 |
| v5.0.0 | 2026-05-24 | Token优化(系统提示词/工作模式仅首条+风格注入移除+工具结果仅保留3条+write_note内容剥离)+智能压缩对话(右键压缩+70%警告)+草稿本全局化+大纲编辑升级(RichTextEditor+.json→.md)+AI写作助手修复(edit_file路径回退+trim匹配+通知修复)+查找替换增强+系统提示词优化(HTML富文本+角色16字段schema)+后端修复(全局notes白名单+AbortController分离+死代码清理) |
| v4.12.0 | 2026-05-23 | 风格工坊+模板库合并(双Tab重设计+FramerMotion+进度条+全部展开/折叠)+AI写作助手全面诊断修复(V2/V3统一+错误隔离+AbortController+维度检查)+草稿本全局化(移除项目绑定+扁平列表+Route D)+模板创建修复(worldType/attitude扩充11/9项+自定义)+AI工具权限修复(READ_ONLY_TOOLS补全)+项目列表过滤+删除确认弹窗+悬浮按钮位置记忆+死代码清理+Abort通道分离 |
| v4.11.0 | 2026-05-23 | 对话微信化(时间戳居中+智能折叠>550字+间距优化)+消息底部Token/花费/字数显示+字数双显(纯文字+含空格)+AI编辑自动应用无需确认+输出控制(编辑后只输出摘要)+buildContextPrefix精简 |
| v4.9.0 | 2026-05-23 | AI图片生成(generate_image)+角色面板分组+卡片重设计+关系图重构+AI生成弹窗可拖拽+关联上下文重构+角色创建修复+代码审计修复 |
| v4.8.0 | 2026-05-22 | 大纲Tab重命名+plot.json重命名+大纲/世界观纯文本重构+大纲数据加载修复+AI一键生成章节正文(【生成本章】)+章节生成设置持久化+角色智能过滤+温度控制+消息头像自定义+fileEditNotify持久化+大纲页面崩溃全面修复+系统提示词完整Schema+safeStr提取+代码注释安全标注+冗余清理 |
| v4.7.0 | 2026-05-22 | 故事剧情Tab重命名(基础设定→故事剧情)+outline/outline.json→plot.json+编辑全线自动保存(细纲/章节)+AI创建内容实时显示修复(fileEditNotify持久化)+CharactersPanel/StyleWorkshop/SceneWorkshop/TemplateLibrary通知补全+工具消息中文显示+细纲撰写/删除按钮+代码注释+冗余清理 |
| v4.6.0 | 2026-05-22 | AI对话上下文修复(historyMessages)+危险工具确认机制修复+工具操作通知补全+上下文用量修正+AIChatWindow增强(resize/滚动/停止/尺寸)+系统提示词增强(风格分析/场景模板/仿写细纲)+知识库弹窗+自动索引清理+summarizeFileOp补全+kb_webSearch修正+防护注释 |
| v4.5.0 | 2026-05-21 | 大纲全Tab AI编辑+全局项目结构知识+细纲AI管理+知识库智能保存(kb:create/append)+AI主动服务(素材保存)+大纲/世界观/草稿AI弹窗+fileEditNotify关键修复(界面刷新)+文件拆分(CharactersPanel/SceneWorkshopPage) |
| v4.4.0 | 2026-05-21 | 文件损坏全面修复: 上下文用量条动态模型切换(contextWindow可编辑)+ImageLightbox拖拽平移重置+AI角色图片自动搜索+编辑器图片resize持久化+恢复文件上传(TXT/MD)+恢复EPUB导出(UI完整打通)+软件说明弹窗 |
| v4.3.0 | 2026-05-21 | 角色形象图(卡片大图+灯箱缩放)+AI生成角色卡片命令+编辑器图片resize/对齐+HomePage重设计v2(宽卡片+三栏统计)+EPUB导出(标准3.0+图片提取+XML转义)+AI图片上传+后端安全修复(isSafePath/error handler/常量)+Scratchpad升级为RichTextEditor |
| v4.2.0 | 2026-05-21 | HomePage重设计(左栏列表+右栏大卡片+玻璃拟态)+编辑器图片/链接(TipTap Image/Link+工具栏)+项目封面(covers/+二进制IPC)+AI多模态图片(normalizeContent+base64渲染)+AI图片搜索(search_images+Unsplash)+3项Bug修复 |
| v4.1.0 | 2026-05-21 | 多窗口弹窗系统(大纲/世界观/草稿可拖拽+AI同时编辑+实时刷新)+语音对话(语音输入+AI朗读+零依赖)+AI使用指南+续写/仿写弹窗兼容+安全修复(story/rewrite路径穿越/file大小限制)+AI衔接补全(6页面) |
| v4.0.0 | 2026-05-20 | Plan/Action完善(动态提示+pill切换)+纯文本改写(@@原文@@)+直接替换模式+会话持久化+草稿笔记系统(5工具)+后端修复(validateRole/cacheToken/超时)+10+Bug修复+代码架构优化(chatConstants/utils/hooks拆分) |
| v3.10.0 | 2026-05-20 | Plan/Action双模式+文件上传+上下文用量显示+设置页能力面板+项目管理工具+知识库索引+内嵌命令系统 |
| v3.9.0 | 2026-05-20 | 模板类型扩展到11种+续写写作注入风格/场景模板+全链路集成打通(extraction:importFromPath+仿写外部模板)+续写从项目目录导入+快照数据完整保留 |
| v3.8.0 | 2026-05-20 | 细纲重构(结构化字段+2列卡片+弹窗编辑)+11种小说类型系统+风格工坊模板库合并(AI辅助填充维度)+AI知识注入5页面扩展+续写维度自定义+模板编辑维度标签云 |
| v3.7.0 | 2026-05-20 | AI文件系统操作(10工具/Function Calling)+编辑预览Diff+一键回滚+智能备份(去重/保留10份)+操作历史面板+20项安全加固 |
| v3.6.0 | 2026-05-19 | 故事脉络独立化+硬规则引擎+剧情改写(三栏工作流+AI红蓝标注)+AI改写机制 |
| v3.5.0 | 2026-05-19 | AI助手增强(大纲/世界观)+故事脉络(独立导入+冲突检测+4新维度)+侧边栏重构+自动保存 |
| v3.4.0 | 2026-05-19 | 窗口记忆+隐藏菜单+角色重要度(数值化)+灵活分析维度(13类型×专有预设)+AI助手精简 |
| v3.3.0 | 2026-05-19 | 续写系统核心重构(角色分类+剧情走向+大纲融合)+仿写独立页+项目类型追踪重构+世界观移入大纲 |
| v3.2.0 | 2026-05-19 | 续写导入修复(编码检测)+项目创建/删除一致性+项目导出/导入(ZIP含类型)+章节检测增强 |
| v3.1.0 | 2026-05-19 | 大纲格式迁移(TXT→JSON)+安全加固(路径穿越/abort广播)+类型安全+知识库精简(取消自动索引)+数据完整性修复 |
| v3.0.0 | 2026-05-18 | 小说续写系统(6步向导+9维分析+续写大纲细纲)+项目类型扩展+服务商预设+推理深度+章节状态简化 |
| v2.16.0 | 2026-05-18 | 风格工坊重构: 模板库系统+26维V3分析(100%可靠)+章节创作G.风格模板+双层基调+世界观识别+段落/字数管控 |
| v2.15.0 | 2026-05-18 | 场景工坊全面增强: 普通小说10区块+12字段+情色4字段+AI自动模式 |
| v2.14.0 | 2026-05-18 | 仿写导航修复+等级系统改造(PowerLevel)+CustomInput反馈 |
| v2.13.0 | 2026-05-18 | 场景工坊自定义标签全面修复(重复显示+单值存储+POV崩溃+内省说明) |
| v2.12.0 | 2026-05-18 | 导航重构(上下文感知侧边栏)+大纲Hub(10Tab)+角色嵌入大纲+仿写深度链接+路由清理 |
| v2.11.0 | 2026-05-17 | ImitationPage拆分(1774→~900行)+场景工坊字段补全(8→23)+abortRef修复+取消按钮修复 |
| v2.10.0 | 2026-05-17 | 全面代码审计: 安全漏洞修复+高危Bug+死代码清理(~300行)+类型安全+重复常量提取 |
| v2.9.1 | 2026-05-17 | 场景工坊修复(CustomTagButton补全+叙事视角崩溃+内省说明+卡片描述+重复key) |
| v2.9.0 | 2026-05-17 | 场景工坊23区块卡片化+自定义标签系统+叙事技法拆分+字数独立+按钮化+JSX重写 |
| v2.8.0 | 2026-05-17 | 场景工坊卡片化+AI生成场景注入+14-17区块+去掉独立按钮+JSX修复+字段扩展 |
| v2.7.1 | 2026-05-17 | 场景工坊全配置区自定义输入+EroticSceneConfig新增7个自定义字段 |
| v2.7.0 | 2026-05-17 | 仿写流程修复+场景工坊重构(模板库模式)+SceneTemplate增加type字段 |
| v2.6.0 | 2026-05-17 | 项目类型统一(写作/仿写)+仿写数据存项目目录+细纲点击交互+角色导入弹窗 |
| v2.5.0 | 2026-05-16 | 细纲卡片情色展示+DetailViewModal点击编辑+itemsUsed修复+情色管道完善 |
| v2.4.1 | 2026-05-16 | NOVEL_TYPE_DIMS修复+死代码清理+提示词库补全10个模板 |
| v2.4.0 | 2026-05-16 | 代码审查修复: 9个Bug修复+死代码清理+日志统一+重复消除+大文件拆分 |
| v2.3.0 | 2026-05-16 | 章节创作对齐+情色场景编排+情色剧情模仿链+风格注入 |
| v2.2.0 | 2026-05-16 | 章节创作Tab+生成剩余细纲+清空细纲+CLAUDE.md |
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
