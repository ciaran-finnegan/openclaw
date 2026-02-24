import { loadConfig } from "../../config/config.js";
import { getCatalogueEntry, listCatalogueModels } from "../../task-routing/catalogue/catalogue.js";
import { scoreModelSync } from "../../task-routing/catalogue/scorer.js";
import type { ModelScore } from "../../task-routing/catalogue/types.js";
import type { TaskType } from "../../task-routing/types.js";
import { renderTable } from "../../terminal/table.js";

export type SuggestTiersCommandOptions = {
  json?: boolean;
};

type TierSuggestion = {
  tier: "cheap" | "mid" | "frontier";
  model: string;
  avgScore: number;
  reasoning: string;
};

const TASK_TYPES: TaskType[] = ["coding", "planning", "writing", "chat", "status", "tool_use"];

export async function routingSuggestTiersCommand(opts: SuggestTiersCommandOptions): Promise<void> {
  const cfg = loadConfig();
  const allModels = listCatalogueModels();

  // Score every catalogue model across all task types
  const modelAggregates: {
    model: string;
    scores: ModelScore[];
    avgComposite: number;
    suggestedTier: string;
  }[] = [];

  for (const model of allModels) {
    const entry = getCatalogueEntry(model);
    if (!entry) {
      continue;
    }

    const scores: ModelScore[] = [];
    for (const taskType of TASK_TYPES) {
      scores.push(
        scoreModelSync({
          model,
          taskType,
          catalogueEntry: entry,
          weights: cfg.agents?.defaults?.routing?.scorer?.weights,
        }),
      );
    }

    const avgComposite = scores.reduce((sum, s) => sum + s.composite, 0) / scores.length;
    modelAggregates.push({ model, scores, avgComposite, suggestedTier: entry.suggestedTier });
  }

  // Find best model per tier
  const tiers: Array<"cheap" | "mid" | "frontier"> = ["cheap", "mid", "frontier"];
  const suggestions: TierSuggestion[] = [];

  for (const tier of tiers) {
    const candidates = modelAggregates.filter((m) => m.suggestedTier === tier);
    if (candidates.length === 0) {
      continue;
    }

    const sorted = candidates.toSorted((a, b) => b.avgComposite - a.avgComposite);
    const best = sorted[0];

    suggestions.push({
      tier,
      model: best.model,
      avgScore: best.avgComposite,
      reasoning: `Best ${tier}-tier model by composite score (${(best.avgComposite * 100).toFixed(0)}%) across ${TASK_TYPES.length} task types.`,
    });
  }

  if (opts.json) {
    console.log(JSON.stringify(suggestions, null, 2));
    return;
  }

  console.log("Suggested tier assignments based on catalogue data:\n");

  const rows = suggestions.map((s) => ({
    tier: s.tier,
    model: s.model,
    score: `${(s.avgScore * 100).toFixed(0)}%`,
    reasoning: s.reasoning,
  }));

  const table = renderTable({
    columns: [
      { key: "tier", header: "Tier", minWidth: 10 },
      { key: "model", header: "Model", minWidth: 28, flex: true },
      { key: "score", header: "Score", minWidth: 6, align: "right" },
    ],
    rows,
    border: "unicode",
  });

  console.log(table);

  // Show current config comparison
  const currentTiers = cfg.agents?.defaults?.routing?.tiers;
  if (currentTiers && Object.keys(currentTiers).length > 0) {
    console.log("\nCurrent tier configuration:");
    for (const [name, config] of Object.entries(currentTiers)) {
      console.log(`  ${name}: ${config.model}`);
    }
  } else {
    console.log(
      "\nNo tier configuration found. Add routing tiers to your config to enable task-aware routing.",
    );
  }
}
