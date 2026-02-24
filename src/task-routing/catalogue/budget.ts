import type { BudgetConfig } from "../types.js";
import { aggregateCostForPeriod } from "./observed.js";

/** Budget usage band that determines routing behaviour. */
export type BudgetBand = "normal" | "mid-only" | "cheap-only" | "over-budget";

export type BudgetGateResult = {
  /** The effective budget band after checking daily and monthly limits. */
  band: BudgetBand;
  /** Maximum tier allowed (undefined = no restriction). */
  maxTier?: string;
  /** Whether the request should be blocked entirely. */
  blocked: boolean;
  /** Whether a warning should be attached to the response. */
  warn: boolean;
  /** Usage ratio (0–1+) for the tightest limit hit. */
  usageRatio: number;
  /** Human-readable reason for the gate decision. */
  reason?: string;
};

/**
 * Progressive budget gate.
 *
 * Thresholds:
 * -  0–75% budget used: normal routing (no restrictions)
 * - 75–90% budget used: force mid-tier maximum (no frontier)
 * - 90–100% budget used: force cheap tier only
 * - 100%+: apply overBudgetAction (downgrade/block/warn)
 */
export async function applyBudgetGate(
  budget: BudgetConfig,
  stateDir?: string,
): Promise<BudgetGateResult> {
  if (!budget.enabled) {
    return { band: "normal", blocked: false, warn: false, usageRatio: 0 };
  }

  // Check both daily and monthly limits; use the tightest constraint.
  let worstRatio = 0;
  let limitLabel = "";

  if (budget.dailyLimit !== undefined && budget.dailyLimit > 0) {
    const daily = await aggregateCostForPeriod("day", stateDir);
    const ratio = daily.totalCost / budget.dailyLimit;
    if (ratio > worstRatio) {
      worstRatio = ratio;
      limitLabel = "daily";
    }
  }

  if (budget.monthlyLimit !== undefined && budget.monthlyLimit > 0) {
    const monthly = await aggregateCostForPeriod("month", stateDir);
    const ratio = monthly.totalCost / budget.monthlyLimit;
    if (ratio > worstRatio) {
      worstRatio = ratio;
      limitLabel = "monthly";
    }
  }

  // No limits configured — pass through.
  if (limitLabel === "") {
    return { band: "normal", blocked: false, warn: false, usageRatio: 0 };
  }

  return resolveBand(worstRatio, limitLabel, budget.overBudgetAction ?? "downgrade");
}

/** Pure function: resolve budget band from usage ratio. Exported for testing. */
export function resolveBand(
  usageRatio: number,
  limitLabel: string,
  action: NonNullable<BudgetConfig["overBudgetAction"]>,
): BudgetGateResult {
  if (usageRatio < 0.75) {
    return { band: "normal", blocked: false, warn: false, usageRatio };
  }

  if (usageRatio < 0.9) {
    return {
      band: "mid-only",
      maxTier: "mid",
      blocked: false,
      warn: false,
      usageRatio,
      reason: `${(usageRatio * 100).toFixed(0)}% of ${limitLabel} budget used — restricting to mid tier`,
    };
  }

  if (usageRatio < 1.0) {
    return {
      band: "cheap-only",
      maxTier: "cheap",
      blocked: false,
      warn: false,
      usageRatio,
      reason: `${(usageRatio * 100).toFixed(0)}% of ${limitLabel} budget used — restricting to cheap tier`,
    };
  }

  // Over budget — apply configured action.
  switch (action) {
    case "block":
      return {
        band: "over-budget",
        blocked: true,
        warn: false,
        usageRatio,
        reason: `${limitLabel} budget exceeded — request blocked`,
      };
    case "warn":
      return {
        band: "over-budget",
        blocked: false,
        warn: true,
        usageRatio,
        reason: `${limitLabel} budget exceeded — proceeding with warning`,
      };
    case "downgrade":
    default:
      return {
        band: "over-budget",
        maxTier: "cheap",
        blocked: false,
        warn: false,
        usageRatio,
        reason: `${limitLabel} budget exceeded — downgraded to cheapest tier`,
      };
  }
}
