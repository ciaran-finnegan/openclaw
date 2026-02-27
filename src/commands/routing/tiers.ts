import { loadConfig } from "../../config/config.js";
import { autoDetectTiers } from "../../task-routing/auto-detect-tiers.js";
import { TIER_PRIORITY } from "../../task-routing/resolve-task-route.js";
import { renderTable } from "../../terminal/table.js";

export type TiersCommandOptions = {
  json?: boolean;
};

export async function routingTiersCommand(opts: TiersCommandOptions): Promise<void> {
  const cfg = loadConfig();
  const routingConfig = cfg.agents?.defaults?.routing;
  const configuredTiers = routingConfig?.tiers;

  const hasTiers = configuredTiers && Object.keys(configuredTiers).length > 0;

  if (!hasTiers) {
    // Auto-detect suggestions
    const detected = autoDetectTiers(cfg);
    if (Object.keys(detected).length === 0) {
      console.log("No tier configuration found and no models could be auto-detected.");
      console.log(
        "Configure providers with models, or run `openclaw routing setup` to get started.",
      );
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify({ source: "auto-detected", tiers: detected }, null, 2));
      return;
    }

    console.log("No tier configuration found. Auto-detected suggestions:\n");
    printTierTable(detected);
    console.log(
      "\nRun `openclaw routing setup` to apply these, or `openclaw routing set <tier> <model>` to customize.",
    );
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ source: "config", tiers: configuredTiers }, null, 2));
    return;
  }

  console.log("Current tier configuration:\n");
  printTierTable(configuredTiers);

  if (!routingConfig?.enabled) {
    console.log(
      "\nRouting is not enabled. Set `routing.enabled: true` in your config to activate.",
    );
  }
}

function printTierTable(tiers: Record<string, { model: string; maxComplexity?: number }>): void {
  // Sort by TIER_PRIORITY order (frontier first, then mid, then cheap).
  const sortedEntries = Object.entries(tiers).toSorted(([a], [b]) => {
    const ia = TIER_PRIORITY.indexOf(a);
    const ib = TIER_PRIORITY.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const rows = sortedEntries.map(([name, config]) => ({
    tier: name,
    model: config.model,
    maxComplexity: config.maxComplexity !== undefined ? String(config.maxComplexity) : "-",
  }));

  const table = renderTable({
    columns: [
      { key: "tier", header: "Tier", minWidth: 10 },
      { key: "model", header: "Model", minWidth: 28, flex: true },
      { key: "maxComplexity", header: "Max Complexity", minWidth: 14, align: "right" },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}
