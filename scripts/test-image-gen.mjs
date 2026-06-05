// ── 图片生成全链路测试 ──
// 用法: OPENAI_KEY=sk-xxx node scripts/test-image-gen.mjs
//       OPENAI_KEY=sk-xxx BASE_URL=https://api.openai.com/v1 MODEL=dall-e-3 node scripts/test-image-gen.mjs
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = join(__dirname, '..')

const API_KEY = process.env.OPENAI_KEY || ''
const BASE_URL = process.env.BASE_URL || 'https://api.openai.com/v1'
const MODEL = process.env.MODEL || 'dall-e-3'
const PROMPT = process.env.PROMPT || 'a serene mountain landscape at sunrise, traditional Chinese ink wash painting style'

if (!API_KEY) {
  console.warn('⚠️  未设置 OPENAI_KEY，仅测试文件保存路径')
  console.warn('   API 测试: $env:OPENAI_KEY="sk-xxx" node scripts/test-image-gen.mjs')
  console.warn('   第三方:   $env:OPENAI_KEY="xxx" $env:BASE_URL="https://..." $env:MODEL="xialong-v1" node scripts/test-image-gen.mjs\n')
}

const IMAGES_DIR = join(appRoot, 'images')
const timestamp = Date.now().toString(36)
const fileName = `gen_test_${timestamp}.png`
const imagePath = join(IMAGES_DIR, fileName)

async function testUrlResponse() {
  console.log(`\n📡 测试1: url 格式响应`)
  console.log(`   API: ${BASE_URL}`)
  console.log(`   模型: ${MODEL}`)
  console.log(`   Prompt: ${PROMPT.slice(0, 60)}...`)

  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT, n: 1, size: '1024x1024', response_format: 'url' }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error(`   ❌ HTTP ${res.status}: ${err.slice(0, 200)}`)
    return null
  }

  const data = await res.json()
  const url = data?.data?.[0]?.url
  if (!url) {
    console.error('   ❌ 响应无 data[0].url:', JSON.stringify(data).slice(0, 200))
    return null
  }
  console.log(`   ✅ 获取到 URL: ${url.slice(0, 80)}...`)
  return url
}

async function testB64Response() {
  console.log(`\n📡 测试2: b64_json 格式响应`)
  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT, n: 1, size: '1024x1024', response_format: 'b64_json' }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error(`   ❌ HTTP ${res.status}: ${err.slice(0, 200)}`)
    return null
  }

  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) {
    console.error('   ❌ 响应无 data[0].b64_json')
    return null
  }
  console.log(`   ✅ 获取到 b64_json (${(b64.length / 1024).toFixed(1)} KB)`)
  return b64
}

async function testSaveAndPath() {
  console.log(`\n💾 测试3: 文件保存路径`)
  await mkdir(IMAGES_DIR, { recursive: true })
  const testData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await writeFile(imagePath, testData)
  console.log(`   ✅ 已写入: ${imagePath}`)
  console.log(`   relativePath: images/${fileName}`)
  return `images/${fileName}`
}

async function testThirdPartyAPI() {
  if (!process.env.THIRD_PARTY_URL || !process.env.THIRD_PARTY_KEY) return
  console.log(`\n📡 测试4: 第三方 API (${process.env.THIRD_PARTY_URL})`)
  const res = await fetch(`${process.env.THIRD_PARTY_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.THIRD_PARTY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.THIRD_PARTY_MODEL || MODEL, prompt: PROMPT, n: 1, size: '1024x1024', response_format: 'url' }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error(`   ❌ HTTP ${res.status}: ${err.slice(0, 200)}`)
    return
  }
  const data = await res.json()
  console.log(`   ✅ 响应: ${JSON.stringify(data).slice(0, 200)}`)
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  图片生成全链路测试')
  console.log('═══════════════════════════════════════')
  console.log(`  API: ${API_KEY ? BASE_URL : '(未设置 — 仅测试文件保存)'}`)
  console.log(`  图片目录: ${IMAGES_DIR}`)

  if (!API_KEY) {
    console.log('\n⚠️  未设置 OPENAI_KEY，跳过 API 调用测试')
    console.log('   用法: $env:OPENAI_KEY="sk-xxx" node scripts/test-image-gen.mjs')
    console.log('   第三方: $env:OPENAI_KEY="xxx" $env:BASE_URL="https://text.novelai.net/oa/v1" $env:MODEL="xialong-v1" node scripts/test-image-gen.mjs')
  } else {
    const url = await testUrlResponse()
    if (url) {
      console.log(`\n📥 下载图片...`)
      const imgRes = await fetch(url)
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer())
        await mkdir(IMAGES_DIR, { recursive: true })
        await writeFile(imagePath, buf)
        console.log(`   ✅ 已保存: ${imagePath} (${(buf.length / 1024).toFixed(1)} KB)`)
      } else {
        console.error(`   ❌ 下载失败: HTTP ${imgRes.status}`)
      }
    }
    await testB64Response()
  }

  // 文件保存测试不需要 API
  await testSaveAndPath()
  await testThirdPartyAPI()

  console.log('\n═══════════════════════════════════════')
  console.log('  测试完成')
  console.log('═══════════════════════════════════════')
}

main().catch(e => { console.error('测试失败:', e.message); process.exit(1) })
