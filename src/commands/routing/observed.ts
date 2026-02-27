import { readRoutingEvents } from "../../task-routing/catalogue/observed.js";
import type { RoutingEvent } from "../../task-routing/catalogue/types.js";
import type { TaskType } from "../../task-routing/types.js";
import { renderTable } from "../../terminal/table.js";

export type ObservedCommandOptions = {
  json?: boolean;
  days?: string;
};

type ObservedEntry = {
  model: string;
  taskType: TaskType;
  requests: number;
  successRate: number;
  retryRate: number;
  escalationRate: number;
  avgLatencyMs: number;
};

export async function routingObservedCommand(opts: ObservedCommandOptions): Promise<void> {
  const days = Math.max(1, Number(opts.days) || 30);
  const events = await readRoutingEvents();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();

  const filtered = events.filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  if (filtered.length === 0) {
    console.log(`No routing events in the last ${days} day(s).`);
    return;
  }

  const entries = aggregateAll(filtered);

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(
    `\nObserved model performance (last ${days} day${days === 1 ? "" : "s"}, ${filtered.length} events):\n`,
  );

  const rows = entries.map((e) => ({
    model: e.model,
    task: e.taskType,
    requests: String(e.requests),
    success: `${(e.successRate * 100).toFixed(1)}%`,
    retry: `${(e.retryRate * 100).toFixed(1)}%`,
    escalation: `${(e.escalationRate * 100).toFixed(1)}%`,
    latency: `${Math.round(e.avgLatencyMs)}ms`,
  }));

  const table = renderTable({
    columns: [
      { key: "model", header: "Model", minWidth: 20, flex: true },
      { key: "task", header: "Task", minWidth: 10 },
      { key: "requests", header: "Reqs", minWidth: 6, align: "right" },
      { key: "success", header: "Success", minWidth: 8, align: "right" },
      { key: "retry", header: "Retry", minWidth: 7, align: "right" },
      { key: "escalation", header: "Escalation", minWidth: 10, align: "right" },
      { key: "latency", header: "Avg Latency", minWidth: 10, align: "right" },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}

/** Aggregate routing events into per-model per-task entries. */
function aggregateAll(events: RoutingEvent[]): ObservedEntry[] {
  const byKey = new Map<string, RoutingEvent[]>();

  for (const e of events) {
    const key = `${e.model}:${e.taskType}`;
    let group = byKey.get(key);
    if (!group) {
      group = [];
      byKey.set(key, group);
    }
    group.push(e);
  }

  const entries: ObservedEntry[] = [];
  for (const [, group] of byKey) {
    const n = group.length;
    const first = group[0];
    entries.push({
      model: first.model,
      taskType: first.taskType,
      requests: n,
      successRate: group.filter((e) => e.success).length / n,
      retryRate: group.filter((e) => e.retried).length / n,
      escalationRate: group.filter((e) => e.escalated).length / n,
      avgLatencyMs: group.reduce((sum, e) => sum + e.latencyMs, 0) / n,
    });
  }

  // Sort by request count descending.
  return entries.toSorted((a, b) => b.requests - a.requests);
}
