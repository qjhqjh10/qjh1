# AI写作软件—青剑 v16.2.0

Electron + React + TypeScript 桌面应用。AI 辅助小说创作：大纲→细纲→章节→仿写→续写→改写→风格→场景→知识库。

## 技术栈

Electron 29 / React 18 / TypeScript 5 / Zustand + TipTap / Tailwind CSS / DeepSeek API (OpenAI+Anthropic+Responses 三协议, thinking mode) / Framer Motion / Vitest / electron-builder

## 当前架构 (v16.2.0)

### v16.2.0 副模型多模态（2026-08-10）
- **副模型（Secondary）**：模型设置「Image 图片模型」彻底改造为「Secondary 副模型」——image* 6 字段 → secondary*（secondaryModel/Provider/ApiUrl/ApiKey/InputPrice/OutputPrice），configMigration + store migrateSettings v10 双通道迁移旧配置
- **上传图片自动分析**：聊天窗上传/拖拽图片 → 主进程 ai:vision-chat（读图→nativeImage 缩放→base64→OpenAI content parts）→ 副模型看图 → 描述文本注入主模型上下文（📷 图片已分析）——主链路 Message 结构零改动，历史只存描述（vision-bridge 行业惯例）
- **analyze_image 工具（第 34 工具）**：AI 写作中主动看图（项目 images/、知识库图片），支持 question 定向提问；未配置副模型返回引导错误
- **图片处理策略三档模板**（aiSettings.visionTemplate，默认 standard）：标准 1568px/800 token / 精细 2048px/1500 / 经济 768px/300——缩放上限+描述长度控制，token 按副模型输入价实记（source='vision' 独立记账）
- **generate_image 改用副模型配置**（需支持 OpenAI Images 端点）；副模型密钥进 KEY_FIELDS + partialize 脱敏
- **测试**: 826 passed + 15 skipped；tsc 0；check-consistency 31/31

### v16.1.0 章节协作改写（2026-08-10，双路审查：UX 人类视角 + agent 破坏性逻辑审查）
- **章节创作界面 × AI 写作助手 协作改写**: 选中段落 → 右键「发送到 AI 写作助手」→ 建立 chapterCollab 关联（锚=段落首尾20字，text=编辑器内存态权威源）→ 用户提要求 → AI 调新工具 **editor_rewrite(anchor,newText)**（第 33 工具）→ 渲染层消费一次性 action → 编辑器**特效改写**（旧文字淡出→打字机原位逐字→单次 transaction 提交，Ctrl+Z 单步撤销）→ 不落盘，切章/退出自动保存
- **「加载本章/刷新本章」按钮**: 一键让 AI 了解本章（无需选中文字）；AI 直接改文件后手动同步编辑器（needsReload 橙色高亮+圆点提示）
- **上下文注入开关**: 聊天窗 chip「AI 已加载本章全文 ✕」可取消（完全不注入不背 tokens）；取消后可一键重新关联；编辑器 badge「AI 协作中·第N章」+ 特效遮罩取消按钮
- **权威源 = 编辑器内存态**（chapterCollabStore.text 随 onChange 实时同步）；注入块明示「磁盘可能落后，不要 read_file 获取本章内容」
- **全文注入走 user 消息参考信息块**（分段缓存命中）+ **变更才注入+5 轮心跳**成本优化（未变轮只注入锚点+版本）
- **协作只读围栏**（toolExecutorFactory Layer 5）: 关联模式拦写当前章文件（主/子代理统一生效），其他文件照常可写；路径 `/chapters/{id}.txt` 形态比对；返回引导「请用 editor_rewrite」
- **完成判定接线**: FILE_WRITE_TOOLS + _hasWriteCall 双置位 editor_rewrite；协作模式 nudge 引导 editor_rewrite；detectHallucination 补 editor_rewrite；AuditTrail+OpHistory 双处脱敏（anchor 100 字/newText 长度）
- **锚点降级匹配链**: 精确→首尾20字→单首20字→失败引导 search_content 重试；锚点栈 3 版防漂移；改写成功后自动更新
- **特效状态机**（rewriteEffect.ts）: 淡出 400ms → 打字机 12ms/字（>5000 字跳过）→ 单次 transaction；isAborted 中断通道；特效期间禁编辑；DOM 零 dispatch 不触发 onContentChange 循环
- **双路审查修复批**: 切章失配自动 detach / cancelRewrite 真 abort 通道 / ✅确认消息真实结果驱动（lastRewriteApplied）/ 返回+beforeunload 过守卫 / 守卫弹窗瘦身（取消(留在本章)/放弃改写并离开）/ 同轮双 editor_rewrite 竞态（WRITE_TOOLS 串行化）/ 幻觉误报 / _hasWriteCall 接线 / 围栏路径误拦收紧 / 子代理提示词补围栏说明 / 打字机原位消除跳动 / 选中过短 toast / 右键菜单副标题 / attach 即时 toast
- **测试**: 816 passed + 15 skipped（含真实 TipTap 集成测试 7 例：提交+撤销/禁编辑/原位打字/abort 取消/超长/越界/回调顺序）；tsc 0；check-consistency 31/31

