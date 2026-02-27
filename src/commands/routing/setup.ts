import { confirm, intro, isCancel, outro, select } from "@clack/prompts";
import { loadConfig } from "../../config/config.js";
import { writeConfigFile } from "../../config/io.js";
import { autoDetectTiers } from "../../task-routing/auto-detect-tiers.js";
import { getCatalogueEntry, listCatalogueModels } from "../../task-routing/catalogue/catalogue.js";
import { TIER_PRIORITY } from "../../task-routing/resolve-task-route.js";
import type { TaskRoutingTierConfig } from "../../task-routing/types.js";

export async function routingSetupCommand(): Promise<void> {
  intro("Routing setup");

  const cfg = loadConfig();

  // Detect configured providers.
  const providers = cfg.models?.providers;
  if (!providers || Object.keys(providers).length === 0) {
    console.log(
      "No model providers configured. Add providers to your config first, then run this again.",
    );
    return;
  }

  console.log(`Detected providers: ${Object.keys(providers).join(", ")}`);

  // Auto-detect tier suggestions.
  const detected = autoDetectTiers(cfg);
  if (Object.keys(detected).length === 0) {
    console.log(
      "Could not auto-detect tier mappings from your provider config and the model catalogue.",
    );
    console.log("Use `openclaw routing set <tier> <model>` to manually configure tiers.");
    return;
  }

  console.log("\nSuggested tier mappings:");
  for (const tier of TIER_PRIORITY) {
    const entry = detected[tier];
    if (entry) {
      const display = getCatalogueEntry(entry.model)?.displayName ?? entry.model;
      console.log(`  ${tier}: ${display} (${entry.model})`);
    }
  }

  // Ask to confirm or customize each tier.
  const finalTiers: Record<string, TaskRoutingTierConfig> = {};

  for (const tier of TIER_PRIORITY) {
    const suggested = detected[tier];
    if (!suggested) {
      continue;
    }

    const action = await select({
      message: `${tier} tier → ${suggested.model}`,
      options: [
        { value: "accept", label: "Accept suggestion" },
        { value: "change", label: "Choose a different model" },
        { value: "skip", label: "Skip this tier" },
      ],
    });

    if (isCancel(action)) {
      console.log("Setup cancelled.");
      return;
    }

    if (action === "accept") {
      finalTiers[tier] = { model: suggested.model };
    } else if (action === "change") {
      const model = await selectModelForTier(tier);
      if (model) {
        finalTiers[tier] = { model };
      }
    }
    // "skip" → don't add to finalTiers
  }

  if (Object.keys(finalTiers).length === 0) {
    console.log("No tiers configured. Routing will remain disabled.");
    return;
  }

  // Confirm and write.
  const shouldEnable = await confirm({
    message: "Enable routing with these settings?",
  });

  if (isCancel(shouldEnable) || !shouldEnable) {
    console.log("Setup cancelled.");
    return;
  }

  const updatedCfg = structuredClone(cfg);
  if (!updatedCfg.agents) {
    updatedCfg.agents = {};
  }
  if (!updatedCfg.agents.defaults) {
    updatedCfg.agents.defaults = {};
  }
  updatedCfg.agents.defaults.routing = {
    ...updatedCfg.agents.defaults.routing,
    enabled: true,
    tiers: finalTiers,
  };

  await writeConfigFile(updatedCfg);

  outro(
    "Routing enabled! Use `openclaw routing tiers` to verify, or `openclaw routing set` to adjust.",
  );
}

/** Prompt user to select a model from catalogue entries matching the tier. */
async function selectModelForTier(tier: string): Promise<string | undefined> {
  const allModels = listCatalogueModels();
  const candidates = allModels
    .map((m) => ({ key: m, entry: getCatalogueEntry(m) }))
    .filter((c) => c.entry?.suggestedTier === tier)
    .map((c) => ({
      value: c.key,
      label: `${c.entry!.displayName} (${c.key})`,
    }));

  if (candidates.length === 0) {
    console.log(`No catalogue models found for ${tier} tier.`);
    return undefined;
  }

  const choice = await select({
    message: `Select model for ${tier} tier:`,
    options: candidates,
  });

  if (isCancel(choice)) {
    return undefined;
  }

  return choice;
}
