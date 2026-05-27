import { fileTools } from './fileTools'
import { kbTools } from './kbTools'
import { noteTools } from './noteTools'
import { imageTools } from './imageTools'
import { templateTools } from './templateTools'
import { projectTools } from './projectTools'
import { promptTools } from './promptTools'
import type { ToolDefinition } from '../ToolRegistry'

export const ALL_TOOLS: ToolDefinition[] = [
  ...fileTools,      // 8 tools: list_directory, read_file, search_files, search_content, edit_file, create_file, delete_file, rename_file
  ...kbTools,        // 4 tools: kb_list, kb_create_file, kb_append_file, kb_index_file
  ...noteTools,      // 5 tools: list_notes, read_note, write_note, append_note, delete_note
  ...imageTools,     // 2 tools: search_images, generate_image
  ...templateTools,  // 2 tools: create_style_template, create_scene_template
  ...projectTools,   // 2 tools: create_project, delete_project
  ...promptTools,    // 3 tools: list_prompts, toggle_prompt, update_prompt
  // Total: 26 tools
]

export { fileTools, kbTools, noteTools, imageTools, templateTools, projectTools, promptTools }