### v16.0.3 审查修复批次（2026-08-10）
- **P1 Anthropic 混合轮 tool_use 修复**: serverToolBlocks 存在时不再跳过本地 tool_calls 转换——同轮模型既调 web_search（服务端）又调本地工具时本地 tool_use 被丢弃 → 下轮孤儿 tool_result 400。现 server_tool_use/web_search_tool_result 与本地 tool_use 并存回传（web_search 跳过防双份），单元验证 PASS
- **P1 网络瞬态重试补 cause 链**: V4UnifiedRuntime isTransient 递归检查 3 层 cause 链 + 正则补 fetch failed/socket——DeepSeek 服务端间歇断连（SocketError: other side closed）的 fetch failed 错误真实原因在 err.cause，原判定 false 不重试一次断连直接失败；测试脚本同款重试
- **P2**: Responses 孤儿 tool 转文本 user（对齐 Anthropic F1，测试断言同步）/ edit_file_task 缓存失效+GUI 通知（CacheInvalidator 两处补）/ changed 后重读无条件 recordRead（不再指向旧版本）/ batch_replace __FULL_REPLACE__ 非末项报错（原静默丢项）/ cache_creation 成本漏算（anthropicHandlers+AnthropicAdapter 两处补）
- **P3 批**: Anthropic effort 三档归一化（残留 medium 400）/ web_search 注入条件对齐（防双通道联网）/ verify_task detail 重截断 / 会话 key 路径归一化（normalizeSessionPath）/ search_content 结果 50K 截断 / summarizePairs 首段 400 字保护 / FNV-1a Math.imul / dup 防呆计数重置 / 子代理失败会话失效 / UI 接线（工具计数/ABORTED 文案/续跑快照回扫/kb_analyze 长度统一/notes topK 兜底）
- **测试脚本**: CA4 allowComplete + CA9 断言矛盾修复 + callDeepSeekAnthropic 网络重试
- **version_history.json 非法 JSON 修复**: 16.0.2 条目 `\s` 未转义（设置页版本界面 JSON.parse 崩溃风险）
- 测试 775 passed + 15 skipped；tsc 0；check-consistency 31/31；真实 API 全场景 10/10 通过（CA11 473.5s 全程零断连失败，缓存 77-93%）

### v16.0.2 系统性审查回归修复（2026-08-09）
- **F1（P1，v16.0.1 M11 回归）**：跨 run 还原的 hist_ tool 消息（无前置 assistant.tool_calls）在 Anthropic/OpenAI 协议路径成孤儿 tool_result → 400。修复：AnthropicAdapter.messagesToAnthropic 孤儿转 **text 块**（不 400 且内容保留供 ReadResultTracker 指纹）；aiHandlers 双路径同样转纯文本；实测 CA11 多轮工具+子代理全程无 400
- **F2（P2）**：hist_ id 全局递增（buildHistoryMessages 与 rebuildFromHistory 共享计数序列）——原 per-message 下标碰撞致早轮记录丢失
- **D-1（P1，v16.0.1 回归）**：NEG_DONE_RE 收窄为 `都(?:还|仍|未)(?:没)?`——"都完成了"正面收尾语不再被当否定拦截（原组合爆炸致 30 轮 nudge 空转）
- **A-2（P1，v16.0.1 回归）**：CONTINUATION_RE 重写为 `(?<!不)(?:接着|还要|再)\s*(?:做|写|改|创建|生成|填充|处理)`——"接着写第2部分"匹配（原 lookbehind 恒真 + 只收"做"）
- **A-1（P2）**：REFUSAL 出口两处加问句守卫（清单 :748 / 无清单 :893）——带问号的 50+ 字文本不被当困难任务收尾
- **D-3（P2）**：toolResultsCollected per-run 重置；**P3**：recordToolCall 接线（脱敏 args 进审计）
- 测试 775 passed + 15 skipped（+4：F1 孤儿过滤 2 + T28/D-1 1 + M13 精确断言 + 不再做）；tsc 0；check-consistency 31/31；真实 API CA11（517s 通过，无 400）+ CA1（277s，93.1% 缓存）

