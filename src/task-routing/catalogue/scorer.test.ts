import { describe, it, expect } from "vitest";
import { scoreModelSync } from "./scorer.js";
import type { CatalogueModelEntry, ModelProfile, ObservedPerformance } from "./types.js";

const makeCatalogueEntry = (overrides: Partial<CatalogueModelEntry> = {}): CatalogueModelEntry => ({
  displayName: "Test Model",
  suggestedTier: "mid",
  taskScores: {
    coding: 0.9,
    planning: 0.85,
    writing: 0.8,
    chat: 0.75,
    status: 0.7,
    tool_use: 0.88,
  },
  cost: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  latency: { ttft_ms: 900, tps: 90 },
  contextWindow: 200000,
  toolSupport: true,
  reasoning: true,
  ...overrides,
});

const makeProfile = (overrides: Partial<ModelProfile> = {}): ModelProfile => ({
  model: "test/model",
  profiledAt: "2026-01-01T00:00:00Z",
  taskScores: { coding: 0.85, planning: 0.8, writing: 0.75, chat: 0.7 },
  latency: { ttft_ms: 800, tps: 100 },
  ...overrides,
});

const makeObserved = (overrides: Partial<ObservedPerformance> = {}): ObservedPerformance => ({
  model: "test/model",
  taskType: "coding",
  period: "2026-01-01/2026-01-15",
  requests: 100,
  successRate: 0.95,
  retryRate: 0.05,
  escalationRate: 0.02,
  avgLatencyMs: 600,
  avgInputTokens: 500,
  avgOutputTokens: 1000,
  userOverrideRate: 0,
  effectiveScore: 0.94,
  ...overrides,
});

describe("scoreModelSync", () => {
  describe("source selection", () => {
    it("uses catalogue only when no profile or observed data", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
      });
      expect(score.source).toBe("catalogue");
      expect(score.qualityScore).toBe(0.9);
    });

    it("uses profile only when no catalogue or observed data", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        profile: makeProfile(),
      });
      expect(score.source).toBe("profile");
      expect(score.qualityScore).toBe(0.85);
    });

    it("uses observed only when no catalogue or profile data and enough events", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        observed: makeObserved(),
      });
      expect(score.source).toBe("observed");
      expect(score.qualityScore).toBe(0.94);
    });

    it("blends catalogue and profile (50/50) when both available but no observed", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
        profile: makeProfile(),
      });
      expect(score.source).toBe("blended");
      expect(score.qualityScore).toBeCloseTo(0.5 * 0.9 + 0.5 * 0.85);
    });

    it("blends all three layers when all available", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
        profile: makeProfile(),
        observed: makeObserved(),
      });
      expect(score.source).toBe("blended");
      expect(score.qualityScore).toBeCloseTo(0.2 * 0.9 + 0.2 * 0.85 + 0.6 * 0.94);
    });

    it("blends catalogue and observed (30/70) when no profile", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
        observed: makeObserved(),
      });
      expect(score.source).toBe("blended");
      expect(score.qualityScore).toBeCloseTo(0.3 * 0.9 + 0.7 * 0.94);
    });
  });

  describe("observed threshold", () => {
    it("ignores observed data with fewer than 50 events", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
        observed: makeObserved({ requests: 49 }),
      });
      // Should fall through to catalogue-only since observed doesn't meet threshold
      expect(score.source).toBe("catalogue");
      expect(score.qualityScore).toBe(0.9);
    });

    it("uses observed data with exactly 50 events", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
        observed: makeObserved({ requests: 50 }),
      });
      expect(score.source).toBe("blended");
    });
  });

  describe("unknown model fallback", () => {
    it("defaults to 0.5 quality for a completely unknown model", () => {
      const score = scoreModelSync({
        model: "unknown/model",
        taskType: "coding",
      });
      expect(score.qualityScore).toBe(0.5);
      expect(score.source).toBe("catalogue");
    });
  });

  describe("composite scoring", () => {
    it("applies default weights (quality=0.5, cost=0.3, speed=0.15, contextFit=0.05)", () => {
      const entry = makeCatalogueEntry({ cost: { inputPerMTok: 3, outputPerMTok: 15 } });
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: entry,
      });

      // qualityScore = 0.9 (catalogue coding)
      // costScore = 1 - (15/80) = 0.8125
      // speedScore = 1 - (900/5000) = 0.82
      // contextFit = 1.0 (no context needed)
      const expectedComposite = 0.5 * 0.9 + 0.3 * 0.8125 + 0.15 * 0.82 + 0.05 * 1.0;
      expect(score.composite).toBeCloseTo(expectedComposite);
    });

    it("applies custom weights", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry(),
        weights: { quality: 1.0, cost: 0, speed: 0, contextFit: 0 },
      });
      // With 100% quality weight, composite = qualityScore
      expect(score.composite).toBeCloseTo(0.9);
    });

    it("penalises high-cost models on cost score", () => {
      const cheap = scoreModelSync({
        model: "cheap/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ cost: { inputPerMTok: 0.1, outputPerMTok: 0.4 } }),
      });
      const expensive = scoreModelSync({
        model: "expensive/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ cost: { inputPerMTok: 15, outputPerMTok: 75 } }),
      });
      expect(cheap.costScore).toBeGreaterThan(expensive.costScore);
    });

    it("penalises slow models on speed score", () => {
      const fast = scoreModelSync({
        model: "fast/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ latency: { ttft_ms: 300, tps: 200 } }),
      });
      const slow = scoreModelSync({
        model: "slow/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ latency: { ttft_ms: 3000, tps: 30 } }),
      });
      expect(fast.speedScore).toBeGreaterThan(slow.speedScore);
    });
  });

  describe("context fit", () => {
    it("returns 1.0 when no context needed", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ contextWindow: 200000 }),
      });
      expect(score.contextFit).toBe(1.0);
    });

    it("returns 1.0 when context window covers need", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ contextWindow: 200000 }),
        contextNeeded: 50000,
      });
      expect(score.contextFit).toBe(1.0);
    });

    it("penalises when context window is smaller than needed", () => {
      const score = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: makeCatalogueEntry({ contextWindow: 50000 }),
        contextNeeded: 200000,
      });
      expect(score.contextFit).toBeCloseTo(50000 / 200000);
    });
  });

  describe("task type scoring", () => {
    it("scores different task types using corresponding taskScores", () => {
      const entry = makeCatalogueEntry({
        taskScores: { coding: 0.95, chat: 0.6 },
      });

      const codingScore = scoreModelSync({
        model: "test/model",
        taskType: "coding",
        catalogueEntry: entry,
      });
      const chatScore = scoreModelSync({
        model: "test/model",
        taskType: "chat",
        catalogueEntry: entry,
      });

      expect(codingScore.qualityScore).toBeGreaterThan(chatScore.qualityScore);
    });

    it("falls back to 0 for missing task type in catalogue", () => {
      const entry = makeCatalogueEntry({
        taskScores: { coding: 0.95 },
      });

      const score = scoreModelSync({
        model: "test/model",
        taskType: "heartbeat",
        catalogueEntry: entry,
      });
      expect(score.qualityScore).toBe(0);
    });
  });
});
