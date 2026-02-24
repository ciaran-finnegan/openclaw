import { describe, it, expect } from "vitest";
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
});