### v16.0.1 审计修复批次（2026-08-09）
- **严重问题全修**：S1 停止生成释放发送锁（abortToolLoop 补 sendLockRef=false）；S3 kb 索引失败 chunk 不入 index + 如实报告 failedCount（embedChunks 纯函数）；S4 写工具超时孤儿执行提示（note 引导先 read_file 确认现状）；S5 GLOBAL_DONE_RE 否定排除（NEG_DONE_RE：还没都完成/没搞定等）+ PARTIAL 补「这/那/剩下 N项都完成」形态；S6 自愈出口可达（「说完成但没写」补 _nudgeCount++ + 清单/无清单双路径 REFUSAL 出口）
- **中等问题**：M2 深度压缩首条 user 保护 400 字；M3 单 user 压缩空转修复（按最近 N 条 tool 消息保护）；M4 @引用不受 KB 开关门控；M5 pipeline usage 补 cached_tokens；M6 会话记录导出指纹变更检测；M7 关窗 inFlight 保存不丢弃；M10 KB 排除窗口 3→5；M11 跨 run 去重真正生效（持久化 _toolResults → 还原 tool 消息 → rebuildFromHistory 真实指纹）；M12 重试正则补瞬态错误；M13 CONTINUATION_RE 增补（接着/还要/再做/然后继续）；M14 自愈阶梯前几轮补 pushRoundText；M15 endRun 竞态守卫（统一 runId）；M16 OpenAI 协议 abort 补记 tokens
- **轻微项**：changed 随重读重置 / retry backoff 响应 abort / lastSnapshotInjectedIdRef 随会话切换重置 / anthropicHandlers 中止补记 cache_read / kbTools 指纹 16→40 字
- **审阅新增**：N1 [验收提示] 进 AnthropicAdapter 易变前缀名单；N2 edit_file_task 的 recordWrite 遗漏（重读提示 changed）
- **确认不修（迁移自审计报告）**：S2 闭包陈旧=设计语义（测试脚本 test-ai-agent.mjs 注释自证）；M8 per-request abort 链路已完整；M1 [当前任务] 缓存 v16 断点判定已处理；M9 OpenAI 端命中率需实测；updateTaskProgressFromText 单调置位=设计；清单提问 break 不置 interrupted=设计；进度条三处近似可接受
- 审计报告 agent-audit-2026-08-09.md 已完成使命删除；测试 771 passed + 15 skipped；tsc 0；check-consistency 31/31

### v16.0.0 知识库三级目录 + UI 重设计 + 测试时间预算 + 会话记录 (2026-08-09)
- **知识库三级目录**: KnowledgeFile.folder 字段（根/一级/二级）+ kb:listFolders/createFolder/renameFolder/deleteFolder/moveFile 5 个 IPC + KbFolderTree 目录树组件；知识库页面重设计（目录树+文件列表双区/面包屑/文件夹操作/字体放大/Toast）；AI 工具层自动同步 metadata 归属
- **知识库勾选大弹窗（KbSelectionModal）**: AI 写作助手「文件」按钮 → 860px 弹窗（三态切换+搜索+左目录树+右大勾选框列表），替代原 220px dropdown
- **测试时间预算**: test-ai-agent.mjs 每场景 maxSeconds 超时上限 + --budget 缩放；场景 11 个（CA11 综合：角色扮演→生成→极限扩写 2 万字→极限修改，实测 420s 通过缓存 76%）
- **会话记录文件夹**: chatRecordService 每个会话导出 .appdata/chat-records/<会话名>/（conversation.json + api-calls.jsonl + tools.jsonl + summary.json）；apiCallDetails API 逐轮明细（缓存命中率可算）
- **提示词强化**: 大文件双重判断（字数+用户意图）+ 模糊描述定位策略 + search_content 机制说明；子代理位置意识 + 指令模糊收敛
- **缓存断点修复**: AnthropicAdapter 末块易变才前移断点（角色模板场景核心规则全缓存）
- **mock 对齐**: read_file 50 万截断/edit_file 匹配策略/search_content 参数/fetch AbortController
- 审计: v16.0.1 批次已全修（S1-S6 + M2-M16 确认项 + 轻微项 + N1-N3），确认不修结论见「当前架构 v16.0.1」段；审计报告文件已删除

