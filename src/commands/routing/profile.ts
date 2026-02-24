import { loadConfig } from "../../config/config.js";
import { loadProfile, profileModel } from "../../task-routing/catalogue/profiler.js";

export type ProfileCommandOptions = {
  rerun?: boolean;
  judge?: string;
};

export async function routingProfileCommand(
  model: string,
  opts: ProfileCommandOptions,
): Promise<void> {
  const cfg = loadConfig();

  // Check for cached profile unless --rerun
  if (!opts.rerun) {
    const existing = await loadProfile(model);
    if (existing) {
      console.log(`Cached profile found (profiled at ${existing.profiledAt}).`);
      console.log("Use --rerun to re-profile.");
      console.log();
      printProfileSummary(existing);
      return;
    }
  }

  console.log(`Profiling ${model}...`);
  console.log();

  const { profile, path } = await profileModel({
    model,
    cfg,
    judgeModel: opts.judge,
    onProgress: (p) => {
      process.stdout.write(`\r  [${p.current}/${p.total}] ${p.taskType}: ${p.promptId}`);
    },
  });

  // Clear progress line
  process.stdout.write("\r" + " ".repeat(60) + "\r");
  console.log(`Profile saved to ${path}`);
  console.log();
  printProfileSummary(profile);
}

function printProfileSummary(
  profile: import("../../task-routing/catalogue/types.js").ModelProfile,
): void {
  console.log(`Model: ${profile.model}`);
  console.log(`Profiled: ${profile.profiledAt}`);
  console.log(`Latency: TTFT=${profile.latency.ttft_ms}ms, TPS=${profile.latency.tps}`);
  console.log();
  console.log("Task Scores:");
  for (const [task, score] of Object.entries(profile.taskScores)) {
    if (score !== undefined) {
      console.log(`  ${task.padEnd(12)} ${(score * 100).toFixed(0)}%`);
    }
  }
}
