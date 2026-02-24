import fsp from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { TaskType } from "../types.js";
import type { ObservedPerformance, RoutingEvent } from "./types.js";

const ROUTING_DIR = "routing";
const OBSERVED_FILENAME = "observed.jsonl";

/**
 * Maximum number of events to retain when reading the log.
 * Keeps only the most recent events to bound memory usage; older events
 * are still on disk but ignored during aggregation.
 */
const MAX_EVENTS = 10_000;

/** Resolve path to the observed performance JSONL log. */
export function resolveObservedPath(stateDir?: string): string {
  const base = stateDir ?? resolveStateDir();
  return path.join(base, ROUTING_DIR, OBSERVED_FILENAME);
}

/** Append a single routing event to the JSONL log (fire-and-forget). */
export async function appendRoutingEvent(event: RoutingEvent, stateDir?: string): Promise<void> {
  const filePath = resolveObservedPath(stateDir);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

/**
 * Read routing events from the JSONL log.
 * Returns at most the last {@link MAX_EVENTS} events to bound memory usage.
 */
export async function readRoutingEvents(stateDir?: string): Promise<RoutingEvent[]> {
  const filePath = resolveObservedPath(stateDir);

  let content: string;
  try {
    content = await fsp.readFile(filePath, "utf8");
  } catch {
    // File doesn't exist or is unreadable — treat as empty
    return [];
  }

  const lines = content.split("\n");
  const events: RoutingEvent[] = [];

  // Parse from the end so we can cap at MAX_EVENTS most-recent entries
  for (let i = lines.length - 1; i >= 0 && events.length < MAX_EVENTS; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as RoutingEvent);
    } catch {
      // Skip malformed lines
    }
  }

  // Reverse so events are in chronological order
  events.reverse();
  return events;
}

/**
 * Aggregate routing events into observed performance for a model+task pair.
 *
 * Returns undefined if no events match the given model and task type.
 */
export async function aggregateObserved(
  model: string,
  taskType: TaskType,
  stateDir?: string,
): Promise<ObservedPerformance | undefined> {
  const events = await readRoutingEvents(stateDir);
  const matching = events.filter((e) => e.model === model && e.taskType === taskType);

  if (matching.length === 0) {
    return undefined;
  }

  const n = matching.length;
  const successes = matching.filter((e) => e.success).length;
  const retries = matching.filter((e) => e.retried).length;
  const escalations = matching.filter((e) => e.escalated).length;
  const totalLatency = matching.reduce((sum, e) => sum + e.latencyMs, 0);
  const totalInput = matching.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutput = matching.reduce((sum, e) => sum + e.outputTokens, 0);

  const successRate = successes / n;
  const retryRate = retries / n;
  const escalationRate = escalations / n;

  // Effective score: success rate penalised by escalations
  const effectiveScore = successRate * (1 - escalationRate * 0.5);

  // Derive period from timestamps
  const timestamps = matching.map((e) => e.timestamp).toSorted();
  const period = `${timestamps[0].slice(0, 10)}/${timestamps[timestamps.length - 1].slice(0, 10)}`;

  return {
    model,
    taskType,
    period,
    requests: n,
    successRate,
    retryRate,
    escalationRate,
    avgLatencyMs: totalLatency / n,
    avgInputTokens: totalInput / n,
    avgOutputTokens: totalOutput / n,
    userOverrideRate: 0, // Tracked separately in future
    effectiveScore,
  };
}
