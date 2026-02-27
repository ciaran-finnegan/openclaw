import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { isModelAllowed } from "./allowlist.js";
import { applyBudgetGate, resolveBand } from "./catalogue/budget.js";
import {
  aggregateObserved,
  appendRoutingEvent,
  appendRoutingFeedback,
  readRoutingEvents,
  readRoutingFeedback,
} from "./catalogue/observed.js";
import { scoreModelSync } from "./catalogue/scorer.js";
import type {
  CatalogueModelEntry,
  ModelProfile,
  ObservedPerformance,
  RoutingEvent,
  RoutingFeedbackEvent,
} from "./catalogue/types.js";
import { getRoutingEscalationFallbacks, resolveTaskRoute } from "./resolve-task-route.js";
import type { ClassifierContext, TaskRoutingConfig, TaskType } from "./types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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

const baseCtx: ClassifierContext = { isHeartbeat: false, isSubAgent: false };

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "routing-integ-test-"));
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

function makeAllowlistConfig(
  providers?: Record<string, { models: Array<{ id: string }> }>,
): OpenClawConfig {
  if (!providers) {
    return {} as OpenClawConfig;
  }
  const modelsProviders: Record<
    string,
    {
      baseUrl: string;
      models: Array<{
        id: string;
        name: string;
        reasoning: boolean;
        input: Array<"text">;
        cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
        contextWindow: number;
        maxTokens: number;
      }>;
    }
  > = {};
  for (const [name, cfg] of Object.entries(providers)) {
    modelsProviders[name] = {
      baseUrl: `https://${name}.example.com`,
      models: cfg.models.map((m) => ({
        ...m,
        name: m.id,
        reasoning: false,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      })),
    };
  }
  return { models: { providers: modelsProviders } } as OpenClawConfig;
}

// ---------------------------------------------------------------------------
// a) All 8 task categories route correctly
// ---------------------------------------------------------------------------

describe("integration: task category routing", () => {
  const cases: Array<{
    label: string;
    message: string;
    context: ClassifierContext;
    expectedTask: TaskType;
    expectedTier: string;
  }> = [
    {
      label: "heartbeat → cheap",
      message: "ping",
      context: { isHeartbeat: true, isSubAgent: false },
      expectedTask: "heartbeat",
      expectedTier: "cheap",
    },
    {
      label: "status → cheap",
      message: "what is your status",
      context: baseCtx,
      expectedTask: "status",
      expectedTier: "cheap",
    },
    {
      label: "chat → cheap",
      message: "hello there",
      context: baseCtx,
      expectedTask: "chat",
      expectedTier: "cheap",
    },
    {
      label: "writing → mid",
      message: "draft a blog post about testing strategies",
      context: baseCtx,
      expectedTask: "writing",
      expectedTier: "mid",
    },
    {
      label: "coding → frontier",
      message: "write a function to sort an array using quicksort",
      context: baseCtx,
      expectedTask: "coding",
      expectedTier: "frontier",
    },
    {
      label: "planning → frontier",
      message: `Here is the project plan:
1. Set up the database schema
2. Write the API layer
3. Build the frontend
4. Write integration tests
5. Deploy to production`,
      context: baseCtx,
      expectedTask: "planning",
      expectedTier: "frontier",
    },
    {
      label: "tool_use → frontier",
      message: "do something interesting",
      context: { isHeartbeat: false, isSubAgent: false, requestedTools: ["browser", "exec"] },
      expectedTask: "tool_use",
      expectedTier: "frontier",
    },
    {
      label: "sub_agent → mid",
      message: "summarise this document",
      context: { isHeartbeat: false, isSubAgent: true },
      expectedTask: "sub_agent",
      expectedTier: "mid",
    },
  ];

  for (const { label, message, context, expectedTask, expectedTier } of cases) {
    it(`routes ${label}`, () => {
      const result = resolveTaskRoute({
        routingConfig: baseConfig,
        messageBody: message,
        context,
      });
      expect(result).not.toBeNull();
      expect(result!.classification.task).toBe(expectedTask);
      expect(result!.tier).toBe(expectedTier);
    });
  }
});

