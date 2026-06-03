import { fileTools } from './fileTools'
import { kbTools } from './kbTools'
import { noteTools } from './noteTools'
import { imageTools } from './imageTools'
import { templateTools } from './templateTools'
import { projectTools } from './projectTools'
import { promptTools } from './promptTools'
import { harnessTools } from './harnessTools'
import { httpTools } from './httpTools'
import { browserTools } from './browserTools'
import { shellTools } from './shellTools'
import { lspTools } from './lspTools'
import type { ToolDefinition } from '../ToolRegistry'

export const ALL_TOOLS: ToolDefinition[] = [
  ...fileTools,      // 7 tools
  ...kbTools,        // 4 tools
  ...noteTools,      // 5 tools
  ...imageTools,     // 2 tools
  ...templateTools,  // 2 tools
  ...projectTools,   // 2 tools
  ...promptTools,    // 3 tools
  ...harnessTools,   // 4 tools
  ...httpTools,      // 2 tools: http_get, http_fetch
  ...browserTools,   // 2 tools: browser_open, browser_search
  ...shellTools,     // 2 tools: shell_exec, shell_run_script
  ...lspTools,       // 1 tool: lsp_diagnose
  // Total: 37 tools
]

export { fileTools, kbTools, noteTools, imageTools, templateTools, projectTools, promptTools, harnessTools }
