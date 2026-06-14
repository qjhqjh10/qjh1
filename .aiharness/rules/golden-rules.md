# Golden Rules（金规则）

不可绕过的硬约束。每次工具调用前，Agent 必须自检是否符合以下规则。

## 1. 共享优先

**规则**: 重复代码抽取到 `utils/` 或 `services/`，不手写 helper。
**检查**: 新增代码超过 20 行且逻辑通用 → 提取到 `src/utils/` 对应文件。

## 2. 边界校验

**规则**: 文件读写入口校验数据格式。
**检查**: 创建/修改 JSON 文件必须通过 `schemaValidation.ts` 校验。Markdown 文件不越级使用标题。

## 3. 聚焦子集

**规则**: 一个文件一个职责，不超过 500 行。
**检查**: 新文件超过 500 行 → 拆分为 index.tsx + components/ 或 hooks/ 子目录。

## 4. 修改前先读（按操作类型区分）

**规则**: 
- `create_file` 新建文件 → 不需要先 read_file（文件还不存在）。可选 list_directory 确认目录结构
- `edit_file` 全量覆盖（__FULL_REPLACE__）→ list_directory 确认文件存在即可，不需要 read_file 读全文
- `edit_file` 局部替换 → 必须 read_file 获取原文做 old_string
- `delete_file` → 确认文件存在即可
- **已读取过的文件/目录在对话历史中 → 不需要重复读取**
**检查**: 同一目标文件/目录最多读取 1 次。重复 list_directory 同一目录视为违规。

## 5. 失败即记录

**规则**: 工具执行失败后，使用 learn_rule 记录错误模式。
**检查**: 同一工具连续 3 次失败 → 自动 learn_rule。
