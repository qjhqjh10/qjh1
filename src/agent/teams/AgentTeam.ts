// ── Agent Team Coordinator ──
// Multiple peer agents coordinated via shared filesystem (Claude Code model).
// Relay model: Planner → Coder → Reviewer → Fixer

import type { ToolDefinition } from '../tools/ToolRegistry'

export interface TeamRole {
  name: string
  systemPrompt: string
  toolNames: string[]
  maxIterations: number
}

export interface TeamResult {
  role: string
  status: 'success' | 'error'
  output: string
  tokenCost: number
  duration: number
}

export const TEAM_ROLES: Record<string, TeamRole> = {
  planner: {
    name: 'Planner',
    systemPrompt: '你是规划专家。分析用户需求，确定要操作的文件和工具，输出步骤计划。用 read_file / list_directory / search_files 了解现状。',
    toolNames: ['read_file', 'list_directory', 'search_files', 'search_content'],
    maxIterations: 3,
  },
  coder: {
    name: 'Coder',
    systemPrompt: '你是执行专家。根据 Planner 的计划，执行创建、编辑、删除等操作。每次操作前先 read_file 确认内容。',
    toolNames: ['read_file', 'write_note', 'append_note', 'create_file', 'edit_file', 'delete_file', 'rename_file'],
    maxIterations: 5,
  },
  reviewer: {
    name: 'Reviewer',
    systemPrompt: '你是审查专家。检查 Coder 的输出是否完整、正确。只读操作，发现问题记录到草稿。',
    toolNames: ['read_file', 'list_directory', 'search_content', 'search_files', 'list_notes', 'read_note', 'write_note'],
    maxIterations: 3,
  },
  fixer: {
    name: 'Fixer',
    systemPrompt: '你是修复专家。根据 Reviewer 发现的问题进行修正。每个问题逐一修复。',
    toolNames: ['read_file', 'edit_file', 'create_file', 'delete_file', 'write_note', 'append_note'],
    maxIterations: 3,
  },
}

export class AgentTeam {
  private roles: TeamRole[] = []

  constructor(roleNames: string[] = ['planner', 'coder']) {
    for (const name of roleNames) {
      if (TEAM_ROLES[name]) this.roles.push({ ...TEAM_ROLES[name] })
    }
  }

  getRoles(): TeamRole[] {
    return this.roles
  }

  addRole(name: string): void {
    if (TEAM_ROLES[name]) this.roles.push({ ...TEAM_ROLES[name] })
  }
}
