import {
  filterByProvider,
  loadBenchmarkCatalogue,
} from "../../task-routing/catalogue/catalogue.js";
import type { CatalogueModelEntry } from "../../task-routing/catalogue/types.js";
import { renderTable } from "../../terminal/table.js";

export type CatalogueCommandOptions = {
  provider?: string;
  json?: boolean;
};

export async function routingCatalogueCommand(opts: CatalogueCommandOptions): Promise<void> {
  let models: Record<string, CatalogueModelEntry>;

  if (opts.provider) {
    models = filterByProvider(opts.provider);
    if (Object.keys(models).length === 0) {
      console.log(`No models found for provider "${opts.provider}".`);
      return;
    }
  } else {
    models = loadBenchmarkCatalogue().models;
  }

  if (opts.json) {
    console.log(JSON.stringify(models, null, 2));
    return;
  }

  const rows = Object.entries(models).map(([_key, entry]) => ({
    model: entry.displayName,
    tier: entry.suggestedTier,
    coding: fmtScore(entry.taskScores.coding),
    planning: fmtScore(entry.taskScores.planning),
    writing: fmtScore(entry.taskScores.writing),
    chat: fmtScore(entry.taskScores.chat),
    tool_use: fmtScore(entry.taskScores.tool_use),
    cost_in: `$${entry.cost.inputPerMTok}`,
    cost_out: `$${entry.cost.outputPerMTok}`,
    context: fmtContext(entry.contextWindow),
  }));

  const table = renderTable({
    columns: [
      { key: "model", header: "Model", minWidth: 18, flex: true },
      { key: "tier", header: "Tier", minWidth: 8 },
      { key: "coding", header: "Code", minWidth: 5, align: "right" },
      { key: "planning", header: "Plan", minWidth: 5, align: "right" },
      { key: "writing", header: "Write", minWidth: 5, align: "right" },
      { key: "chat", header: "Chat", minWidth: 5, align: "right" },
      { key: "tool_use", header: "Tools", minWidth: 5, align: "right" },
      { key: "cost_in", header: "$/MTok In", minWidth: 9, align: "right" },
      { key: "cost_out", header: "$/MTok Out", minWidth: 10, align: "right" },
      { key: "context", header: "Context", minWidth: 7, align: "right" },
    ],
    rows,
    border: "unicode",
  });

  console.log(table);
}

function fmtScore(score: number | undefined): string {
  if (score === undefined) {
    return "-";
  }
  return (score * 100).toFixed(0);
}

function fmtContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(0)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}k`;
  }
  return `${tokens}`;
}
