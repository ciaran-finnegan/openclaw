import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { isModelAllowed } from "./allowlist.js";

function makeConfig(providers?: Record<string, { models: Array<{ id: string }> }>): OpenClawConfig {
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

describe("isModelAllowed", () => {
  it("allows any model when no providers are configured", () => {
    const cfg = makeConfig();
    expect(isModelAllowed("anthropic/claude-opus-4-6", cfg)).toBe(true);
  });

  it("allows a model that exists in the provider config", () => {
    const cfg = makeConfig({
      anthropic: { models: [{ id: "claude-opus-4-6" }, { id: "claude-haiku-4-5" }] },
    });
    expect(isModelAllowed("anthropic/claude-opus-4-6", cfg)).toBe(true);
  });

  it("rejects a model that does not exist in the provider config", () => {
    const cfg = makeConfig({
      anthropic: { models: [{ id: "claude-haiku-4-5" }] },
    });
    expect(isModelAllowed("anthropic/claude-opus-4-6", cfg)).toBe(false);
  });

  it("allows a model when the provider is not in config (can't verify)", () => {
    const cfg = makeConfig({
      openai: { models: [{ id: "gpt-4o" }] },
    });
    // anthropic provider not in config — allow by default
    expect(isModelAllowed("anthropic/claude-opus-4-6", cfg)).toBe(true);
  });

  it("allows a model when the provider has no models list", () => {
    const cfg = makeConfig({
      ollama: { models: [] },
    });
    expect(isModelAllowed("ollama/llama3", cfg)).toBe(true);
  });

  it("allows a model without provider prefix (no slash)", () => {
    const cfg = makeConfig({
      anthropic: { models: [{ id: "claude-haiku-4-5" }] },
    });
    expect(isModelAllowed("claude-opus-4-6", cfg)).toBe(true);
  });

  it("handles multiple providers correctly", () => {
    const cfg = makeConfig({
      anthropic: { models: [{ id: "claude-haiku-4-5" }] },
      openai: { models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] },
    });
    expect(isModelAllowed("openai/gpt-4o", cfg)).toBe(true);
    expect(isModelAllowed("openai/gpt-5", cfg)).toBe(false);
    expect(isModelAllowed("anthropic/claude-haiku-4-5", cfg)).toBe(true);
    expect(isModelAllowed("anthropic/claude-opus-4-6", cfg)).toBe(false);
  });
});
