import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { autoDetectTiers } from "./auto-detect-tiers.js";

// Build a minimal config with provider models matching catalogue entries.
function buildCfg(providerModels: Record<string, string[]>): OpenClawConfig {
  const providers: Record<
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
  for (const [provider, models] of Object.entries(providerModels)) {
    providers[provider] = {
      baseUrl: `https://${provider}.example.com`,
      models: models.map((id) => ({
        id,
        name: id,
        reasoning: false,
        input: ["text"] as Array<"text">,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      })),
    };
  }
  return { models: { providers } } as OpenClawConfig;
}

describe("autoDetectTiers", () => {
  it("returns empty record when no providers configured", () => {
    const result = autoDetectTiers({} as OpenClawConfig);
    expect(result).toEqual({});
  });

  it("returns empty record when provider has no models list", () => {
    const cfg = {
      models: {
        providers: {
          ollama: { baseUrl: "http://localhost:11434", models: [] },
        },
      },
    } as OpenClawConfig;
    const result = autoDetectTiers(cfg);
    expect(result).toEqual({});
  });

  it("detects tiers from Anthropic models in catalogue", () => {
    const cfg = buildCfg({
      anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-6"],
    });
    const result = autoDetectTiers(cfg);

    // Should have at least one tier populated
    expect(Object.keys(result).length).toBeGreaterThan(0);

    // Each tier should have a model string containing the provider prefix
    for (const tier of Object.values(result)) {
      expect(tier.model).toMatch(/^anthropic\//);
    }
  });

  it("only includes models the user has configured", () => {
    // Only configure cheap-tier model
    const cfg = buildCfg({
      anthropic: ["claude-haiku-4-5"],
    });
    const result = autoDetectTiers(cfg);

    // Should only have the tier matching haiku's suggestedTier (cheap)
    if (Object.keys(result).length > 0) {
      const models = Object.values(result).map((t) => t.model);
      for (const m of models) {
        expect(m).toContain("haiku");
      }
    }
  });
});