### v15.6.0 read_file 去重层 + 大文件精准修改 (2026-08-09)
- **ReadResultTracker 去重层**（src/agent/context/ReadResultTracker.ts 新建）：解决"同一文件多次讨论修改，旧版本信息重复上传"核心痛点（对齐 Claude Code FileRead 去重层）——同 run 内同文件同范围重复 read → 'dup'（发"已读取过，见前文第 N 轮"提示，不重发全文）；文件被写工具修改过 → 'changed'（发"已修改+位置"提示，引导 search_content 定位或 offset/limit 精确读）；FNV-1a 内容指纹确认前文仍完整在上下文（被压缩清理则放弃去重）；防呆计数器（连续 dup≥2 第 3 次强制完整回传）；写工具（含子代理 edit_file_task）成功后失效；per-run 生命周期 + rebuildFromHistory 历史重建（覆盖跨 run）；writeSummary 单一实现（ToolExecutor 与 rebuildFromHistory 共用）
- 注入点：ToolExecutor.executeSingleTool（filterForContext 后 push 前，read_file 去重替换 + 写工具 recordWrite）；V4UnifiedRuntime（per-run 新建 + execCtx 注入）
- **提示词「大文件精准修改流程」**（V4SystemPrompt 文件操作指南新增）：① 用户已给位置→直接 edit ② 位置不确定→先问用户 ③ 明确位置→search_content 定位→read offset/limit 精确读（≤3000字符）④⑤ 去重提示理解；实测 CA10 场景（25.7KB 章节 4 轮修改）第 2 轮起模型不再重读全文，全部 search_content+batch_replace 精准修改
- **缓存语义修正（探针实测确认）**：DeepSeek Anthropic 端点 usage 为互斥语义（input_tokens 不含 cache_read，相加=总输入）——anthropicHandlers 合并 input+read 再算成本（修复 effectiveInput 减成负数归 0 的漏算）；AnthropicAdapter totalTokens 加 read；测试脚本缓存命中率统计（真实口径 read/(input+read)，实测平均 86%/末轮 98.9%）
- 测试 740 passed + 15 skipped（755，+17：ReadResultTracker 14 + V4Simulation 2 + 提示词 1）；tsc 0；check-consistency 31/31

### v15.5.0 AI 写作助手增强 + 协议/联网全面 (2026-08-08)
- **深度思考开关双向生效**：关闭时显式 thinking:disabled（OpenAI/Anthropic）+ reasoning.effort:'none'（Responses）——修复"思考模式默认打开导致开关失效"（官方文档确认）；effort 三档 low/high/max（normalizeEffort 归一化；Anthropic output_config.effort；Responses 无 max 映射 high）；输入框内 #工具 旁 effort 按钮（三档显示当前值）+ 温度失效提示（思考开启置灰删除线）
- **Anthropic 协议原生联网**（服务端 web_search 工具）：DeepSeek 官方文档确认 server_tool_use/web_search_tool_result Supported；AnthropicAdapter 在 DeepSeek 官方端点 + 原生联网时注入 web_search_20250305 服务端工具；handler SSE 捕获 server_tool_use 块；多轮回传 serverToolBlocks 原样保留；ToolExecutor 跳过本地执行
- **OpenCode Go 支持**：buildAnthropicUrl 识别完整 /v1/messages 路径；ai:listModels 剥离 /v1/messages；shouldUseResponses 支持 gpt-* 模型走 responses 通道（路 B）；PROVIDER_PRESETS 添加 OpenCode Go
- **联网死区修复**：BridgeContextBuilder 跳过 DDG 仅当 shouldUseResponses 真跑（Anthropic 协议+原生联网时回退 DDG）；联网按钮如实显示
- **输入框 v3**：融合对话框（去卡片底座，聚焦紫高亮）+ 拖拽手柄上移（向上拖增高）
- 测试 723 passed + 15 skipped；tsc 0；check-consistency 31/31

