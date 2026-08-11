// ── 分发 zip 打包（v15.1）──
// 用项目依赖 archiver v8（ESM）压缩 release/win-unpacked → release/win-unpacked-<version>.zip
// 与 package-dist.sh 配合：压缩前必须已清理 userdata/（防数据泄漏 + 防对方机器配置冲突）
// 用法:
//   node scripts/zip-dist.mjs <版本号>           打包（版本号缺省读 package.json）
//   node scripts/zip-dist.mjs --check <版本号>   复检已产出的 zip 不含 userdata（v16.3.1 审计 F13:
//      原 package-dist.sh 依赖系统 unzip 做复检，缺失时静默跳过——现改用项目自带 unzipper 读 zip 目录）

import { createWriteStream, existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { ZipArchive } from 'archiver'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

// v15.1.0 修复: 路径基于脚本位置（scripts/ 的上两级 = 项目根），不受调用方 cwd 影响
// （package-dist.sh 在 release/ 下调用时，相对 cwd 的 release/win-unpacked 会错位成 release/release/…）
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const version = process.argv[2] || pkg.version
const srcDir = resolve(projectRoot, 'release', 'win-unpacked')
const outFile = resolve(projectRoot, 'release', `win-unpacked-${version}.zip`)

// ── --check 复检模式（不打包，只验证）──
if (process.argv[2] === '--check') {
  const targetVersion = process.argv[3] || pkg.version
  const zipPath = resolve(projectRoot, 'release', `win-unpacked-${targetVersion}.zip`)
  if (!existsSync(zipPath)) {
    console.error(`🔴 找不到 ${zipPath} —— 复检对象不存在`)
    process.exit(1)
  }
  const { Open } = await import('unzipper')
  const central = await Open.file(zipPath)
  const entries = central.files.map(f => f.path)
  const leaked = entries.filter(p => /(^|\/)userdata(\/|$)/.test(p))
  if (leaked.length > 0) {
    console.error(`🔴 复检失败: zip 内发现 ${leaked.length} 项 userdata（个人数据泄漏风险）:`)
    for (const p of leaked.slice(0, 10)) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`✅ 复检通过: zip 内 ${entries.length} 项，无 userdata`)
  process.exit(0)
}

if (!existsSync(srcDir)) {
  console.error(`🔴 找不到 ${srcDir} —— 请先运行 electron-builder --dir`)
  process.exit(1)
}

// 防泄漏硬闸门：userdata 目录（含对话记录/配置/项目数据）绝不允许进 zip
if (existsSync(resolve(srcDir, 'userdata'))) {
  console.error('🔴 检测到 release/win-unpacked/userdata 仍存在（含对话记录/配置等个人数据）')
  console.error('  请先运行 package-dist.sh 或手动删除该目录后再打包。')
  process.exit(1)
}

const output = createWriteStream(outFile)
const archive = new ZipArchive({ zlib: { level: 9 } })
archive.pipe(output)
archive.directory(srcDir, 'win-unpacked')
await archive.finalize()

console.log(`✓ 已生成: ${outFile}`)