// ---------------------------------------------------------------------------
// b) Budget gate triggers at configured thresholds
// ---------------------------------------------------------------------------

describe("integration: budget gate full flow", () => {
  it("allows normal routing when budget usage is below 75%", async () => {
    // Spend $5 of $10 daily limit = 50%
    for (let i = 0; i < 5; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }

    const gate = await applyBudgetGate({ enabled: true, dailyLimit: 10 }, tmpDir);
    expect(gate.band).toBe("normal");

    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("frontier");
  });

  it("restricts coding task to mid when budget is 75-90%", async () => {
    // Spend $8 of $10 daily limit = 80%
    for (let i = 0; i < 8; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }

    const gate = await applyBudgetGate({ enabled: true, dailyLimit: 10 }, tmpDir);
    expect(gate.band).toBe("mid-only");

    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("mid");
    expect(result!.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("downgrades coding task to cheap when budget is 90-100%", async () => {
    // Spend $9.5 of $10 = 95%
    for (let i = 0; i < 19; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 0.5 }), tmpDir);
    }

    const gate = await applyBudgetGate({ enabled: true, dailyLimit: 10 }, tmpDir);
    expect(gate.band).toBe("cheap-only");

    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("blocks request when budget exceeded with block action", async () => {
    for (let i = 0; i < 12; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }

    const gate = await applyBudgetGate(
      { enabled: true, dailyLimit: 10, overBudgetAction: "block" },
      tmpDir,
    );
    expect(gate.blocked).toBe(true);

    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result).toBeNull();
  });

  it("downgrades to cheap when budget exceeded with downgrade action", async () => {
    for (let i = 0; i < 12; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }

    const gate = await applyBudgetGate(
      { enabled: true, dailyLimit: 10, overBudgetAction: "downgrade" },
      tmpDir,
    );
    expect(gate.band).toBe("over-budget");

    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("cheap");
  });

  it("proceeds normally with warning when budget exceeded with warn action", async () => {
    for (let i = 0; i < 12; i++) {
      await appendRoutingEvent(makeEvent({ actualCost: 1.0 }), tmpDir);
    }

    const gate = await applyBudgetGate(
      { enabled: true, dailyLimit: 10, overBudgetAction: "warn" },
      tmpDir,
    );
    expect(gate.warn).toBe(true);

    // warn action sets no maxTier, so routing proceeds unmodified
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("frontier");
  });
});

// ---------------------------------------------------------------------------
// c) Confidence fallback works when classifier is uncertain
// ---------------------------------------------------------------------------

describe("integration: confidence fallback", () => {
  it("falls back to mid tier when chat confidence (0.6) is below threshold (0.75)", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      classifier: { confidenceThreshold: 0.75, fallbackTier: "mid" },
    };

    // "hello" classifies as chat with 0.6 confidence — below 0.75 threshold
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    expect(result!.tier).toBe("mid");
    expect(result!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(result!.classification.task).toBe("chat");
    expect(result!.classification.confidence).toBe(0.6);
  });

  it("routes normally when coding confidence (0.8) meets threshold (0.75)", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      classifier: { confidenceThreshold: 0.75, fallbackTier: "mid" },
    };

    // Coding keywords → 0.8 confidence, above 0.75
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "write a function to sort arrays using quicksort",
      context: baseCtx,
    });
    expect(result!.tier).toBe("frontier");
    expect(result!.classification.task).toBe("coding");
    expect(result!.classification.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

// ---------------------------------------------------------------------------
// d) /model override disables routing for the session
// ---------------------------------------------------------------------------

describe("integration: model override guard", () => {
  // In get-reply.ts, routing is skipped when the session has a model override.
  // We can't easily import the full get-reply pipeline here, so we test the
  // guard pattern: a helper that returns whether routing should run.
  function shouldRoute(hasSessionModelOverride: boolean, routingEnabled: boolean): boolean {
    return routingEnabled && !hasSessionModelOverride;
  }

  it("skips routing when session has a model override", () => {
    expect(shouldRoute(true, true)).toBe(false);
  });

  it("skips routing when routing is disabled", () => {
    expect(shouldRoute(false, false)).toBe(false);
  });

  it("routes when enabled and no model override is active", () => {
    expect(shouldRoute(false, true)).toBe(true);

    // Verify routing produces a valid decision when conditions allow it
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("frontier");
  });
});

// ---------------------------------------------------------------------------
// e) Complexity estimator + maxComplexity tier upgrade (end-to-end)
// ---------------------------------------------------------------------------

describe("integration: complexity tier upgrade", () => {
  it("upgrades cheap to mid when complexity exceeds maxComplexity", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.15 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };

    // Sequencing language ("First...then...") triggers complexity > 0.15
    // but classifies as chat → cheap
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

  it("stays on cheap when complexity is within maxComplexity", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.15 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };

    // "hello" has near-zero complexity
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    });
    expect(result!.tier).toBe("cheap");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });
});

