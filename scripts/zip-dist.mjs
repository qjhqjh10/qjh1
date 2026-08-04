// ── 分发 zip 打包（v15.1）──
// 用项目依赖 archiver v8（ESM）压缩 release/win-unpacked → release/win-unpacked-<version>.zip
// 与 package-dist.sh 配合：压缩前必须已清理 userdata/（防数据泄漏 + 防对方机器配置冲突）
// 用法: node scripts/zip-dist.mjs <版本号>  （版本号缺省读 package.json）

import { createWriteStream, existsSync } from 'fs'
import { resolve } from 'path'
import { createRequire } from 'module'
import { ZipArchive } from 'archiver'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const version = process.argv[2] || pkg.version
const srcDir = resolve('release/win-unpacked')
const outFile = resolve(`release/win-unpacked-${version}.zip`)

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