### v15.4.0 知识库场景化设置 + 片段注入模式 (2026-08-07)
- 注入方式双模式（全量/片段）：生成功能（章节/批量/角色）可选择「全量注入」（现状：文件全文截断注入，perFile/total 上限）或「片段注入」（用户输入关键词 → 向量化语义检索 topK 相关片段注入，topK 取设置）；片段模式关键词为空自动退回全量、检索零结果不注入（不做静默回退全量）
- 知识库设置三场景独立卡片：AI 写作助手（agent，恒语义检索）/ 章节生成·批量生成（chapterGen）/ AI 生成角色（characterGen），每场景可调注入方式 + searchTopK + 两个注入上限；generation 旧键保留为 @deprecated 兜底（getSceneKb 双保险回退）
- knowledgePipeline 重构为单一真源：复活死代码 searchKB/injectChunks → searchKBMulti（多关键词分别检索+去重+score 降序）/ injectKnowledgeForScene（统一入口）/ buildKBBlock（批量预取一次 N 章复用，full 每文件仅读 1 次、chunk 仅 1 次检索）/ getSceneKb；KB_INJECT_SCORE_THRESHOLD 从 BridgeContextBuilder 收敛至此；删除死代码 injectKnowledge；使用指引文案增强（三处统一：「必须融合进正文/无关直接忽略/不要复述参考」）
- 批量生成删内联 KB 实现（原不消费 totalMaxChars、不按【创作要求】定位）；AI 生成角色删内联实现（统一走 buildKBBlock）；章节生成 kbInjectMode/kbKeywords 随 ChapterGenSettings 持久化，批量/角色弹窗内 state
- store persist version 8→9（generation → chapterGen/characterGen 同值拆分，保留兜底键）
- 测试 711 passed + 15 skipped（726，+17 knowledgePipeline）；tsc 0；check-consistency 31/31

### v15.3.1 输入框拖拽修复 + 角色模板知识库设定文件 (2026-08-06)
- 拖拽修复：手柄改 flex 布局置于 textarea 正下方（跟随其底缘，拖拽时手柄随鼠标走，方向感正确——原 absolute bottom:38 固定导致"往下拉、顶部悄悄上移"的反直觉）；textarea 内容超出时自动增高（scrollHeight，上限 220px，不收缩保留手动高度）；手柄 14px 高 + hover 紫色高亮
- 角色模板知识库设定文件（分组补充语义，用户决策）：RoleTemplate 拆 **worldKbFileIds（世界观设定文件）+ scenarioKbFileIds（场景对话设定文件）**，两组互斥（同一文件不可两边勾选，防 AI 读取归属冲突）；设置弹窗世界观/场景卡片**正下方各内嵌一个文件勾选区**（SettingFilePicker 组件，勾选自动从另一组移除 + 已选入对方时禁用标注）；未勾选 + 知识库开关关闭 = 完全不检索不调用（无"每轮必用知识库"）；BridgeContextBuilder 两组都进检索范围（与 selectedKbFileIds 合并，独立于渲染层「知识库」开关）；提示词**分两段**点名文件名（[世界观设定文件]/[场景对话设定文件]，构建时查 kbService.list 映射 id→originalName）+ **酒馆世界书理念的使用规则**（用户决策）：优先基于已有信息（含已注入片段/此前查阅结果）作答——**已了解的信息不重复查阅**；仅当信息不足或矛盾时才查阅：kb_search 定位 → 小文件 read_file 全文 / **大文件优先 kb_analyze**（子代理深度分析回传精简总结，避免全文占大量上下文；read_file 全文仅当轮 tool_result 可见、历史保留 5 工具轮后折叠为摘要需重读）
- 知识库注入相关度阈值（对齐酒馆"不激活不注入"）：KB_INJECT_SCORE_THRESHOLD=0.3——cosine score 低于阈值的片段不自动注入（省 token + 减噪音；缺 score 旧数据默认注入；kb_search 工具不受限，AI 可自查）
- 主/子 agent 分工强化（对齐 orchestrator-worker 最佳实践，用户决策）：V4SystemPrompt 新增「重任务优先委托」原则（大文件读取/分析 >2万字符、长文件精确修改、知识库深度分析、多文件综合总结 → 优先委托 analyze_file/edit_file_task/kb_analyze，子代理独立上下文只回传摘要，主 agent 上下文保持轻量；简单任务直接用工具不委托）；read_file 超 50 万字符截断提示追加委托引导（建议 analyze_file 或 offset/limit 分段读，不再让主 agent 硬扛超大文件）
- 主/子 agent 人设隔离确认 + 角色角度传递（用户提醒）：子代理上下文 = ROLE_PROMPTS 独立提示词 + 任务消息（无对话历史/无角色模板/KB 注入，SubagentService.setContextAssembler）——主 agent 角色扮演人设不会污染子代理；唯一缺口已补：角色设定文件提示词引导主 agent 委托 kb_analyze 时在 query/focus 传分析角度（角色扮演设定要点：性格/关系/说话风格/世界观约束/禁忌，而非泛泛资料摘要——子代理看不到扮演设定）
- 上下文压缩策略重构（用户决策）：ContextCompressor 阈值参数化（CompressionThresholds 默认 0.7/0.8/0.9）+ 新增 compressDeep 链式方法（strip → 早期摘要 → 早期折叠，一次到底）——**主 agent**：chatBridgeFactory 传 thresholds 0.85/0.9/0.95 + deepAt 0.85（85% 才自动压缩，链式一次到底，进度条 ~85% 回退 ~15%，轮间执行不影响任务）；**子 agent**：SubagentService 传 0.75/0.85/0.95 渐进（75% 自动，无提醒）；AIChatWindow 进度条 **50%/70% 弹窗提醒**（各档一次，不自动压缩，ConfirmModal「知道了」）；压缩发生在 runtime 轮间（V4UnifiedRuntime:486-496）不打断任务
- 缓存结论（调研）：角色模板全量注入位于 Anthropic 缓存断点（倒数第二 system 块=核心规则）之前——模板不变每轮命中缓存；切换/编辑模板才重写一次；KB 动态注入走 user 消息不进缓存前缀，缓存效率只升不降
- 测试 693 passed + 15 skipped（708，+9：ContextCompressor 4 + BridgeContextBuilder 5）；tsc 0；check-consistency 31/31（v15.4.0 后 711 + 15 = 726）

