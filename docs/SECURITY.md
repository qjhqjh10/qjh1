# 安全模型

## API 密钥管理

- 密钥通过 Electron `safeStorage` 加密存储在 `electron-store` 中
- 渲染进程无法直接读取密钥（`Masked_Key` 占位符）
- **CLI**：密钥通过环境变量 `AI_API_KEY` 传递（**不要**使用已弃用的 `--key` 标志）
- **Agent 子进程**：密钥通过 `env.AI_API_KEY` 注入（非命令行参数）

## 内容安全策略 (CSP)

双层防护：
1. `index.html` 中的 `<meta>` 标签
2. `main.ts` 中的 `webRequest.onHeadersReceived` HTTP 头注入

```yaml
default-src: 'self'
script-src: 'self'
style-src: 'self' 'unsafe-inline'  # TipTap + Tailwind 需要
img-src: 'self' data: https:         # Unsplash 图片 + base64
connect-src: 'self' https://api.deepseek.com https://api.openai.com https://*.openai.com
font-src: 'self' data:
object-src: 'none'
```

## SSRF 防护

双层防御机制（`electron/ipc/ssrfGuard.ts`）：

| 层级 | 机制 | 防护对象 |
|------|------|---------|
| Layer 1 | URL 正则匹配 | IP 字符串（127.x, 192.168.x, 10.x, 172.16-31.x）|
| Layer 2 | DNS 解析 + IP 检查 | DNS rebinding 攻击 |

同时应用于：
- `httpHandlers.ts`（HTTP 工具）
- `browserHandlers.ts`（浏览器工具）

可通过 `.aiharness/aiharness.json` 中 `http.allowPrivateIPs` 控制（默认 `false`）。

## 进程安全

| 设置 | 值 | 位置 |
|------|-----|------|
| `contextIsolation` | `true` | `main.ts` |
| `nodeIntegration` | `false` | `main.ts` |
| `sandbox` | `true` | `main.ts`（preload 仅用 contextBridge+ipcRenderer）|

附加防护：
- `will-navigate` handler：阻止导航到外部 URL
- `setPermissionRequestHandler`：拒绝所有渲染进程权限请求
- `setWindowOpenHandler`：仅允许 HTTP/HTTPS URL

## Shell 命令执行

- 命令白名单：`node`, `python`, `python3`, `git`, `npm`, `npx`
- `shell: false`（防止 cmd.exe 元字符注入）
- 危险模式拦截：`;`, `|`, `&&`, `$()`, 反引号, `sudo`, `/etc/`, `/proc/`

## 文件操作

- `isSafePath()` 路径验证：normalize + 前缀检查
- 多层 `../` 剥离 + 百分号编码遍历防御
- 符号链接解析后重检
- 编辑/删除前自动创建 `.ai_backups`

## 依赖安全

- 当前 Electron 29 已终止生命周期，含 3 个已知 CVE
- 计划升级至 Electron 42+（见 `Electron 升级评估报告`）
- CI 管道包含 `tsc --noEmit` + `vitest run --coverage`
