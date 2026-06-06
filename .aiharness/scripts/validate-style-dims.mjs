#!/usr/bin/env node
/**
 * 验证风格模板 — 检查 11 个必填维度全部存在 + key 为英文
 * 用法: node validate-style-dims.mjs <appRoot>
 * 输出: JSON { status: "pass"|"fail", checks: [...], failedCount: N }
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const appRoot = resolve(process.argv[2] || process.cwd())
const styleDir = join(appRoot, 'style_templates')

const REQUIRED_DIMS = [
  'narrativeTone', 'sentenceStyle', 'vocabularyStyle', 'rhetoricStyle',
  'rhythmStyle', 'dialogueStyle', 'moodStyle', 'perspectiveStyle',
  'bodyLanguageStyle', 'sensoryStyle', 'descriptionPattern',
]

const checks = []

try {
  if (!existsSync(styleDir)) {
    checks.push({ file: 'style_templates/', check: 'directory_exists', passed: false, reason: '目录不存在' })
  } else {
    const files = readdirSync(styleDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
    if (files.length === 0) {
      checks.push({ file: 'style_templates/', check: 'has_files', passed: false, reason: '无模板文件' })
    }

    for (const f of files) {
      const fp = join(styleDir, f)
      const check = { file: `style_templates/${f}`, passed: true, missingDims: [], emptyDims: [], englishKeyErrors: [] }

      try {
        const raw = readFileSync(fp, 'utf-8')
        const data = JSON.parse(raw)
        const dims = data.dimensions || {}

        if (Object.keys(dims).length === 0) {
          check.passed = false
          check.missingDims = REQUIRED_DIMS
        } else {
          for (const d of REQUIRED_DIMS) {
            if (!(d in dims)) {
              check.missingDims.push(d)
            } else if (!dims[d] || (typeof dims[d] === 'object' && Object.keys(dims[d]).length === 0)) {
              check.emptyDims.push(d)
            }
          }
        }

        // Check english keys
        for (const key of Object.keys(dims)) {
          if (/[一-鿿]/.test(key)) {
            check.englishKeyErrors.push(key)
          }
        }

        check.passed = check.missingDims.length === 0 && check.emptyDims.length === 0 && check.englishKeyErrors.length === 0

      } catch (e) {
        check.missingDims = REQUIRED_DIMS
        check.passed = false
        check.parseError = e.message
      }

      checks.push(check)
    }
  }
} catch (e) {
  checks.push({ file: 'style_templates/', check: 'directory_accessible', passed: false, reason: e.message })
}

const failedCount = checks.filter(c => !c.passed).length
console.log(JSON.stringify({ status: failedCount === 0 ? 'pass' : 'fail', checks, failedCount }))
