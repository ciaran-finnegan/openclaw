import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { runCommandWithRuntime } from "./cli-utils.js";

function runRoutingCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerRoutingCli(program: Command) {
  const routing = program.command("routing").description("Manage task routing and model selection");

  routing
    .command("update-catalogue")
    .description("Validate and display shipped benchmark catalogue info")
    .option("--check", "Check if a newer catalogue version is available", false)
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingUpdateCatalogueCommand } =
          await import("../commands/routing/update-catalogue.js");
        await routingUpdateCatalogueCommand(opts);
      });
    });

  routing
    .command("catalogue")
    .description("Display model catalogue with benchmark scores")
    .option("--provider <name>", "Filter by provider (e.g. anthropic, openai, google)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingCatalogueCommand } = await import("../commands/routing/catalogue.js");
        await routingCatalogueCommand(opts);
      });
    });

  routing
    .command("profile <model>")
    .description("Run benchmark prompts against a model and save a performance profile")
    .option("--rerun", "Re-profile even if a cached profile exists", false)
    .option("--judge <model>", "Frontier model to use as LLM-as-judge scorer")
    .action(async (model: string, opts) => {
      await runRoutingCommand(async () => {
        const { routingProfileCommand } = await import("../commands/routing/profile.js");
        await routingProfileCommand(model, opts);
      });
    });

  routing
    .command("suggest-tiers")
    .description("Suggest optimal tier→model mappings based on scores")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingSuggestTiersCommand } = await import("../commands/routing/suggest-tiers.js");
        await routingSuggestTiersCommand(opts);
      });
    });

  routing
    .command("stats")
    .description("Show routing cost summary and savings")
    .option("--json", "Output JSON", false)
    .option("--detailed", "Show per-task-type and per-model breakdown", false)
    .option("--days <n>", "Lookback period in days (default: 30)")
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingStatsCommand } = await import("../commands/routing/stats.js");
        await routingStatsCommand(opts);
      });
    });

  routing
    .command("log")
    .description("Show recent routing decisions")
    .option("--tail <n>", "Number of recent events to show (default: 20)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingLogCommand } = await import("../commands/routing/log.js");
        await routingLogCommand(opts);
      });
    });

  routing
    .command("feedback")
    .description("Show recent routing feedback events (overrides, retries, escalations)")
    .option("--tail <n>", "Number of recent events to show (default: 20)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingFeedbackCommand } = await import("../commands/routing/feedback.js");
        await routingFeedbackCommand(opts);
      });
    });

  routing
    .command("setup")
    .description("Interactive wizard to configure routing tiers")
    .action(async () => {
      await runRoutingCommand(async () => {
        const { routingSetupCommand } = await import("../commands/routing/setup.js");
        await routingSetupCommand();
      });
    });

  routing
    .command("tiers")
    .description("Display current tier-to-model mappings")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingTiersCommand } = await import("../commands/routing/tiers.js");
        await routingTiersCommand(opts);
      });
    });

  routing
    .command("set <tier> <model>")
    .description(
      "Set the model for a routing tier (e.g. openclaw routing set cheap google/gemini-2.5-flash)",
    )
    .action(async (tier: string, model: string) => {
      await runRoutingCommand(async () => {
        const { routingSetCommand } = await import("../commands/routing/set.js");
        await routingSetCommand(tier, model);
      });
    });

  routing
    .command("observed")
    .description("Show observed per-model per-task performance metrics")
    .option("--json", "Output JSON", false)
    .option("--days <n>", "Lookback period in days (default: 30)")
    .action(async (opts) => {
      await runRoutingCommand(async () => {
        const { routingObservedCommand } = await import("../commands/routing/observed.js");
        await routingObservedCommand(opts);
      });
    });
}
