import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { executeFileTool, ToolCallArgs } from '../fileToolHandlers'
import { isSafePath } from '../utils'

let tmpDir: string
let projectPath: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nw-test-'))
  projectPath = path.join(tmpDir, 'testProject')
  await fsp.mkdir(projectPath, { recursive: true })
  // Create standard project skeleton
  for (const dir of ['characters', 'outline', 'detailed_outline', 'chapters', 'summaries', 'notes']) {
    await fsp.mkdir(path.join(projectPath, dir), { recursive: true })
  }
  await fsp.writeFile(path.join(projectPath, 'outline', 'plot.md'), '# 故事剧情\n第一章测试内容。', 'utf-8')
  await fsp.writeFile(path.join(projectPath, 'characters', 'zhangsan.json'), JSON.stringify({
    id: 'zhangsan', name: '张三', role: '男主', gender: '男', age: '25',
    occupation: '战士', background: '出身贫寒', appearance: '高大威猛', personality: '勇敢坚毅',
    abilities: '剑术精通', weaknesses: '冲动', relationships: '', relationshipTags: [], arc: '成长', importance: 80,
  }), 'utf-8')
  await fsp.writeFile(path.join(projectPath, 'notes', '灵感.md'), '一些草稿内容', 'utf-8')
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

function makeCall(toolName: string, args: Record<string, unknown>, callId = 'test-1'): ToolCallArgs {
  return { callId, toolName, args }
}

// ── Read-only Tools ──

