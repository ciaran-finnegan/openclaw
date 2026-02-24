import { createRequire } from "node:module";
import type { BenchmarkCatalogue, CatalogueModelEntry } from "./types.js";

// createRequire is needed because ESM doesn't support JSON imports with import assertions
// in all Node/Bun versions. Using require() gives us synchronous, cached JSON loading.
const require = createRequire(import.meta.url);

let cached: BenchmarkCatalogue | undefined;

/** Load the shipped benchmark catalogue (cached after first call). */
export function loadBenchmarkCatalogue(): BenchmarkCatalogue {
  if (cached) {
    return cached;
  }
  cached = require("./benchmark-catalogue.json") as BenchmarkCatalogue;
  return cached;
}

/** Clear the cached catalogue. Exported for test isolation only. */
export function _resetCatalogueCache(): void {
  cached = undefined;
}

/**
 * Look up a model in the catalogue.
 *
 * Tries exact key first (`provider/model`), then strips version suffixes
 * and date tags to find the base model family.
 */
export function getCatalogueEntry(model: string): CatalogueModelEntry | undefined {
  const catalogue = loadBenchmarkCatalogue();

  // Exact match
  if (catalogue.models[model]) {
    return catalogue.models[model];
  }

  // Try normalising: strip trailing date/version tags (e.g. "-20260101", ":latest")
  const normalised = model.replace(/[:-]\d{6,}$/, "").replace(/:latest$/, "");
  if (catalogue.models[normalised]) {
    return catalogue.models[normalised];
  }

  // Fuzzy: match by model id suffix (e.g. "claude-opus-4-6" matches "anthropic/claude-opus-4-6")
  const suffix = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  for (const [key, entry] of Object.entries(catalogue.models)) {
    if (key.endsWith(`/${suffix}`)) {
      return entry;
    }
  }

  return undefined;
}

/** Filter catalogue entries by provider prefix. */
export function filterByProvider(provider: string): Record<string, CatalogueModelEntry> {
  const catalogue = loadBenchmarkCatalogue();
  const prefix = provider.toLowerCase();
  const result: Record<string, CatalogueModelEntry> = {};
  for (const [key, entry] of Object.entries(catalogue.models)) {
    if (key.toLowerCase().startsWith(`${prefix}/`)) {
      result[key] = entry;
    }
  }
  return result;
}

/** List all model keys in the catalogue. */
export function listCatalogueModels(): string[] {
  return Object.keys(loadBenchmarkCatalogue().models);
}
