# Agent Scripts

预置脚本目录。Agent 可通过 `shell_run_script` 工具执行此目录下的脚本（已审计，无需额外确认）。

## 现有脚本

| 脚本 | 用途 |
|------|------|
| `validate-json.mjs` | PostToolUse hook: 校验新创建的 JSON 文件格式 |

## 添加新脚本

1. 创建 `.mjs` 文件（Node.js ESM 格式）
2. 确保脚本不修改 `../` 之外的文件
3. 脚本超时 30 秒，输出限制 50KB
