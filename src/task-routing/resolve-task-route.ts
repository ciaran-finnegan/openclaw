import type { BudgetGateResult } from "./catalogue/budget.js";
import { scoreModelSync } from "./catalogue/scorer.js";
import type { CatalogueModelEntry, ModelProfile, ObservedPerformance } from "./catalogue/types.js";
import { classifyTask } from "./classifier.js";
import { estimateComplexity } from "./complexity.js";
import type { ClassifierContext, RoutingDecision, TaskRoutingConfig, TaskType } from "./types.js";

/** Tier priority order for budget-gated downgrades. */
const TIER_PRIORITY: readonly string[] = ["frontier", "mid", "cheap"];

/** Default task → tier mapping when user config omits taskMap. */
const DEFAULT_TASK_MAP: Record<TaskType, string> = {
  heartbeat: "cheap",
  status: "cheap",
  chat: "cheap",
  writing: "mid",
  coding: "frontier",
  planning: "frontier",
  tool_use: "frontier",
  sub_agent: "mid",
};

/** Pre-loaded scorer data for synchronous scoring inside resolveTaskRoute. */
export type ScorerData = {
  catalogueEntries?: Record<string, CatalogueModelEntry>;
  profiles?: Record<string, ModelProfile>;
  observed?: Record<string, ObservedPerformance>;
};

/**
 * Classify the message and resolve to a tier + model string.
 * Returns null when routing is not applicable (missing tier config → graceful fallback).
 *
 * When `scorerData` is provided, the scorer validates the tier selection and
 * attaches a composite score to the decision.
 */
export function resolveTaskRoute(params: {
  routingConfig: TaskRoutingConfig;
  messageBody: string;
  context: ClassifierContext;
  scorerData?: ScorerData;
  /** Pre-computed budget gate result. When set, may override the tier selection. */
  budgetGate?: BudgetGateResult;
}): RoutingDecision | null {
  const { routingConfig, messageBody, context, scorerData, budgetGate } = params;

  // Budget gate: block the request entirely if configured.
  if (budgetGate?.blocked) {
    return null;
  }

  const classification = classifyTask(messageBody, context);

  // Merge user taskMap over defaults.
  const taskMap = { ...DEFAULT_TASK_MAP, ...routingConfig.taskMap };
  const threshold = routingConfig.classifier?.confidenceThreshold ?? 0;
  const fallbackTierName = routingConfig.classifier?.fallbackTier;

  // Apply confidence threshold: if below threshold, use fallback tier (if configured).
  let tierName: string;
  if (classification.confidence < threshold && fallbackTierName) {
    tierName = fallbackTierName;
  } else {
    tierName = taskMap[classification.task] ?? "frontier";
  }

  // Budget gate: downgrade tier if spending exceeds thresholds.
  if (budgetGate?.maxTier) {
    tierName = downgradeTier(tierName, budgetGate.maxTier, routingConfig);
  }

  // Complexity check: if the selected tier has maxComplexity and the message
  // exceeds it, bump up to the next higher tier (unless budget-gated).
  const tierCfgForComplexity = routingConfig.tiers?.[tierName];
  if (tierCfgForComplexity?.maxComplexity !== undefined) {
    const complexity = estimateComplexity(messageBody, context);
    if (complexity > tierCfgForComplexity.maxComplexity) {
      const upgraded = upgradeTier(tierName, routingConfig, budgetGate?.maxTier);
      if (upgraded) {
        tierName = upgraded;
      }
    }
  }

  const tierConfig = routingConfig.tiers?.[tierName];
  if (!tierConfig) {
    return null;
  }

  // If scorer data is available, compute a composite score for the selected model.
  let score: number | undefined;
  if (scorerData) {
    const modelScore = scoreModelSync({
      model: tierConfig.model,
      taskType: classification.task,
      catalogueEntry: scorerData.catalogueEntries?.[tierConfig.model],
      profile: scorerData.profiles?.[tierConfig.model],
      observed: scorerData.observed?.[`${tierConfig.model}:${classification.task}`],
      weights: routingConfig.scorer?.weights,
    });
    score = modelScore.composite;
  }

  return {
    classification,
    tier: tierName,
    model: tierConfig.model,
    score,
  };
}

/**
 * Upgrade a tier to the next higher capability tier. Returns null if already
 * at the highest tier or if the upgrade would exceed the budget gate's maxTier.
 */
function upgradeTier(
  currentTier: string,
  config: TaskRoutingConfig,
  budgetMaxTier?: string,
): string | null {
  const currentIdx = TIER_PRIORITY.indexOf(currentTier);
  if (currentIdx <= 0) {
    // Already at frontier (index 0) or unknown tier — cannot upgrade.
    return null;
  }

  const candidate = TIER_PRIORITY[currentIdx - 1];

  // Respect budget gate: don't upgrade past the allowed maximum.
  if (budgetMaxTier) {
    const maxIdx = TIER_PRIORITY.indexOf(budgetMaxTier);
    if (maxIdx !== -1 && currentIdx - 1 < maxIdx) {
      return null;
    }
  }

  // Only upgrade if the target tier is configured.
  if (!config.tiers?.[candidate]) {
    return null;
  }

  return candidate;
}

/**
 * Downgrade a tier to the maximum allowed tier. If the current tier is
 * already at or below the max, returns it unchanged. Falls back to maxTier
 * if the current tier is not found in the priority list.
 */
function downgradeTier(currentTier: string, maxTier: string, config: TaskRoutingConfig): string {
  const currentIdx = TIER_PRIORITY.indexOf(currentTier);
  const maxIdx = TIER_PRIORITY.indexOf(maxTier);

  // Both tiers recognized: pick the lower (higher index = cheaper).
  if (currentIdx !== -1 && maxIdx !== -1) {
    return currentIdx >= maxIdx ? currentTier : TIER_PRIORITY[maxIdx];
  }

  // Current tier is custom / unknown: if it exists in config, keep it; otherwise use maxTier.
  if (config.tiers?.[maxTier]) {
    return maxTier;
  }
  return currentTier;
}
