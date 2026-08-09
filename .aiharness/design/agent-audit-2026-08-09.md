# AI 写作助手 Agent 全面审计 — 问题与优化清单

> 2026-08-09 · 四路并行只读审计（Runtime 主循环 / 工具层与安全 / 上下文与缓存 / 子代理与协议）**全部完成**
> 本文件为**问题清单与后续工作指引**，不含代码改动；在新会话中复制"情况说明"部分继续优化

## 严重问题（影响正确性/数据安全，优先修复）

### S1. abortToolLoop 不释放 sendLockRef → 停止生成后发送按钮永久锁死
- **位置**：`src/components/ai/AIChatWindow/index.tsx:487-495`（abortToolLoop）+ :590（handleSend 置位）
- **问题**：`abortToolLoop` 调 bridge.abort()/abortStream()/setLoading(false)，但**没有 `sendLockRef.current = false`**。若 abort 触发的 bridge 中止被吞掉（不 reject），`:589 if (sendLockRef.current || loading) return` 永久拦截后续发送。sendLockRef 仅在删除会话时被置 false。
- **触发**：点击"停止生成"后再发消息 → 永久无响应；切换会话后新会话也被锁死
- **修复建议**：abortToolLoop 中补 `sendLockRef.current = false`

### S2. handleSend 历史闭包陈旧 → 最新 user 消息不在 buildHistoryMessages 输入内
- **位置**：`src/components/ai/AIChatWindow/index.tsx:687-690, 710-730`
- **问题**：userMsg 用 setMessages 追加后，handleSend 的 `messages` 闭包仍是**追加前的旧值**——`buildHistoryMessages(messages)`（L710）与 `bridgeRef.current.sendMessage(fullContent,...)`（L741）均不含刚入列的 user 消息。runtime 的 pushRoundText/空响应兜底依赖 messagesForApi 尾部为最新 user——nudge 轮注入的 user 内容接在旧 user 之后，经 messagesToAnthropic 合并成一条含多个文本块的 user 消息 → **Anthropic 端点 400**。
- **触发**：多轮工具调用/长任务消息序列（结构性，非偶发）
- **修复建议**：sendMessage 前把当前 user 消息并入 historyMessages（对齐测试脚本 runScenario 修复——每轮 user 在 send 完成后入历史，下轮可见）

### S3. kb_index_file 静默假成功 → embedding 逐块失败仍报"索引完成"
- **位置**：`electron/ipc/kbHandlers/index.ts:271-283 + 300-307`
- **问题**：indexFile 中每个 chunk 的 getEmbedding 失败只 logError，随后把 `embedding: []` 的空向量 chunk push 进 index 并 saveIndex，返回 `{chunkCount}`。kb_search 用 `c.embedding.length > 0` 过滤 → **空向量 chunk 永远搜不到**。工具报告 success"索引完成"，模型以为知识库已可检索，实际 kb_search 恒返回零结果。
- **修复建议**：embedding 失败的 chunk 不入 index（或返回 failedCount，工具如实报告"部分失败"）

### S4. 非子代理工具超时后孤儿执行 → 写工具超时后仍会落盘
- **位置**：`src/agent/runtime/ToolExecutor.ts:190-211`
- **问题**：perCallCtrl 只对 5 个子代理工具创建；edit_file/batch_replace/create_file 等普通工具的超时 Promise 只 resolve 错误，底层 IPC 请求继续在途执行——超时后模型以为失败，实际文件已被修改（超时竞态双写/错改）。
- **修复建议**：写工具超时后记录"已提交但结果未知"，模型重试前先 read_file 确认现状；或 ipcExecute 透传 signal

### S5. GLOBAL_DONE_RE 的 `都.*完成` 无否定排除 → 可被"否定/量化"句式确定性绕过清单门控
- **位置**：`V4UnifiedRuntime.ts:53, 701`
- **问题**：GLOBAL_DONE_RE 含 `都.*完成`（"这3项都完成了"/"任务都完成"均命中），对命中文本无否定前瞻。PARTIAL_DONE_RE 只覆盖 `第N项/前N项/任务X/Y/已完成N项`——**"这N项都完成了""剩下N项都完成了"不命中 PARTIAL**（v14.6.1 修过"第2章都完成了"、v14.9 修过"前N项"的同一漏洞族，注释 L58 自己承认但仅补两种形态）。更糟：**否定句"还没都完成"同样命中**。
- **触发**：清单模式模型写"这2项都完成了，还有3项…"（已写过文件）→ markAllDone → 有文件证据时直接 break，剩余任务静默丢失
- **修复建议**：`都.*完成` 加否定排除（`(?<!没|未|不)` 类）；PARTIAL 补 `[这那剩]?前?N项` 形态