### v15.3.0 AI 写作助手输入框改造（仿 DeepSeek）+ #工具提示 (2026-08-06)
- 一体化输入框：输入区 + 发送按钮同框（圆角 18 容器统一描边/阴影，textarea 无边框，发送按钮移至容器内右下角 34px）；#工具按钮位于容器底部左侧（DeepSeek 输入框下方按钮位），显示已选数量 badge
- #工具提示：点击 # 按钮弹出工具列表（数据源 = 真实工具注册表 ALL_TOOLS 32 工具，带搜索过滤，可多选，再次点击取消）；输入框上方显示 "#工具名" 蓝色加粗 chips（与 @引用紫色区分）；仅按钮选择生效——手输 # 不解析（防 prompt 混淆）
- 软提示语义：随消息发送 `[工具提示: 用户建议本轮可能使用到以下工具（仅供参考，非强制...）: #create_file ...]`（buildToolHintText 纯函数，防御性去重+合法名校验）；不强制/不限制 agent 工具选择；「调用工具」开关关闭时 popover 顶部警告
- 发送后/切换对话清空工具提示状态；@引用 popover 对齐新容器（left/right 16）
- 测试 684 passed + 15 skipped（699，+4 buildToolHintText）；tsc 0；check-consistency 31/31（v15.3.1 后 688 + 15 = 703）

### v15.2.1 模型定价修正 + 选模型自动调价 + 联网查价 (2026-08-06)
- 定价默认值修正：v15.1 把 DeepSeek V4-Flash 定价映射错位（0.02/1/2）→ 修正为输入（缓存未命中）1 / 输出 2 / 输入（缓存命中）0.02（元/百万 tokens）；configMigration 增「错位三元组修正」（三字段全等于错位值才改，用户改过任一个则整组不动）
- 内置价格表 src/utils/modelPricing.ts：30+ 主流模型（DeepSeek/OpenAI/Anthropic/Gemini/智谱/千问/Kimi）2026-08 核实价；选模型自动填 货币+输入+输出+缓存命中+上下文窗口
- 联网查价：主进程 ai:fetch-model-pricing（netFetch 走系统代理，拉 OpenRouter /api/v1/models 免密钥，USD/百万 tokens，15s 超时）；设置页「🔗 联网查价」按钮匹配当前模型实时更新
- 测试 680 passed + 15 skipped（695）；tsc 0；check-consistency 31/31（v15.3.0 后 684 + 15 = 699）

### v15.2.0 精准改写强化 + 默认模型配置 DeepSeek 化 (2026-08-04)
- 改写·精准改写：整章改写强制「未标记段落逐字保留」（情色内容保持原样）；场景段改写输出范围约束；needsRewrite=false 保留原文章节不再被改写（批量+单章保护）；enforceTemplateRewrite 匹配面扩展（categories+markers 双查）
- 改写·场景合并规则：恢复允许合并（连续同类型/相似场景如亲密+亲吻合并为最能概括的场景，防重复改写）
- 默认模型配置：新模板 = DeepSeek + anthropic 协议 + 原生联网 + 1M + CNY + 定价 1/2/0.02（v15.2.1 修正）；新增 configMigration.ts 字段级迁移（旧默认字段自动更新、自定义字段不动，App 启动执行）
- 死代码清理：mergeAdjacentSegments（零引用）；chatStorageService 过时注释
- 测试 664 passed + 15 skipped（679）