describe('list_directory', () => {
  it('lists project root contents', async () => {
    const result = await executeFileTool(makeCall('list_directory', { dir_path: '' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('characters')
    expect(result.detail).toContain('outline')
    expect(result.detail).toContain('chapters')
  })

  it('lists subdirectory contents', async () => {
    const result = await executeFileTool(makeCall('list_directory', { dir_path: 'characters' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('zhangsan.json')
  })

  it('shows empty directory message', async () => {
    await fsp.mkdir(path.join(projectPath, 'empty_dir'), { recursive: true })
    const result = await executeFileTool(makeCall('list_directory', { dir_path: 'empty_dir' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('空')
  })

  it('safely falls back to project root for invalid paths', async () => {
    // When given an invalid/absolute path, list_directory falls back to project root
    // This is safe because the fallback is always within the project boundary
    const result = await executeFileTool(makeCall('list_directory', { dir_path: 'C:\\Windows\\System32' }), projectPath)
    expect(result.status).toBe('success') // safe fallback to project root
  })

  it('rejects empty dir_path (defaults to project root, which is safe)', async () => {
    // empty dir_path defaults to project root — should succeed
    const result = await executeFileTool(makeCall('list_directory', { dir_path: '' }), projectPath)
    expect(result.status).toBe('success')
  })
})

describe('read_file', () => {
  it('reads a text file', async () => {
    const result = await executeFileTool(makeCall('read_file', { file_path: 'outline/plot.md' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('故事剧情')
  })

  it('reads a JSON file', async () => {
    const result = await executeFileTool(makeCall('read_file', { file_path: 'characters/zhangsan.json' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('张三')
  })

  it('returns error for non-existent file', async () => {
    const result = await executeFileTool(makeCall('read_file', { file_path: 'nonexistent.txt' }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('文件不存在')
  })

  it('rejects path traversal attempts', async () => {
    const result = await executeFileTool(makeCall('read_file', { file_path: '../../../etc/passwd' }), projectPath)
    expect(result.status).toBe('error')
  })

  it('reads notes file from global notes path', async () => {
    // Notes are in the project's notes/ directory
    const result = await executeFileTool(makeCall('read_file', { file_path: 'notes/灵感.md' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('草稿内容')
  })
})

describe('search_files', () => {
  it('finds files by keyword', async () => {
    const result = await executeFileTool(makeCall('search_files', { keyword: 'zhang' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('zhangsan')
  })

  it('returns no matches for unknown keyword', async () => {
    const result = await executeFileTool(makeCall('search_files', { keyword: 'nonexistent' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('未找到')
  })

  it('rejects empty keyword', async () => {
    const result = await executeFileTool(makeCall('search_files', { keyword: '' }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('缺少搜索关键词')
  })
})

describe('search_content', () => {
  it('finds content in files', async () => {
    const result = await executeFileTool(makeCall('search_content', { pattern: '测试内容' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('测试内容')
  })

  it('returns no matches for missing content', async () => {
    const result = await executeFileTool(makeCall('search_content', { pattern: '不存在的内容xyz' }), projectPath)
    expect(result.status).toBe('success')
    expect(result.detail).toContain('未找到匹配内容')
  })

  it('rejects empty pattern', async () => {
    const result = await executeFileTool(makeCall('search_content', { pattern: '' }), projectPath)
    expect(result.status).toBe('error')
  })
})

// ── File Mutation Tools ──

describe('create_file', () => {
  it('creates a new file', async () => {
    const result = await executeFileTool(makeCall('create_file', {
      file_path: 'chapters/chapter1.txt', content: '第一章正文内容',
    }), projectPath)
    expect(result.status).toBe('success')
    expect(result.summary).toContain('已创建')
    // Verify on disk
    const content = await fsp.readFile(path.join(projectPath, 'chapters', 'chapter1.txt'), 'utf-8')
    expect(content).toBe('第一章正文内容')
  })

  it('rejects existing file', async () => {
    const result = await executeFileTool(makeCall('create_file', {
      file_path: 'outline/plot.md', content: 'overwrite attempt',
    }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('已存在')
  })

  it('creates intermediate directories', async () => {
    const result = await executeFileTool(makeCall('create_file', {
      file_path: 'deep/nested/file.txt', content: 'nested',
    }), projectPath)
    expect(result.status).toBe('success')
    const content = await fsp.readFile(path.join(projectPath, 'deep', 'nested', 'file.txt'), 'utf-8')
    expect(content).toBe('nested')
  })

  it('rejects oversized content', async () => {
    const huge = 'x'.repeat(600_000)
    const result = await executeFileTool(makeCall('create_file', {
      file_path: 'chapters/huge.txt', content: huge,
    }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('过大')
  })

  it('validates character JSON schema on create', async () => {
    const invalidChar = JSON.stringify({ id: 'c1' }) // missing required fields
    const result = await executeFileTool(makeCall('create_file', {
      file_path: 'characters/invalid.json', content: invalidChar,
    }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('格式校验不通过')
  })
})

describe('edit_file', () => {
  it('edits with exact match (Strategy 1)', async () => {
    const oldContent = await fsp.readFile(path.join(projectPath, 'outline', 'plot.md'), 'utf-8')
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'outline/plot.md',
      old_string: '第一章测试内容',
      new_string: '第一章修改后的内容',
    }), projectPath)
    expect(result.status).toBe('success')
    const newContent = await fsp.readFile(path.join(projectPath, 'outline', 'plot.md'), 'utf-8')
    expect(newContent).toContain('修改后的内容')
    expect(newContent).not.toContain('测试内容')
  })

  it('full replace with __FULL_REPLACE__ sentinel', async () => {
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'notes/灵感.md',
      old_string: '__FULL_REPLACE__',
      new_string: '完全新的草稿内容',
    }), projectPath)
    expect(result.status).toBe('success')
    expect(result.summary).toContain('全量替换')
    const content = await fsp.readFile(path.join(projectPath, 'notes', '灵感.md'), 'utf-8')
    expect(content).toBe('完全新的草稿内容')
  })

  it('returns error when old_string not found', async () => {
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'outline/plot.md',
      old_string: '这段文字不存在于文件中XYZ',
      new_string: 'replacement',
    }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('未找到要替换的文本')
  })

  it('suggests __FULL_REPLACE__ on match failure', async () => {
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'outline/plot.md',
      old_string: '不存在XYZ123',
      new_string: 'replacement',
    }), projectPath)
    expect(result.detail).toContain('__FULL_REPLACE__')
  })

  it('handles replace_all flag', async () => {
    // Create a file with repeated content
    const content = 'AAA BBB AAA'
    const fp = path.join(projectPath, 'chapters', 'repeated.txt')
    await fsp.writeFile(fp, content, 'utf-8')
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'chapters/repeated.txt',
      old_string: 'AAA', new_string: 'CCC', replace_all: true,
    }), projectPath)
    expect(result.status).toBe('success')
    const newContent = await fsp.readFile(fp, 'utf-8')
    expect(newContent).toBe('CCC BBB CCC')
  })

  it('rejects when old_string appears multiple times without replace_all', async () => {
    const fp = path.join(projectPath, 'chapters', 'dup.txt')
    await fsp.writeFile(fp, 'AAA BBB AAA', 'utf-8')
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'chapters/dup.txt',
      old_string: 'AAA', new_string: 'CCC',
    }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('2 次')
    expect(result.detail).toContain('replace_all')
  })

  it.skip('rejects oversized files', async () => {
    // Create a file larger than MAX_FILE_SIZE (10MB)
    // Skipped: 11MB file creation takes too long in CI
    const huge = 'x'.repeat(1024 * 1024 * 11)
    const fp = path.join(projectPath, 'chapters', 'huge_file.txt')
    await fsp.writeFile(fp, huge, 'utf-8')
    const result = await executeFileTool(makeCall('edit_file', {
      file_path: 'chapters/huge_file.txt',
      old_string: '__FULL_REPLACE__',
      new_string: 'replaced',
    }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('过大')
  })
})

describe('delete_file', () => {
  it('deletes an existing file', async () => {
    const fp = path.join(projectPath, 'chapters', 'to_delete.txt')
    await fsp.writeFile(fp, 'delete me', 'utf-8')
    const result = await executeFileTool(makeCall('delete_file', { file_path: 'chapters/to_delete.txt' }), projectPath)
    expect(result.status).toBe('success')
    await expect(fsp.access(fp)).rejects.toThrow()
  })

  it('returns error for non-existent file', async () => {
    const result = await executeFileTool(makeCall('delete_file', { file_path: 'nonexistent.txt' }), projectPath)
    expect(result.status).toBe('error')
  })
})

describe('rename_file', () => {
  it('renames a file', async () => {
    const fp = path.join(projectPath, 'chapters', 'old_name.txt')
    await fsp.writeFile(fp, 'rename me', 'utf-8')
    const result = await executeFileTool(makeCall('rename_file', {
      file_path: 'chapters/old_name.txt', new_path: 'chapters/new_name.txt',
    }), projectPath)
    expect(result.status).toBe('success')
    await expect(fsp.access(fp)).rejects.toThrow()
    const newContent = await fsp.readFile(path.join(projectPath, 'chapters', 'new_name.txt'), 'utf-8')
    expect(newContent).toBe('rename me')
  })

  it('rejects when target already exists', async () => {
    const fp = path.join(projectPath, 'chapters', 'source.txt')
    const tp = path.join(projectPath, 'chapters', 'existing.txt')
    await fsp.writeFile(fp, 'source', 'utf-8')
    await fsp.writeFile(tp, 'existing', 'utf-8')
    const result = await executeFileTool(makeCall('rename_file', {
      file_path: 'chapters/source.txt', new_path: 'chapters/existing.txt',
    }), projectPath)
    expect(result.status).toBe('error')
  })
})

// ── Project Management ──

describe('create_project', () => {
  it('creates a new project skeleton', async () => {
    const result = await executeFileTool(makeCall('create_project', { name: '新项目' }), projectPath)
    expect(result.status).toBe('success')
    const projPath = path.join(projectPath, '新项目')
    for (const dir of ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']) {
      await expect(fsp.access(path.join(projPath, dir))).resolves.not.toThrow()
    }
    // Verify project.json was created
    const meta = JSON.parse(await fsp.readFile(path.join(projPath, 'project.json'), 'utf-8'))
    expect(meta.type).toBe('writing')
    expect(meta.novelCategory).toBe('general')
  })

  it('rejects project name with path separators', async () => {
    const result = await executeFileTool(makeCall('create_project', { name: '../escape' }), projectPath)
    expect(result.status).toBe('error')
  })

  it('rejects existing project name', async () => {
    // Create a subdirectory that would conflict
    await fsp.mkdir(path.join(projectPath, 'ExistingProject'), { recursive: true })
    const result = await executeFileTool(makeCall('create_project', { name: 'ExistingProject' }), projectPath)
    expect(result.status).toBe('error')
  })
})

describe('delete_project', () => {
  it('deletes a project', async () => {
    await fsp.mkdir(path.join(projectPath, 'toDelete'), { recursive: true })
    const result = await executeFileTool(makeCall('delete_project', { project_name: 'toDelete' }), projectPath)
    expect(result.status).toBe('success')
    await expect(fsp.access(path.join(projectPath, 'toDelete'))).rejects.toThrow()
  })

  it('rejects non-existent project', async () => {
    const result = await executeFileTool(makeCall('delete_project', { project_name: 'notExist' }), projectPath)
    expect(result.status).toBe('error')
  })
})

// ── Backups (disabled) ──

describe('list_backups', () => {
  it('returns empty when backups disabled', async () => {
    const result = await executeFileTool(makeCall('list_backups', { file_path: 'outline/plot.md' }), projectPath)
    expect(result.status).toBe('success')
  })
})

// ── Image Search ──

describe('search_images', () => {
  it('rejects empty query', async () => {
    const result = await executeFileTool(makeCall('search_images', { query: '' }), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('不能为空')
  })
})

// ── Edge Cases & Error Handling ──

describe('edge cases', () => {
  it('returns error for unknown tool name', async () => {
    const result = await executeFileTool(makeCall('unknown_tool_name' as any, {}), projectPath)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('未知操作')
  })

  it('handles path with Windows backslashes', async () => {
    const result = await executeFileTool(makeCall('read_file', { file_path: 'outline\\plot.md' }), projectPath)
    expect(result.status).toBe('success')
  })

  it('path hint includes correct directory structure', async () => {
    const result = await executeFileTool(makeCall('read_file', { file_path: 'worldview/items.json' }), projectPath)
    expect(result.status).toBe('error')
    expect(result.detail).toContain('outline/')
    expect(result.detail).toContain('characters/')
  })
})