### S6. "说完成但没写"两条 nudge 分支不递增 _nudgeCount → 自愈出口永久失效
- **位置**：`V4UnifiedRuntime.ts:704-710, 773-780`
- **问题**：对比 L747/890（其他 nudge 有 `_nudgeCount++`），唯这两处"你说完成但没写"分支 pushRoundText + continue 而**不计数**。REFUSAL_RE 自愈出口要求 `_nudgeCount >= 8` → 对该循环永远不触发。
- **触发**：模型坚持口头声明"完成"而不实际调写工具 → 循环空转至 maxIterations=30 轮，每轮一次全量上下文 API 调用（1M 窗口），成本远超一次正常任务
- **修复建议**：两处加 `_nudgeCount++`

## 中等问题（影响效率/可靠性）

### M1. [当前任务] 易变 system 块位于缓存前缀内 → 任务型 run 可能整段缓存失效（需实测复核）
- **位置**：`V4UnifiedRuntime.ts:253` + `AnthropicAdapter.ts:207-231, 164-171`
- **问题**：injectTaskStatus 以 system role push 到 messagesForApi 末尾；messagesToAnthropic 给除最后一条外所有消息打 cache_control（断点被消息段扩展到 system 段之后）——按标准前缀缓存语义，[当前任务] 每轮变化令**整个前缀失效**。v16 断点前移只在"无历史消息"首轮生效（恰是任务 run 不需要缓存的场景）。v15.6 实测平均 86% 命中率说明 DeepSeek 可能按断点分段独立缓存——**需用带任务清单的真实 run 复核**。
- **修复建议**（若实测确认）：[当前任务] 改为 user role 注入（与 [续跑]/[子代理快照] 同方案）

### M2. compressDeep 深度压缩后原始用户请求被截断为 80 字 → run 中途永久丢失
- **位置**：`src/agent/context/ContextCompressor.ts:257-258, 265`
- **问题**：collapseEarly 摘要仅取折叠区最后 3 条 user 的前 80 字。单 user run 的折叠区恰是用户原始请求——长请求在 run 进行中被压成 80 字，后续轮次可能偏航或向用户重问。
- **修复建议**：collapseEarly 显式保护首条 user 消息全文（或至少 400 字）

### M3. 子代理 75%/85% 渐进压缩在单 user 消息 run 中恒不触发 → 只有 95% 折叠生效
- **位置**：`ContextCompressor.ts:126-135, 182` + `SubagentService.ts:231-233`
- **问题**：getRecentBoundary 单 user 时返回 0 → strip 全保护；summarizePairs 单段直接返回。75% 阈值到达后压缩器空转，直到 95% 才 collapse。
- **修复建议**：单段场景下 strip 改为按"最近 N 条 tool 消息"保护而非按轮次

### M4. @引用（selectedKbFileIds）被 kbActive 门控 → KB 开关关闭时预注入静默失效
- **位置**：`BridgeContextBuilder.ts:71, 82` + `AIChatWindow/index.tsx:703-704`
- **问题**：UI 注释声称"显式引用优先于 kbEnabled 开关"，但 `kbActive = kbEnabled || tplKbFileIds.length > 0` 不含 selectedKbFileIds——两者皆空时整个检索块跳过。
- **修复建议**：kbActive 增加 `selectedKbFileIds.length > 0` 分支

### M5. pipeline 通道（续写/仿写/角色生成）不返回 cached_tokens → 缓存命中费用按全价计
- **位置**：`electron/ipc/aiHandlers.ts:145-150, 253-261`
- **问题**：ai:chat / ai:chat-stream 的 usage 无 cached_tokens，calculateCost 的 cacheHitTokens 传 0——pipeline 缓存命中不享受折扣；统计系统显示 cacheHit=0（日志已正确提取，UI 与日志不一致）。
- **修复建议**：pipeline 通道 usage 补 cached_tokens

### M6. 每次保存全量导出所有会话记录（无变更检测）→ 性能问题
- **位置**：`chatStorageService.ts:200-201`（doSave 内 Promise.all 全量导出）
- **问题**：每个会话每次防抖保存都重写 4 个文件，无脏检查。长会话下每 800ms 全量 IO。
- **修复建议**：按会话 id + 消息数/updatedAt 比较，只导出变更会话