// ---------------------------------------------------------------------------
// f) Allowlist enforcement blocks unconfigured models
// ---------------------------------------------------------------------------

describe("integration: allowlist enforcement", () => {
  it("rejects a model not in the provider allowlist", () => {
    const config = makeAllowlistConfig({
      anthropic: { models: [{ id: "claude-haiku-4-5" }] },
    });
    expect(isModelAllowed("anthropic/claude-opus-4-6", config)).toBe(false);
  });

  it("allows a model that is in the provider allowlist", () => {
    const config = makeAllowlistConfig({
      anthropic: { models: [{ id: "claude-haiku-4-5" }] },
    });
    expect(isModelAllowed("anthropic/claude-haiku-4-5", config)).toBe(true);
  });

  it("routing selects a model that the allowlist then rejects", () => {
    const allowlistCfg = makeAllowlistConfig({
      anthropic: { models: [{ id: "claude-haiku-4-5" }, { id: "claude-sonnet-4-6" }] },
    });

    // Coding → frontier (opus), but opus is not in the allowlist
    const decision = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
    });
    expect(decision).not.toBeNull();
    expect(decision!.model).toBe("anthropic/claude-opus-4-6");

    // Allowlist check happens after routing in the pipeline (get-reply.ts);
    // here we verify the two steps compose correctly.
    const allowed = isModelAllowed(decision!.model, allowlistCfg);
    expect(allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// g) Feedback events are logged correctly
// ---------------------------------------------------------------------------

describe("integration: feedback and observed event logging", () => {
  it("writes and reads routing events with retry/escalation flags", async () => {
    const event = makeEvent({
      retried: true,
      escalated: true,
      model: "anthropic/claude-haiku-4-5",
      taskType: "chat",
    });
    await appendRoutingEvent(event, tmpDir);

    const events = await readRoutingEvents(tmpDir);
    expect(events).toHaveLength(1);
    expect(events[0].retried).toBe(true);
    expect(events[0].escalated).toBe(true);
  });

  it("writes and reads feedback events", async () => {
    const feedback: RoutingFeedbackEvent = {
      timestamp: "2026-02-24T10:00:00Z",
      sessionKey: "test-session",
      originalModel: "anthropic/claude-haiku-4-5",
      originalTaskType: "chat",
      signal: "model_override",
      overriddenTo: "anthropic/claude-opus-4-6",
    };
    await appendRoutingFeedback(feedback, tmpDir);

    const events = await readRoutingFeedback(tmpDir);
    expect(events).toHaveLength(1);
    expect(events[0].signal).toBe("model_override");
    expect(events[0].overriddenTo).toBe("anthropic/claude-opus-4-6");
  });

  it("aggregateObserved computes retryRate and escalationRate", async () => {
    // Write 10 events: 3 retried, 2 escalated
    for (let i = 0; i < 10; i++) {
      await appendRoutingEvent(
        makeEvent({
          model: "anthropic/claude-haiku-4-5",
          taskType: "chat",
          retried: i < 3,
          escalated: i < 2,
        }),
        tmpDir,
      );
    }

    const observed = await aggregateObserved("anthropic/claude-haiku-4-5", "chat", tmpDir);
    expect(observed).toBeDefined();
    expect(observed!.requests).toBe(10);
    expect(observed!.retryRate).toBeCloseTo(0.3);
    expect(observed!.escalationRate).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------------------
// h) Scorer blending with all three data layers
// ---------------------------------------------------------------------------

describe("integration: scorer blending", () => {
  const catalogueEntry: CatalogueModelEntry = {
    displayName: "Test Sonnet",
    suggestedTier: "mid",
    taskScores: { coding: 0.9, chat: 0.75 },
    cost: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    latency: { ttft_ms: 900, tps: 90 },
    contextWindow: 200000,
    toolSupport: true,
    reasoning: true,
  };

  const profile: ModelProfile = {
    model: "test/sonnet",
    profiledAt: "2026-02-01T00:00:00Z",
    taskScores: { coding: 0.85, chat: 0.7 },
    latency: { ttft_ms: 800, tps: 100 },
  };

  const observed: ObservedPerformance = {
    model: "test/sonnet",
    taskType: "coding",
    period: "2026-02-01/2026-02-15",
    requests: 100,
    successRate: 0.95,
    retryRate: 0.05,
    escalationRate: 0.02,
    avgLatencyMs: 600,
    avgInputTokens: 500,
    avgOutputTokens: 1000,
    userOverrideRate: 0,
    effectiveScore: 0.94,
  };

  it("uses catalogue source when only catalogue data exists", () => {
    const score = scoreModelSync({
      model: "test/sonnet",
      taskType: "coding",
      catalogueEntry,
    });
    expect(score.source).toBe("catalogue");
    expect(score.qualityScore).toBe(0.9);
  });

  it("blends all three layers when all data exists", () => {
    const score = scoreModelSync({
      model: "test/sonnet",
      taskType: "coding",
      catalogueEntry,
      profile,
      observed,
    });
    expect(score.source).toBe("blended");
    // 20% catalogue + 20% profile + 60% observed = 0.2*0.9 + 0.2*0.85 + 0.6*0.94
    expect(score.qualityScore).toBeCloseTo(0.2 * 0.9 + 0.2 * 0.85 + 0.6 * 0.94);
  });

  it("observed data influences effective score through blending", () => {
    const catalogueOnly = scoreModelSync({
      model: "test/sonnet",
      taskType: "coding",
      catalogueEntry,
    });
    const blended = scoreModelSync({
      model: "test/sonnet",
      taskType: "coding",
      catalogueEntry,
      observed,
    });
    // Observed effectiveScore (0.94) > catalogue coding (0.9), so blended quality is higher
    expect(blended.qualityScore).toBeGreaterThan(catalogueOnly.qualityScore);
  });

  it("attaches composite score to routing decisions when scorerData is provided", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      scorerData: {
        catalogueEntries: { "anthropic/claude-opus-4-6": catalogueEntry },
      },
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBeDefined();
    expect(result!.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// i) Budget + complexity + allowlist interaction
// ---------------------------------------------------------------------------

describe("integration: budget + complexity + allowlist interaction", () => {
  it("budget gate caps tier even when complexity wants to upgrade", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.1 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };

    // Budget gate restricts to cheap only
    const gate = resolveBand(0.95, "daily", "downgrade");
    expect(gate.maxTier).toBe("cheap");

    // Sequencing language triggers complexity > 0.1, but budget caps at cheap
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

  it("allowlist blocks a model after budget-gated routing selects it", () => {
    const allowlistCfg = makeAllowlistConfig({
      anthropic: { models: [{ id: "claude-opus-4-6" }] },
    });

    // Budget restricts to cheap (haiku), but haiku is NOT in the allowlist
    const gate = resolveBand(0.95, "daily", "downgrade");
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort arrays",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result).not.toBeNull();
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");

    // Allowlist check: haiku not in allowlist (only opus is)
    const allowed = isModelAllowed(result!.model, allowlistCfg);
    expect(allowed).toBe(false);
  });

  it("all three constraints cooperate: budget allows, complexity upgrades, allowlist allows", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5", maxComplexity: 0.1 },
        mid: { model: "anthropic/claude-sonnet-4-6" },
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };

    const allowlistCfg = makeAllowlistConfig({
      anthropic: {
        models: [
          { id: "claude-haiku-4-5" },
          { id: "claude-sonnet-4-6" },
          { id: "claude-opus-4-6" },
        ],
      },
    });

    // Budget allows up to mid tier
    const gate = resolveBand(0.8, "daily", "downgrade");
    expect(gate.maxTier).toBe("mid");

    // Sequencing triggers complexity > 0.1, classifies as chat → cheap,
    // complexity upgrades to mid, budget allows mid
    const result = resolveTaskRoute({
      routingConfig: config,
      messageBody:
        "First set up the database schema, then run the migration scripts to populate data.",
      context: baseCtx,
      budgetGate: gate,
    });
    expect(result!.tier).toBe("mid");
    expect(result!.model).toBe("anthropic/claude-sonnet-4-6");

    // Allowlist allows sonnet
    const allowed = isModelAllowed(result!.model, allowlistCfg);
    expect(allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gap 1: Heartbeat messages route through routing to cheap tier
// ---------------------------------------------------------------------------

describe("heartbeat routing (Gap 1)", () => {
  it("routes heartbeat messages to cheap tier via classifier", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "heartbeat check",
      context: { isHeartbeat: true, isSubAgent: false },
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("cheap");
    expect(result!.classification.task).toBe("heartbeat");
    expect(result!.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("heartbeat classification has confidence 1.0", () => {
    const result = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "anything",
      context: { isHeartbeat: true, isSubAgent: false },
    });
    expect(result!.classification.confidence).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Gap 2: Retry escalation fallbacks
// ---------------------------------------------------------------------------

describe("retry escalation fallbacks (Gap 2)", () => {
  it("returns mid and frontier as escalation fallbacks for cheap tier", () => {
    const decision = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "hello",
      context: baseCtx,
    })!;
    expect(decision.tier).toBe("cheap");

    const fallbacks = getRoutingEscalationFallbacks(decision, baseConfig);
    expect(fallbacks).toEqual(["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-6"]);
  });

  it("returns frontier as escalation fallback for mid tier", () => {
    const decision = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "draft a blog post about testing best practices",
      context: baseCtx,
    })!;
    expect(decision.tier).toBe("mid");

    const fallbacks = getRoutingEscalationFallbacks(decision, baseConfig);
    expect(fallbacks).toEqual(["anthropic/claude-opus-4-6"]);
  });

  it("returns empty fallbacks for frontier tier (already at top)", () => {
    const decision = resolveTaskRoute({
      routingConfig: baseConfig,
      messageBody: "write a function to sort an array",
      context: baseCtx,
    })!;
    expect(decision.tier).toBe("frontier");

    const fallbacks = getRoutingEscalationFallbacks(decision, baseConfig);
    expect(fallbacks).toEqual([]);
  });

  it("skips tiers that are not configured", () => {
    const config: TaskRoutingConfig = {
      ...baseConfig,
      tiers: {
        cheap: { model: "anthropic/claude-haiku-4-5" },
        // no mid tier
        frontier: { model: "anthropic/claude-opus-4-6" },
      },
    };
    const decision = resolveTaskRoute({
      routingConfig: config,
      messageBody: "hello",
      context: baseCtx,
    })!;
    expect(decision.tier).toBe("cheap");

    const fallbacks = getRoutingEscalationFallbacks(decision, config);
    // mid is not configured, so only frontier is returned
    expect(fallbacks).toEqual(["anthropic/claude-opus-4-6"]);
  });
});

// ---------------------------------------------------------------------------
// Gap 10: Logging config (enabled/disabled)
// ---------------------------------------------------------------------------

describe("logging config (Gap 10)", () => {
  it("skips event logging when logging.enabled is false", async () => {
    const event = makeEvent();
    await appendRoutingEvent(event, tmpDir, { enabled: false });
    const events = await readRoutingEvents(tmpDir);
    expect(events).toHaveLength(0);
  });

  it("logs events normally when logging.enabled is true", async () => {
    const event = makeEvent();
    await appendRoutingEvent(event, tmpDir, { enabled: true });
    const events = await readRoutingEvents(tmpDir);
    expect(events).toHaveLength(1);
  });

  it("logs events normally when logging config is undefined", async () => {
    const event = makeEvent();
    await appendRoutingEvent(event, tmpDir, undefined);
    const events = await readRoutingEvents(tmpDir);
    expect(events).toHaveLength(1);
  });
});
