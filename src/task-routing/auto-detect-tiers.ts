import type { OpenClawConfig } from "../config/config.js";
import { getCatalogueEntry, listCatalogueModels } from "./catalogue/catalogue.js";
import { scoreModelSync } from "./catalogue/scorer.js";
import type { TaskRoutingTierConfig, TaskType } from "./types.js";

/** Standard task types used for composite scoring during auto-detection. */
const SCORE_TASKS: TaskType[] = ["coding", "planning", "writing", "chat", "status", "tool_use"];

/**
 * Auto-detect tier-to-model mappings from the user's configured providers
 * and the shipped benchmark catalogue.
 *
 * For each standard tier (cheap, mid, frontier), picks the best-scoring model
 * that the user has provider access to and whose `suggestedTier` matches.
 *
 * Returns an empty record when no matching models are found (caller should
 * fall back to existing behavior).
 */
export function autoDetectTiers(cfg: OpenClawConfig): Record<string, TaskRoutingTierConfig> {
  const providers = cfg.models?.providers;
  if (!providers) {
    return {};
  }

  // Build a set of "provider/modelId" keys the user has configured.
  const configuredModels = new Set<string>();
  for (const [providerName, providerCfg] of Object.entries(providers)) {
    if (!providerCfg.models || providerCfg.models.length === 0) {
      // Open-ended provider (e.g. Ollama) — skip, can't match catalogue keys.
      continue;
    }
    for (const m of providerCfg.models) {
      configuredModels.add(`${providerName}/${m.id}`);
    }
  }

  if (configuredModels.size === 0) {
    return {};
  }

  // Score every catalogue model the user has access to, grouped by suggestedTier.
  const tiers: Array<"cheap" | "mid" | "frontier"> = ["cheap", "mid", "frontier"];
  const bestByTier: Record<string, { model: string; avgScore: number }> = {};

  for (const catalogueKey of listCatalogueModels()) {
    if (!configuredModels.has(catalogueKey)) {
      continue;
    }
    const entry = getCatalogueEntry(catalogueKey);
    if (!entry) {
      continue;
    }

    // Compute average composite score across task types.
    let totalScore = 0;
    for (const taskType of SCORE_TASKS) {
      const result = scoreModelSync({
        model: catalogueKey,
        taskType,
        catalogueEntry: entry,
      });
      totalScore += result.composite;
    }
    const avgScore = totalScore / SCORE_TASKS.length;

    const tier = entry.suggestedTier;
    const current = bestByTier[tier];
    if (!current || avgScore > current.avgScore) {
      bestByTier[tier] = { model: catalogueKey, avgScore };
    }
  }

  const result: Record<string, TaskRoutingTierConfig> = {};
  for (const tier of tiers) {
    const best = bestByTier[tier];
    if (best) {
      result[tier] = { model: best.model };
    }
  }

  return result;
}
