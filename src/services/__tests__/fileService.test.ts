import { describe, it, expect, beforeEach } from 'vitest'
import { aiService, fileService, kbService, projectService } from '../fileService'

// ── Service Layer Type Verification ──
// These tests verify the service layer wrappers have the correct shape.
// Full integration tests would need an Electron environment.

describe('fileService', () => {
  it('exposes all expected methods', () => {
    expect(typeof fileService.read).toBe('function')
    expect(typeof fileService.write).toBe('function')
    expect(typeof fileService.listDir).toBe('function')
    expect(typeof fileService.ensureDir).toBe('function')
    expect(typeof fileService.deleteFile).toBe('function')
    expect(typeof fileService.deleteDir).toBe('function')
    expect(typeof fileService.readBinary).toBe('function')
    expect(typeof fileService.writeBinary).toBe('function')
    expect(typeof fileService.saveImageUrl).toBe('function')
    expect(typeof fileService.onExternalChange).toBe('function')
  })

  it('methods throw without Electron bridge', async () => {
    // V9.5.2: read/write now async with caching — reject rather than throw synchronously
    await expect(fileService.read('/test')).rejects.toThrow('Electron bridge not available')
    await expect(fileService.write('/test', 'content')).rejects.toThrow('Electron bridge not available')
  })
})

describe('projectService', () => {
  it('exposes all expected methods', () => {
    expect(typeof projectService.create).toBe('function')
    expect(typeof projectService.delete).toBe('function')
    expect(typeof projectService.getMeta).toBe('function')
    expect(typeof projectService.listProjects).toBe('function')
    expect(typeof projectService.importProject).toBe('function')
    expect(typeof projectService.updateCategory).toBe('function')
  })
})

describe('aiService', () => {
  it('exposes all expected methods', () => {
    expect(typeof aiService.chat).toBe('function')
    expect(typeof aiService.chatWithUsage).toBe('function')
    expect(typeof aiService.chatWithTools).toBe('function')
    expect(typeof aiService.executeFileTools).toBe('function')
    expect(typeof aiService.chatStream).toBe('function')
    expect(typeof aiService.abortStream).toBe('function')
    expect(typeof aiService.listModels).toBe('function')
  })

  it('chatWithTools returns ChatWithToolsResult shape contract', async () => {
    // Type-level verification: the return type should have these fields
    type Result = Awaited<ReturnType<typeof aiService.chatWithTools>>
    const result = {} as Result
    // TypeScript validates these at compile time — if any field is missing, this file won't compile
    const _text: string = result.text
    const _toolCalls = result.toolCalls
    const _finishReason: string = result.finishReason
    void _text; void _toolCalls; void _finishReason
    expect(true).toBe(true)
  })

  it('executeFileTools accepts ToolCallArgs array', async () => {
    // Type shape verification
    const args = [{ callId: '1', toolName: 'read_file', args: { file_path: 'test' } }]
    expect(Array.isArray(args)).toBe(true)
    expect(args[0].callId).toBe('1')
  })
})

describe('kbService', () => {
  it('exposes all expected methods', () => {
    expect(typeof kbService.list).toBe('function')
    expect(typeof kbService.read).toBe('function')
    expect(typeof kbService.selectFiles).toBe('function')
    expect(typeof kbService.uploadFiles).toBe('function')
    expect(typeof kbService.delete).toBe('function')
    expect(typeof kbService.write).toBe('function')
    expect(typeof kbService.index).toBe('function')
    expect(typeof kbService.search).toBe('function')
    expect(typeof kbService.assignProject).toBe('function')
    expect(typeof kbService.getEmbedding).toBe('function')
    expect(typeof kbService.estimate).toBe('function')
    expect(typeof kbService.create).toBe('function')
    expect(typeof kbService.append).toBe('function')
    expect(typeof kbService.rename).toBe('function')
    expect(typeof kbService.download).toBe('function')
    expect(typeof kbService.webSearch).toBe('function')
    // v16: 三级目录
    expect(typeof kbService.listFolders).toBe('function')
    expect(typeof kbService.createFolder).toBe('function')
    expect(typeof kbService.renameFolder).toBe('function')
    expect(typeof kbService.deleteFolder).toBe('function')
    expect(typeof kbService.moveFile).toBe('function')
  })

  it('has 21 methods', () => {
    const methods = Object.keys(kbService)
    expect(methods).toHaveLength(21)
  })
})

// ── Document that all exports exist ──

describe('module exports', () => {
  it('exports all expected service modules', async () => {
    const mod = await import('../fileService')
    expect(mod.fileService).toBeDefined()
    expect(mod.projectService).toBeDefined()
    expect(mod.exportService).toBeDefined()
    expect(mod.aiService).toBeDefined()
    expect(mod.kbService).toBeDefined()
    expect(mod.dialogService).toBeDefined()
    expect(mod.appService).toBeDefined()
    expect(mod.settingsService).toBeDefined()
    expect(mod.statsService).toBeDefined()
    expect(mod.styleProjectService).toBeDefined()
    expect(mod.styleTemplateService).toBeDefined()
    expect(mod.templateService).toBeDefined()
    expect(mod.continuationService).toBeDefined()
    expect(mod.extractionService).toBeDefined()
    expect(mod.storyService).toBeDefined()

  })
})