### M7. 关窗时 inFlight 中的防抖保存被丢弃
- **位置**：`chatStorageService.ts:237-245`（flushPendingSave 仅当 !inFlight 才执行）
- **问题**：inFlight 进行中关窗 → 挂起的保存被丢弃（v14.9 注释声称"尽力落盘"实际是丢弃窗口）
- **修复建议**：flushPendingSave 在 inFlight 时等待其完成后再冲刷

### M8. abort 广播误杀并行子代理兄弟请求（需确认 fileService.abortStream）
- **位置**：`anthropicService.ts:180-184` + `aiHandlers.ts:187`（ai:abort-stream 无条件 abort 该 wc 全部在途）
- **问题**：abortToolLoop 的 aiService.abortStream() 若不带 requestId → 主 agent 与并行子代理同时在途时全部中止
- **修复建议**：确认 fileService.abortStream 是否传 requestId；不带时建议传当前 run 的 requestId

### M9. OpenAI 端命中率统计虚低（total_tokens 含 cached 又加 cacheHitTokens）
- **位置**：`chatStorageService.ts:168-169`（txt 镜像）+ `chatRecordService.ts:133, 186`
- **问题**：Anthropic 端 prompt_tokens 不含 read → 加 read 后分母正确；OpenAI 端 prompt_tokens 含 cached → 再加 cacheHitTokens 分母虚高、命中率约减半。
- **修复建议**：命中率计算按协议分支（OpenAI 端不再加 cacheHitTokens）

### M10. 跨 run KB 排除窗口有限（最近 3 条带注入的 assistant 并集）
- **位置**：`AIChatWindow/index.tsx:747-752`
- **问题**：连续 4+ 轮注入为空或正常推进后，更早注入过的文件可被重新注入（内容已在历史中却重复入上下文）
- **修复建议**：排除集与 buildHistoryMessages 的 5 工具轮窗口联动

### M11. rebuildFromHistory 的"覆盖跨 run"在生产主路径不生效 → v15.6 核心功能跨 run 失效
- **位置**：`ReadResultTracker.ts:95-141` + `AIChatWindow/utils.ts:178-180, 323-324`
- **问题**：rebuildFromHistory 依赖历史中的 `assistant.tool_calls` 和独立 `role:'tool'` 消息重建 read/write 记录。但生产 UI 路径 buildHistoryMessages 注释明确"会话消息从不持久化 tool_calls"（只存 toolsUsed/toolCallSteps），且 L323-324 把独立 tool 消息直接 skip。runtime 自身注释（L76-78）也承认生产路径"不保留 tool 消息"。
- **触发**：任何真实 UI 对话的第二轮 run——tracker 以空记录开局，**跨 run 去重完全不发生**（同 run 内去重正常）
- **影响**：v15.6 宣称解决的"同一文件多次讨论修改，旧版本信息重复上传"仅在**同 run 内**生效；跨 run 场景继续重读全文（安全侧失败，功能意图未达成）
- **修复建议**：① buildHistoryMessages 从 toolCallSteps 重建 read/write 记录（toolCallSteps 有 arguments）；② 或 ReadResultTracker 增加基于 toolCallSteps 的重建路径

### M12. API 重试 transient 判定正则漏网常见瞬态错误
- **位置**：`V4UnifiedRuntime.ts:588`
- **问题**：`/超时|timeout|network|ECONNREFUSED|ETIMEDOUT|429|503|502/` 缺 `ECONNRESET`、`socket hang up`、`ECONNABORTED`、`ENOTFOUND`、`EPIPE`、`408`、`504`——DeepSeek 网络层最常见瞬态错误。
- **影响**：本可自动重试的调用直接走 interrupted break——批处理/子代理中断概率上升（可续跑不丢数据，但多付一次续跑调用）
- **修复建议**：补充 `ECONNRESET|socket hang up|408|504|5\d\d`

### M13. 无清单路径"部分完成声明"可被当全部完成（单任务多部分场景）
- **位置**：`V4UnifiedRuntime.ts:45, 765`
- **问题**：无清单路径不查 PARTIAL_DONE_RE。模型写"已完成第1部分，下面写第2部分"——`已(?:经)?完成` 命中；CONTINUATION_RE 缺"接着/然后/再做"等词 → `_fileWriteDone=true` 时直接 break，剩余工作丢失。
- **修复建议**：统一入口做否定/继续性排除（见 S5 建议）

