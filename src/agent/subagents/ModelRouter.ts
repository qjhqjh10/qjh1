// ── Model Router ──
// Maps task types to model tiers for cost optimization.
// Cheap tasks (read/search/list) → cheap model, complex tasks → main model.

import type { ModelTier } from './SubAgentManager'

export interface ModelConfig {
  tier: ModelTier
  configId: string       // Which API config to use
  modelName?: string     // Optional override model name
}

export interface RouterConfig {
  cheap: ModelConfig
  main: ModelConfig
  eval: ModelConfig
}

/**
 * Suggests model tier based on tool category.
 * Read-only tools → cheap, write tools → main, evaluation → eval.
 */
export function suggestModelTier(toolNames: string[]): ModelTier {
  const writeTools = toolNames.filter(t =>
    /^(create_|edit_|delete_|rename_|write_|append_|generate_|update_|toggle_|learn_)/.test(t)
  )
  // If any write tool → main
  if (writeTools.length > 0) return 'main'
  // If only read tools → cheap
  return 'cheap'
}

export class ModelRouter {
  private configs: RouterConfig

  constructor(configs: RouterConfig) {
    this.configs = configs
  }

  getConfigForTier(tier: ModelTier): ModelConfig {
    return this.configs[tier] || this.configs.main
  }

  getConfigIdForTier(tier: ModelTier): string {
    return this.getConfigForTier(tier).configId
  }

  /** Auto-detect tier from tool list */
  autoRoute(toolNames: string[]): ModelConfig {
    return this.getConfigForTier(suggestModelTier(toolNames))
  }

  updateConfig(tier: ModelTier, config: Partial<ModelConfig>): void {
    this.configs[tier] = { ...this.configs[tier], ...config }
  }
}
