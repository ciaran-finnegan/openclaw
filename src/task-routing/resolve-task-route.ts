import { scoreModelSync } from "./catalogue/scorer.js";
import type { CatalogueModelEntry, ModelProfile, ObservedPerformance } from "./catalogue/types.js";
import { classifyTask } from "./classifier.js";
import type { ClassifierContext, RoutingDecision, TaskRoutingConfig, TaskType } from "./types.js";

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
}): RoutingDecision | null {
  const { routingConfig, messageBody, context, scorerData } = params;

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