### v15.1.0 小说改写全面升级 + AI写作助手增强 + 打包流程修复 (2026-08-04)
- 改写：总结阶段 JSON 解析容错 + 120s 请求超时保护（防批量"一直闪绿灯"）+ 重总结失败保留旧数据 + 批量全失败不推进阶段；章节拆分误判排除（第X节课/第三回合等正文段落，6 处共用全局生效）；改写本章按钮 + 插入信息勾选区（情节概要/角色信息/关键事件/本章原文，注入顺序：参考→场景标记→改写要求恒最后）；改写字数语义修正（额外扩充X字）+ 场景段改写按占比接入加料目标
- 改写：项目设置弹窗放大可编辑（模型/并发线程/改写字数/提示词模板/总结信息）；新建向导 +「总结信息」步骤（项目级 summaryConfig）；顶栏模板只读 + 查看按钮（跳转提示词管理定位）；提示词管理 +复制按钮（名称自动加（N））+ 删除确认弹窗；清除本章数据按钮（总结/改写阶段）；修复 loadAllRewrites 达标判定/已删模型配置回退全局/模板已删显示
- AI 写作助手：+深度思考开关（DeepSeek V4，立即生效）；原生联网聊天窗可开关；删除对话/审批弹窗约束浮窗内（transform 包含块）
- 模型列表刷新：超时 8s→15s + 服务商选择引导
- 打包：scripts/package-dist.sh 一键安全打包（自动清理 userdata + zip 硬闸门复检，修复 v15.0.0 分发事故）
- 测试 660 passed + 15 skipped（675）

### v14.9.0 五路审计修复 + 大文件专项 (2026-08-02)
- 上下文窗口默认 1M（8 处同步）；大文件流式搜索（search_content >2MB readline 逐行，仅 multiline 跳过）；read_file 结果 50K；list_directory 500 条截断提示
- 续跑语义收紧（hasResumeIntent 意图门控 + resume 强制文件语义 + taskDone 快照置位）；完成判定加固（_hasWriteCall 成功置位 + FILE_WRITE_TOOLS 文件写证据闸门 + PARTIAL 补"前N项" + 自愈出口）
- 协议/IPC（SDK 超时 180s/SSE 中止竞态/abortStream requestId/include_usage/reasoning 降级透传/中止补记）；工具/子代理（edit_file 实体复核+替换预览/kb_analyze 查询指纹/kb_index_file 写序列/会话 key 角色隔离/executeSingleTool 兜底）
- UI（@引用接线/模型切换禁用锁定/执行计划面板+反馈横幅接线/状态标签复活/审批清理/存储 flush）；SSRF 169.254；文件限制设计文档化（记忆 file-limits-design.md，禁止"跳过/拒绝"类限制）
- 测试 655 passed + 15 skipped（670）；tsc 0；check-consistency 30/30

### 全部遗留优化项收官 (v14.8.0)
- **DeepSeek 原生联网搜索（完整 ResponsesAdapter）**: ModelConfig.nativeWebSearch 勾选 → agent 工具循环经 `ai:responses-chat`（主进程流式聚合 + UNSUPPORTED 自动降级 chat.completions）走服务端 web_search 原生工具；模型自主调用（agentic）；软件内置 DuckDuckGo 搜索自动停用（单一联网通道）。路由单一决策源 `responsesRouter.shouldUseResponses`；消息转换纯函数 `electron/ipc/responsesConverter.ts`（items 回传 call_id 语义、孤儿 tool 裁剪、web_search 注入）。实测约束：thinking 下 tool_choice:{type:'function'} 400 → 只用 auto；previous_response_id 不支持 → 全量 items 回传
- **Agentic RAG — kb_analyze（第 32 工具）**: 委托只读子代理深度分析知识库（多次 kb_search + read_file 全文 → 结构化总结 ≤8000 字）；子代理检索不受 5 条/500 字预注入限制；会话 key `::kb-analyze` 复用（subagent_ask 可追问）
- **KB 跨 run 重复注入修复**: 模块单例 injectedKbFileIds 删除 → per-run 实例字段（execCtx → ToolExecutionContext.kbInjectedFileIds → kb_search 排除集）；本轮注入 id 随 assistant 消息持久化（kbInjectedFileIds）→ 下轮 SendOptions.excludeKbFileIds 排除
- **双协议 pipeline thinking 对称**: ai:chat/ai:chat-stream 接入共享 buildThinkingParams（原 OpenAI pipeline 无 thinking、Anthropic 有）
- **export-tool-schemas.ts 重写**: 从真实注册表 ALL_TOOLS 导入（subagentTools 惰性化解除 Node 挂起）；--check 名称+内容深比较；check-consistency C1 调用 --check
- 644 passed + 15 skipped（659）；对话场景 32

