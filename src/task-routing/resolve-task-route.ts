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

/**
 * Classify the message and resolve to a tier + model string.
 * Returns null when routing is not applicable (missing tier config → graceful fallback).
 */
export function resolveTaskRoute(params: {
  routingConfig: TaskRoutingConfig;
  messageBody: string;
  context: ClassifierContext;
}): RoutingDecision | null {
  const { routingConfig, messageBody, context } = params;

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

  return {
    classification,
    tier: tierName,
    model: tierConfig.model,
  };
}
