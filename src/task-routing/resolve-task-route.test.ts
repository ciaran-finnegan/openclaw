import { describe, it, expect } from "vitest";
import type { BudgetGateResult } from "./catalogue/budget.js";
import { resolveTaskRoute } from "./resolve-task-route.js";
import type { TaskRoutingConfig } from "./types.js";

const baseTiers: TaskRoutingConfig["tiers"] = {
  cheap: { model: "anthropic/claude-haiku-4-5" },
  mid: { model: "anthropic/claude-sonnet-4-6" },
  frontier: { model: "anthropic/claude-opus-4-6" },
};

const baseConfig: TaskRoutingConfig = {
  enabled: true,
  strategy: "task-aware",
  tiers: baseTiers,
};

const baseCtx = { isHeartbeat: false, isSubAgent: false };

describe("resolveTaskRoute", () => {
  it("routes heartbeat to cheap tier via default taskMap", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "ping",
      context: { ...baseCtx, isHeartbeat: true },
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
    expect(result!.classification.task).toBe("heartbeat");
  });

  it("routes 'ping' without isHeartbeat flag to status/cheap tier", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "ping",
      context: baseCtx,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.classification.task).toBe("status");
  });

  it("routes coding to frontier tier", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.model).toBe("anthropic/claude-opus-4-6");
  });

  it("routes chat to cheap tier", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "hello there",
      context: baseCtx,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.classification.task).toBe("chat");
  });

  it("routes writing to mid tier", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "draft a blog post about testing",
      context: baseCtx,
    });
    expect(result!.tier).toBe("mid");
    expect(result!.classification.task).toBe("writing");
  });

  it("routes sub_agent to mid tier", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "summarize this",
      context: { ...baseCtx, isSubAgent: true },
    });
    expect(result!.tier).toBe("mid");
    expect(result!.classification.task).toBe("sub_agent");
  });

  it("returns null when tier is not configured (graceful fallback)", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: { cheap: { model: "anthropic/claude-haiku-4-5" } },
      // no "frontier" tier configured
    };
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "write a function",
      context: baseCtx,
    });
    expect(result).toBeNull();
  });

  it("applies custom taskMap overrides", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      taskMap: { chat: "frontier" },
    };
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.model).toBe("anthropic/claude-opus-4-6");
  });

  it("applies confidence threshold with fallback tier", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      classifier: {
        confidenceThreshold: 0.75,
        fallbackTier: "frontier",
      },
    };
    // "hello" → chat at 0.6 confidence, below 0.75 threshold → fallback to frontier
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.model).toBe("anthropic/claude-opus-4-6");
  });

  it("does not apply fallback when confidence meets threshold", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      classifier: {
        confidenceThreshold: 0.5,
        fallbackTier: "frontier",
      },
    };
    // "hello" → chat at 0.6 confidence, above 0.5 threshold → uses normal tier
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    expect(result!.tier).toBe("cheap");
  });

  it("falls through to normal mapping when no fallbackTier is set even if below threshold", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      classifier: {
        confidenceThreshold: 0.99,
        // no fallbackTier
      },
    };
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    // No fallbackTier → uses normal tier mapping despite low confidence
    expect(result!.tier).toBe("cheap");
  });

  // ---------------------------------------------------------------------------
  // Budget gate integration
  // ---------------------------------------------------------------------------

  it("returns null when budgetGate is blocked", () => {
    const gate: BudgetGateResult = {
      band: "over-budget",
      blocked: true,
      warn: false,
      usageRatio: 1.2,
    };
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result).toBeNull();
  });

  it("downgrades frontier to mid when budgetGate maxTier is mid", () => {
    const gate: BudgetGateResult = {
      band: "mid-only",
      maxTier: "mid",
      blocked: false,
      warn: false,
      usageRatio: 0.8,
    };
    // "write a function" classifies as coding → frontier, but gate forces mid
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("mid");
    expect(result!.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("downgrades frontier to cheap when budgetGate maxTier is cheap", () => {
    const gate: BudgetGateResult = {
      band: "cheap-only",
      maxTier: "cheap",
      blocked: false,
      warn: false,
      usageRatio: 0.95,
    };
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("does not upgrade tier: cheap stays cheap even if maxTier is mid", () => {
    const gate: BudgetGateResult = {
      band: "mid-only",
      maxTier: "mid",
      blocked: false,
      warn: false,
      usageRatio: 0.8,
    };
    // "hello" classifies as chat → cheap; gate allows up to mid, so no change
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "hello",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("does not downgrade when budgetGate band is normal", () => {
    const gate: BudgetGateResult = {
      band: "normal",
      blocked: false,
      warn: false,
      usageRatio: 0.3,
    };
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.model).toBe("anthropic/claude-opus-4-6");
  });

  it("handles budgetGate with warn action (no tier change)", () => {
    const gate: BudgetGateResult = {
      band: "over-budget",
      blocked: false,
      warn: true,
      usageRatio: 1.1,
    };
    // warn action: no maxTier set, so routing proceeds normally
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.model).toBe("anthropic/claude-opus-4-6");
  });

  // ---------------------------------------------------------------------------
  // maxComplexity tier upgrade (Phase 4)
  // ---------------------------------------------------------------------------

  it("upgrades cheap to mid when complexity exceeds maxComplexity", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.1 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };
    // Sequencing language triggers hasMultiStep in complexity estimator (>0.25)
    // but does NOT trigger hasMultiStepList in classifier (needs 3+ list items),
    // so this classifies as "chat" → cheap tier, then upgrades via complexity.
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody:
        "First set up the database schema with all the tables, then run the migration scripts to populate initial data.",
      context: baseCtx,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("mid");
    expect(result!.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("does not upgrade when complexity is within maxComplexity", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.9 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("upgrades mid to frontier when complexity exceeds mid tier maxComplexity", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5" },
        mid: { model: "anthropic/claude-sonnet-4-6", maxComplexity: 0.1 },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
      taskMap: { chat: "mid" },
    };
    // Sequencing language triggers complexity > 0.1, classifies as chat → mid
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody:
        "First design the schema carefully, then write all the migration scripts to populate the tables.",
      context: baseCtx,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.model).toBe("anthropic/claude-opus-4-6");
  });

  it("does not upgrade past frontier (already at top tier)", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5" },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6", maxComplexity: 0.05 },
      },
      taskMap: { chat: "frontier" },
    };
    // chat → frontier via taskMap, maxComplexity 0.05, complexity exceeds but already at top tier
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody:
        "First set up the database schema, then configure the application settings properly.",
      context: baseCtx,
    });
    expect(result!.tier).toBe("frontier");
  });

  it("respects budget gate when upgrading tier for complexity", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.1 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };
    const gate: BudgetGateResult = {
      band: "cheap-only",
      maxTier: "cheap",
      blocked: false,
      warn: false,
      usageRatio: 0.95,
    };
    // Sequencing triggers complexity > 0.1, but budget gate caps at cheap
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody:
        "First prepare the environment variables, then deploy the application to production servers.",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("does not upgrade when target tier is not configured", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.1 },
        // no mid tier configured
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };
    // Sequencing language triggers complexity > 0.1, classifies as chat → cheap
    // Would want to upgrade to mid, but mid isn't configured — stays cheap
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody:
        "First set up the infrastructure, then configure all the services and deploy them.",
      context: baseCtx,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });
});
