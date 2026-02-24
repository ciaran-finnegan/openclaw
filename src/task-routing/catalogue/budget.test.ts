import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetConfig } from "../types.js";
import { applyBudgetGate, resolveBand } from "./budget.js";
import { appendRoutingEvent } from "./observed.js";
import type { RoutingEvent } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "openclaw-budget-test-"));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<RoutingEvent> = {}): RoutingEvent {
  return {
    timestamp: new Date().toISOString(),
    model: "anthropic/claude-sonnet-4-6",
    taskType: "coding",
    success: true,
    retried: false,
    escalated: false,
    latencyMs: 500,
    inputTokens: 1000,
    outputTokens: 500,
    actualCost: 0.01,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveBand (pure function — unit tests)
// ---------------------------------------------------------------------------

describe("resolveBand", () => {
  it("returns normal band when usage is below 75%", () => {
    const result = resolveBand(0.5, "daily", "downgrade");
    expect(result.band).toBe("normal");
    expect(result.blocked).toBe(false);
    expect(result.warn).toBe(false);
    expect(result.maxTier).toBeUndefined();
  });

  it("returns normal band at 0% usage", () => {
    const result = resolveBand(0, "daily", "downgrade");
    expect(result.band).toBe("normal");
  });

  it("returns mid-only band at 75% usage", () => {
    const result = resolveBand(0.75, "daily", "downgrade");
    expect(result.band).toBe("mid-only");
    expect(result.maxTier).toBe("mid");
    expect(result.blocked).toBe(false);
  });

  it("returns mid-only band at 89% usage", () => {
    const result = resolveBand(0.89, "monthly", "downgrade");
    expect(result.band).toBe("mid-only");
    expect(result.maxTier).toBe("mid");
    expect(result.reason).toContain("89%");
    expect(result.reason).toContain("monthly");
  });

  it("returns cheap-only band at 90% usage", () => {
    const result = resolveBand(0.9, "daily", "downgrade");
    expect(result.band).toBe("cheap-only");
    expect(result.maxTier).toBe("cheap");
    expect(result.blocked).toBe(false);
  });

  it("returns cheap-only band at 99% usage", () => {
    const result = resolveBand(0.99, "daily", "downgrade");
    expect(result.band).toBe("cheap-only");
    expect(result.maxTier).toBe("cheap");
  });

  // overBudgetAction: downgrade
  it("returns over-budget + cheap tier for downgrade action at 100%", () => {
    const result = resolveBand(1.0, "daily", "downgrade");
    expect(result.band).toBe("over-budget");
    expect(result.maxTier).toBe("cheap");
    expect(result.blocked).toBe(false);
    expect(result.warn).toBe(false);
  });

  it("returns over-budget + cheap tier for downgrade action over 100%", () => {
    const result = resolveBand(1.5, "daily", "downgrade");
    expect(result.band).toBe("over-budget");
    expect(result.maxTier).toBe("cheap");
    expect(result.blocked).toBe(false);
  });

  // overBudgetAction: block
  it("returns blocked=true for block action at 100%", () => {
    const result = resolveBand(1.0, "daily", "block");
    expect(result.band).toBe("over-budget");
    expect(result.blocked).toBe(true);
    expect(result.warn).toBe(false);
  });

  // overBudgetAction: warn
  it("returns warn=true for warn action at 100%", () => {
    const result = resolveBand(1.0, "daily", "warn");
    expect(result.band).toBe("over-budget");
    expect(result.blocked).toBe(false);
    expect(result.warn).toBe(true);
  });

  it("preserves usageRatio in result", () => {
    const result = resolveBand(0.83, "monthly", "downgrade");
    expect(result.usageRatio).toBe(0.83);
  });
});

// ---------------------------------------------------------------------------
// applyBudgetGate (integration tests with JSONL on disk)
// ---------------------------------------------------------------------------

describe("applyBudgetGate", () => {
  it("passes through when budget is disabled", async () => {
    const budget: BudgetConfig = { enabled: false, dailyLimit: 1 };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("normal");
    expect(result.blocked).toBe(false);
  });

  it("passes through when no limits are configured", async () => {
    const budget: BudgetConfig = { enabled: true };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("normal");
  });

  it("returns normal band with empty log", async () => {
    const budget: BudgetConfig = { enabled: true, dailyLimit: 10 };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("normal");
    expect(result.usageRatio).toBe(0);
  });

  it("returns normal band when daily spend is below 75% of limit", async () => {
    // Daily limit $10, spend $5 = 50%
    for (let i = 0; i < 5; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }
    const budget: BudgetConfig = { enabled: true, dailyLimit: 10 };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("normal");
  });

  it("returns mid-only band when daily spend is 75-90% of limit", async () => {
    // Daily limit $10, spend $8 = 80%
    for (let i = 0; i < 8; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }
    const budget: BudgetConfig = { enabled: true, dailyLimit: 10 };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("mid-only");
    expect(result.maxTier).toBe("mid");
  });

  it("returns cheap-only band when daily spend is 90-100% of limit", async () => {
    // Daily limit $10, spend $9.5 = 95%
    for (let i = 0; i < 19; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 0.5 }), tmpDir);
    }
    const budget: BudgetConfig = { enabled: true, dailyLimit: 10 };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("cheap-only");
    expect(result.maxTier).toBe("cheap");
  });

  it("returns over-budget with downgrade when daily spend exceeds limit", async () => {
    // Daily limit $10, spend $12
    for (let i = 0; i < 12; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }
    const budget: BudgetConfig = {
      enabled: true,
      dailyLimit: 10,
      overBudgetAction: "downgrade",
    };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("over-budget");
    expect(result.maxTier).toBe("cheap");
    expect(result.blocked).toBe(false);
  });

  it("returns blocked when daily spend exceeds limit with block action", async () => {
    for (let i = 0; i < 12; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }
    const budget: BudgetConfig = {
      enabled: true,
      dailyLimit: 10,
      overBudgetAction: "block",
    };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.blocked).toBe(true);
  });

  it("uses tightest constraint between daily and monthly limits", async () => {
    // Daily limit $100 (0% used), monthly limit $10 (80% used)
    for (let i = 0; i < 8; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }
    const budget: BudgetConfig = {
      enabled: true,
      dailyLimit: 100,
      monthlyLimit: 10,
    };
    const result = await applyBudgetGate(budget, tmpDir);
    // Monthly is tighter: 8/10 = 80% → mid-only
    expect(result.band).toBe("mid-only");
  });

  it("ignores events with no actualCost (treats as 0)", async () => {
    await appendRoutingEvent(makeEvent({ actualCost: undefined }), tmpDir);
    await appendRoutingEvent(makeEvent({ actualCost: undefined }), tmpDir);
    const budget: BudgetConfig = { enabled: true, dailyLimit: 10 };
    const result = await applyBudgetGate(budget, tmpDir);
    expect(result.band).toBe("normal");
    expect(result.usageRatio).toBe(0);
  });
});