### AI 写作助手全面审计修复 (v14.5.0)
- 清单门控修复（GLOBAL_DONE_RE 裸锚点删除 + PARTIAL_DONE_RE 排除部分声明）；Anthropic 安全收窄（capabilities 接线 + toolsUsed 保留 + 子代理恒全量）
- thinking 双协议回传；停止生成 aborted 语义；HTTP 工具 detail 保留（4000 截断）；审批 60s 超时 + WAITING_APPROVAL + broad 条件审批
- 子代理 6 项（超时 abort/并发分片/操作记录隔离/会话池 TTL/verify 降级）；空响应角色交替；IME 防护；自动滚动；存储防抖合并；幻觉检测接线；token 条守卫；字数遵从（S_LEN）
- 620 passed + 15 skipped（635）；对话场景 32

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
- 渐进披露: 首轮全量32工具 → 后续15核心 (含 tool_search 动态发现；v14.8: +kb_analyze)

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
| Agent 工具列表 | `src/agent/skills/tools/index.ts` (34 工具) |
| Agent Runtime | `src/agent/runtime/V4UnifiedRuntime.ts` |
| 协议适配器 | `src/agent/runtime/adapters/` |
| 格式模板 | `.aiharness/templates/` (15 格式 + 7 写作手册) |
| 版本历史 | `src/data/version_history.json` (当前 v16.2.0) |
| 跨会话记忆 | `~/.claude/projects/d--3/memory/MEMORY.md` |
| 验证脚本 | `scripts/check-consistency.sh` + `scripts/measure-token-density.mjs` + `scripts/test-ai-agent.mjs`（7 复杂场景） |
| 遗留工作 | `.aiharness/design/pending-fixes-v14.3.md` (9 项全部完成；④ 校准数据在 token-estimation-data-2026-08-01.md) |

## 验证命令

| 命令 | 用途 |
|------|------|
| `npx tsc --noEmit` | TypeScript 类型检查 |
| `npx vitest run` | 全量单元测试 (826 passed + 15 skipped，共 841) |
| `npx vitest run src/agent/__tests__/` | Agent 专项测试 (303 passed + 14 skipped，共 317) |

## Agent 复杂任务测试（v14.9.x 新脚本，替代旧 32 场景脚本）

```bash
cd /d/3/novel-writing-app
export AI_API_KEY=sk-xxx  # 替换为你的 DeepSeek API key

# 全部 7 个复杂场景 (~25分钟)
npx tsx scripts/test-ai-agent.mjs

# 指定场景
npx tsx scripts/test-ai-agent.mjs --scenario=CA1,CA2
```

测试通过真实 Bridge → Runtime → Adapter 运行，mock window.electron IPC 层（行为与主进程对齐：
备份目录 .ai_backups 软约束——写工具拒绝+引导性错误、读工具放行；kb_search 真实检索 knowledge_base/files/）。
专用测试项目 `agent-proj`（不触碰用户项目），7 个复杂任务场景：

| 场景 | 覆盖能力 |
|------|---------|
| CA1 细纲流水线 | 多阶段编排 / JSON 校验 / 字数遵从（≥1000字） |
| CA2 子代理全链路 | analyze_file→edit_file_task→verify_task 验收闭环 |
| CA3 搜索→批量→删除 | search_content 定位 / batch_replace 全局替换 / delete |
| CA4 跨 run 续跑 | 任务清单中断快照 / [续跑] 恢复不重复 |
| CA5 知识库 Agentic RAG | kb_search 检索 / kb_analyze 深度分析 / 结论落盘 |
| CA6 重命名+校验修复 | rename_file / 损坏 JSON 修复 / YAML 创作 |
| CA7 角色扮演创作 | 角色外壳下多文件创作不受影响 |

旧脚本 test-ai-conversation.mjs（32 简单场景）已废弃（v14.9 起删除，由 `scripts/test-ai-agent.mjs` 替代）。
