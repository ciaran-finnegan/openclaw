import { readRoutingEvents } from "../../task-routing/catalogue/observed.js";
import type { RoutingEvent } from "../../task-routing/catalogue/types.js";
import type { TaskType } from "../../task-routing/types.js";
import { renderTable } from "../../terminal/table.js";
import { formatUsd } from "../../utils/usage-format.js";

export type StatsCommandOptions = {
  json?: boolean;
  detailed?: boolean;
  days?: string;
};

type StatsSummary = {
  period: string;
  totalCost: number;
  totalSaved: number;
  requestCount: number;
  costByTaskType: Partial<Record<TaskType, number>>;
  costByModel: Record<string, number>;
  requestsByTaskType: Partial<Record<TaskType, number>>;
};

export async function routingStatsCommand(opts: StatsCommandOptions): Promise<void> {
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

  const summary = buildSummary(filtered, days);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printOverview(summary, days);
  if (opts.detailed) {
    printTaskTypeBreakdown(summary);
    printModelBreakdown(summary);
  }
}

function buildSummary(events: RoutingEvent[], days: number): StatsSummary {
  let totalCost = 0;
  let totalSaved = 0;
  const costByTaskType: Partial<Record<TaskType, number>> = {};
  const costByModel: Record<string, number> = {};
  const requestsByTaskType: Partial<Record<TaskType, number>> = {};

  for (const e of events) {
    const cost = e.actualCost ?? 0;
    totalCost += cost;
    totalSaved += e.savedCost ?? 0;
    costByTaskType[e.taskType] = (costByTaskType[e.taskType] ?? 0) + cost;
    costByModel[e.model] = (costByModel[e.model] ?? 0) + cost;
    requestsByTaskType[e.taskType] = (requestsByTaskType[e.taskType] ?? 0) + 1;
  }

  return {
    period: `${days}d`,
    totalCost,
    totalSaved,
    requestCount: events.length,
    costByTaskType,
    costByModel,
    requestsByTaskType,
  };
}

function printOverview(summary: StatsSummary, days: number): void {
  console.log(`\nRouting stats (last ${days} day${days === 1 ? "" : "s"}):\n`);

  const rows = [
    { metric: "Requests", value: String(summary.requestCount) },
    { metric: "Total cost", value: formatUsd(summary.totalCost) ?? "$0.00" },
    { metric: "Estimated savings", value: formatUsd(summary.totalSaved) ?? "$0.00" },
    {
      metric: "Avg cost/request",
      value:
        summary.requestCount > 0
          ? (formatUsd(summary.totalCost / summary.requestCount) ?? "$0.00")
          : "$0.00",
    },
  ];

  const table = renderTable({
    columns: [
      { key: "metric", header: "Metric", minWidth: 20, flex: true },
      { key: "value", header: "Value", minWidth: 12, align: "right" },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}

function printTaskTypeBreakdown(summary: StatsSummary): void {
  const entries = Object.entries(summary.costByTaskType) as [TaskType, number][];
  if (entries.length === 0) {
    return;
  }

  console.log("\nCost by task type:\n");

  const rows = entries
    .toSorted(([, a], [, b]) => b - a)
    .map(([taskType, cost]) => ({
      task_type: taskType,
      requests: String(summary.requestsByTaskType[taskType] ?? 0),
      cost: formatUsd(cost) ?? "$0.00",
      share: summary.totalCost > 0 ? `${((cost / summary.totalCost) * 100).toFixed(1)}%` : "0%",
    }));

  const table = renderTable({
    columns: [
      { key: "task_type", header: "Task Type", minWidth: 12, flex: true },
      { key: "requests", header: "Requests", minWidth: 8, align: "right" },
      { key: "cost", header: "Cost", minWidth: 10, align: "right" },
      { key: "share", header: "Share", minWidth: 7, align: "right" },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}

function printModelBreakdown(summary: StatsSummary): void {
  const entries = Object.entries(summary.costByModel);
  if (entries.length === 0) {
    return;
  }

  console.log("\nCost by model:\n");

  const rows = entries
    .toSorted(([, a], [, b]) => b - a)
    .map(([model, cost]) => ({
      model,
      cost: formatUsd(cost) ?? "$0.00",
      share: summary.totalCost > 0 ? `${((cost / summary.totalCost) * 100).toFixed(1)}%` : "0%",
    }));

  const table = renderTable({
    columns: [
      { key: "model", header: "Model", minWidth: 20, flex: true },
      { key: "cost", header: "Cost", minWidth: 10, align: "right" },
      { key: "share", header: "Share", minWidth: 7, align: "right" },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}