### M14. 自愈阶梯"前几轮不干预"分支不回写模型本轮文本（pushRoundText 缺失）
- **位置**：`V4UnifiedRuntime.ts:941-944`
- **问题**：分支：模型说了短文本（无完成声明、无问句、<200 字、已用过工具、要求了文件操作、_nudgeCount<5）→ continue 且**不 push 任何消息**——模型下轮看不到自己刚说的话（重复道歉/重复说同一件事）。
- **修复建议**：该分支补 pushRoundText

### M15. 快速连发两条消息时旧 run 的 store.endRun() 可能晚于新 run 的 startRun() → UI 状态瞬时错乱
- **位置**：`chatBridgeFactory.ts:88-92` + `V4UnifiedRuntime.ts:1215-1216`
- **问题**：sendMessage 重入守卫中止旧 run，但旧 run teardown 异步执行；新 run startRun 在动态 import 之后——若旧 teardown 恰落在新 startRun 之后（概率低），新 run 的 UI 状态被清空后写回（闪烁 IDLE）。仅 UI 状态，数据/API 无影响。
- **修复建议**：endRun 前按 runId 校验是否仍是自己

### M16. OpenAI/Responses 协议中止路径不补记已消耗 tokens（成本低估）
- **位置**：`aiHandlers.ts:566-567`
- **问题**：anthropicHandlers 中止分支会 logTokenUsage 补记输入 tokens；OpenAI 协议 abort 返回 {aborted:true} 不带 usage，runtime break 时不记 totalTokens/audit——用户停止生成后该次请求输入 tokens 从成本统计中消失（低估）。
- **修复建议**：OpenAI 中止路径补记输入 tokens（对齐 anthropicHandlers）

## 轻微问题/可优化点

- **ReadResultTracker 写工具集合与 ToolExecutor 不一致**（`ReadResultTracker.ts:250-255` vs `ToolExecutor.ts:30-35`）：tracker 含 edit_file_task，运行期 WRITE_TOOLS 不含 → 同 run 内经 edit_file_task 修改的文件重读提示 dup 而非 changed。建议两侧对齐。
- **changed 状态不随重读重置**（`ReadResultTracker.ts:242-244`）：写后即使模型已重读新内容，后续 read 仍提示"旧版本已过时"。建议重读新版本后清空该文件 writeRecords。
- **[验收提示] 注入在 [当前任务] 之后**（`V4UnifiedRuntime.ts:717-719`）：断点判定只判末块，[当前任务] 进入缓存前缀 → 下一轮全前缀重编码。建议断点判定改为"自末向前扫第一个易变前缀"。
- **retry 2s backoff 不响应 abort**（`V4UnifiedRuntime.ts:590`）：用户停止生成最多延迟 2s 才退出。可改 Promise.race 带 abort 监听。
- **updateTaskProgressFromText 按 index 单调置位**（`V4UnifiedRuntime.ts:217-228`）：模型声明顺序与实际任务顺序不一致时可能误置位。
- **查询指纹仅前 16 字**（`kbTools.ts:117`）：超长 query 区分度有限。
- **lastSnapshotInjectedIdRef 不随会话切换重置**（`index.tsx:376`）：切换会话后可能跳过快照注入。
- **abort 路径 cache_read 未计入 abortedInputTokens**（`anthropicHandlers.ts:291`）：中止时缓存命中 token 不记成本（低估，量小）。
- **服务端 web_search 注入条件与 DDG 跳过条件模型名校验不一致**（`AnthropicAdapter.ts:244-256` vs `BridgeContextBuilder.ts:124-126`）：非 deepseek 模型挂 deepseek.com 端点会双通道联网（风险极低）。
- **清单模式"向用户提问"break 不置 interrupted**（`V4UnifiedRuntime.ts:739-745`）：下一轮无 resumeTaskProgress 快照时清单门控丢失。
- **进度条精度**：run 进行中不更新；run 后 estimatedContextTokens 不含工具定义 tokens；加载时估算含 displayOnly 消息——三处近似低估，可接受。

## 确认正常的机制（无需改动）

