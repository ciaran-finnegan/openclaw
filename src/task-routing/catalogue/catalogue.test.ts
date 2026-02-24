import { describe, it, expect } from "vitest";
import {
  loadBenchmarkCatalogue,
  getCatalogueEntry,
  filterByProvider,
  listCatalogueModels,
} from "./catalogue.js";

describe("loadBenchmarkCatalogue", () => {
  it("loads the shipped catalogue", () => {
    const catalogue = loadBenchmarkCatalogue();
    expect(catalogue.catalogueVersion).toBe("1.0.0");
    expect(catalogue.lastUpdated).toBeTruthy();
    expect(Object.keys(catalogue.models).length).toBeGreaterThan(0);
  });

  it("returns the same instance on subsequent calls (cached)", () => {
    const a = loadBenchmarkCatalogue();
    const b = loadBenchmarkCatalogue();
    expect(a).toBe(b);
  });

  it("has valid entries with required fields", () => {
    const catalogue = loadBenchmarkCatalogue();
    for (const [_key, entry] of Object.entries(catalogue.models)) {
      expect(entry.displayName).toBeTruthy();
      expect(["cheap", "mid", "frontier"]).toContain(entry.suggestedTier);
      expect(entry.cost.inputPerMTok).toBeGreaterThanOrEqual(0);
      expect(entry.cost.outputPerMTok).toBeGreaterThanOrEqual(0);
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(typeof entry.toolSupport).toBe("boolean");
      expect(typeof entry.reasoning).toBe("boolean");
      expect(entry.latency.ttft_ms).toBeGreaterThan(0);
      expect(entry.latency.tps).toBeGreaterThan(0);
    }
  });
});

describe("getCatalogueEntry", () => {
  it("finds an entry by exact key", () => {
    const entry = getCatalogueEntry("anthropic/claude-opus-4-6");
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("Claude Opus 4.6");
  });

  it("returns undefined for an unknown model", () => {
    const entry = getCatalogueEntry("unknown/nonexistent-model");
    expect(entry).toBeUndefined();
  });

  it("finds by model suffix (without provider)", () => {
    const entry = getCatalogueEntry("claude-opus-4-6");
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("Claude Opus 4.6");
  });

  it("strips version tags when looking up models", () => {
    const entry = getCatalogueEntry("anthropic/claude-opus-4-6-20260101");
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("Claude Opus 4.6");
  });

  it("strips :latest suffix", () => {
    const entry = getCatalogueEntry("anthropic/claude-opus-4-6:latest");
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("Claude Opus 4.6");
  });
});

describe("filterByProvider", () => {
  it("filters models by provider prefix", () => {
    const anthropic = filterByProvider("anthropic");
    expect(Object.keys(anthropic).length).toBeGreaterThanOrEqual(3);
    for (const key of Object.keys(anthropic)) {
      expect(key.startsWith("anthropic/")).toBe(true);
    }
  });

  it("returns empty object for unknown provider", () => {
    const result = filterByProvider("nonexistent");
    expect(Object.keys(result).length).toBe(0);
  });

  it("is case-insensitive", () => {
    const upper = filterByProvider("Anthropic");
    const lower = filterByProvider("anthropic");
    expect(Object.keys(upper).length).toBe(Object.keys(lower).length);
  });
});

describe("listCatalogueModels", () => {
  it("returns all model keys", () => {
    const models = listCatalogueModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("anthropic/claude-opus-4-6");
    expect(models).toContain("openai/gpt-5");
  });
});
