import { loadConfig } from "../../config/config.js";
import { writeConfigFile } from "../../config/io.js";
import { isModelAllowed } from "../../task-routing/allowlist.js";
import { getCatalogueEntry } from "../../task-routing/catalogue/catalogue.js";
import { TIER_PRIORITY } from "../../task-routing/resolve-task-route.js";

export async function routingSetCommand(tier: string, model: string): Promise<void> {
  // Validate tier name.
  if (!TIER_PRIORITY.includes(tier)) {
    console.error(`Unknown tier "${tier}". Valid tiers: ${TIER_PRIORITY.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // Validate model exists in catalogue or provider config.
  const cfg = loadConfig();
  const catalogueEntry = getCatalogueEntry(model);
  const allowedByProvider = isModelAllowed(model, cfg);

  if (!catalogueEntry && !allowedByProvider) {
    console.error(
      `Model "${model}" not found in the benchmark catalogue and not in your provider config.`,
    );
    console.error("Use the full provider/model format, e.g. google/gemini-2.5-flash.");
    process.exitCode = 1;
    return;
  }

  // Update config.
  const updatedCfg = structuredClone(cfg);
  if (!updatedCfg.agents) {
    updatedCfg.agents = {};
  }
  if (!updatedCfg.agents.defaults) {
    updatedCfg.agents.defaults = {};
  }
  if (!updatedCfg.agents.defaults.routing) {
    updatedCfg.agents.defaults.routing = {};
  }
  if (!updatedCfg.agents.defaults.routing.tiers) {
    updatedCfg.agents.defaults.routing.tiers = {};
  }

  updatedCfg.agents.defaults.routing.tiers[tier] = { model };

  await writeConfigFile(updatedCfg);

  const displayName = catalogueEntry?.displayName ?? model;
  console.log(`Set ${tier} tier to ${displayName} (${model}).`);

  if (!updatedCfg.agents.defaults.routing.enabled) {
    console.log(
      "\nNote: routing is not yet enabled. Set `routing.enabled: true` or run `openclaw routing setup`.",
    );
  }
}