- KB/searchContext 不进缓存前缀（[参考信息] 合并为末条 user，设计成立）
- [续跑]/[子代理快照] 为 user role（不入 system 前缀）；[任务边界] 已覆盖
- KB_INJECT_SCORE_THRESHOLD=0.3 单一真源；kb_search 工具不受阈值/勾选限制
- 孤儿 tool 清理完整（run 起始/abort/超时均执行）
- 连续同角色合并覆盖全部边界（tool 链+文本 user、纯文本 user+user）
- 压缩各阶段无越界删除（strip/summarize/collapse 边界对齐全称）
- buildHistoryMessages 过滤完整（welcome/displayOnly/compressedSummary）
- ReadResultTracker 安全侧失败（指纹失效→完整回传；dup≥3→强制完整回传）
- estimateTokens 校准有实测依据（CJK 1.2/Latin 4.5），方向高估安全
- 子代理上下文隔离（isolatedStore）、人设隔离（ROLE_PROMPTS 无角色模板）、工具能力与提示词一致
- verify JSON 兜底解析（配对括号 + 关键词降级双保险）
- SSE 解析 index 匹配正确；CRLF 归一化、尾部冲刷、abort 竞态兜底完善
- per-request abort 链路完整（requestId 精确中止、handler 清理无泄漏）
- chatRecordService 幂等导出、目录名唯一性
- 完成判定证据链完整（FILE_WRITE_TOOLS 不含网络/生图；写成功才置位；"说完成但没写"闸门强制生效）
- 180s 超时 → abortStream → per-request AbortController → SDK 流真正取消（双请求双计费已消除）
- taskExtraction 四重门控宁漏勿错；injectTaskStatus 替换式无残留
- computeRunTimeoutMs/API_TIMEOUT 与 IPC 双层一致

## 情况说明（复制以下内容到新会话继续优化）

> 上一会话完成了对 AI 写作助手 agent 的**四路并行只读全面审计**（Runtime 主循环 / 工具层与安全 / 上下文与缓存 / 子代理与协议），审计报告已写入 `d:\3\novel-writing-app\.aiharness\design\agent-audit-2026-08-09.md`（含严重问题 S1-S6、中等问题 M1-M16、轻微项、确认正常的机制清单）。
>
> **请继续完成以下优化工作**：
>
> 1. **优先修复严重问题**：
>    - S1：abortToolLoop 不释放 sendLockRef → 停止生成后发送按钮永久锁死（`AIChatWindow/index.tsx:487-495` 补 `sendLockRef.current = false`）
>    - S2：handleSend 历史闭包陈旧 → 最新 user 消息不在历史输入 → Anthropic 400 风险（sendMessage 前把当前 user 并入历史，对齐测试脚本 runScenario 的修复）
>    - S3：kb_index_file embedding 逐块失败仍报"索引完成" → 空向量永远搜不到（kbHandlers/index.ts indexFile 失败 chunk 不入 index 或返回 failedCount）
>    - S4：非子代理写工具超时后孤儿执行仍落盘（ToolExecutor 超时后引导模型先 read_file 确认现状）
>    - S5：GLOBAL_DONE_RE `都.*完成` 无否定排除 → "还没都完成"/"这2项都完成了"绕过清单门控（加否定前瞻 + PARTIAL 补 `[这那剩]?前?N项` 形态）
>    - S6："说完成但没写"两条 nudge 分支不递增 _nudgeCount → 自愈出口永久失效（两处加 `_nudgeCount++`）
> 2. **复核后修复**：
>    - M1：任务型 run 缓存命中实测（跑 CA1 类带任务清单的真实场景看缓存统计——[当前任务] 是否致整段缓存失效）；若确认则改为 user role 注入
>    - M8：确认 fileService.abortStream 是否传 requestId（不带则补）
> 3. **修复中等问题 M2-M7、M9-M16**（详见文件）
> 4. **修复轻微项**（按性价比取舍）
> 5. 每项修复后验证：`npx tsc --noEmit` + `npx vitest run` + `bash scripts/check-consistency.sh`（基线：tsc 0 · 749 passed + 15 skipped · 31/31）
> 6. 涉及产品行为的修复（S4/M1/M2/M4）跑一次真实 API 场景验证（`npx tsx scripts/test-ai-agent.mjs --scenario=CA11`，需 .env 的 AI_API_KEY）

## 参考

- 审计范围：Runtime（V4UnifiedRuntime/chatBridgeFactory）· 工具层（ToolExecutor/fileTools/kbTools/subagentTools/fileToolHandlers/kbHandlers）· 上下文缓存（BridgeContextBuilder/ContextCompressor/AnthropicAdapter/ReadResultTracker/buildHistoryMessages）· 子代理协议（SubagentService/SubagentPrompt/anthropicHandlers/aiHandlers/AIChatWindow/chatStorageService/chatRecordService）
- 验证基线：tsc 0 · 749 passed + 15 skipped · check-consistency 31/31 · CA11 综合场景实测通过（420s/750s 预算，缓存 76%/末轮 96%）
