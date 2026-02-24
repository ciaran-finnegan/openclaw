import { readRoutingEvents } from "../../task-routing/catalogue/observed.js";
import { renderTable } from "../../terminal/table.js";
import { formatUsd } from "../../utils/usage-format.js";

export type LogCommandOptions = {
  tail?: string;
  json?: boolean;
};

export async function routingLogCommand(opts: LogCommandOptions): Promise<void> {
  const tail = Math.max(1, Number(opts.tail) || 20);
  const events = await readRoutingEvents();

  if (events.length === 0) {
    console.log("No routing events recorded yet.");
    return;
  }

  const recent = events.slice(-tail);

  if (opts.json) {
    console.log(JSON.stringify(recent, null, 2));
    return;
  }

  console.log(`\nLast ${recent.length} routing event${recent.length === 1 ? "" : "s"}:\n`);

  const rows = recent.map((e) => ({
    time: formatTimestamp(e.timestamp),
    model: e.model,
    task: e.taskType,
    ok: e.success ? "yes" : "no",
    tokens: `${fmtNum(e.inputTokens)}/${fmtNum(e.outputTokens)}`,
    cost: formatUsd(e.actualCost) ?? "-",
    saved: formatUsd(e.savedCost) ?? "-",
    latency: `${e.latencyMs}ms`,
  }));

  const table = renderTable({
    columns: [
      { key: "time", header: "Time", minWidth: 8 },
      { key: "model", header: "Model", minWidth: 14, flex: true },
      { key: "task", header: "Task", minWidth: 8 },
      { key: "ok", header: "OK", minWidth: 3, align: "center" },
      { key: "tokens", header: "In/Out", minWidth: 9, align: "right" },
      { key: "cost", header: "Cost", minWidth: 8, align: "right" },
      { key: "saved", header: "Saved", minWidth: 8, align: "right" },
      { key: "latency", header: "Latency", minWidth: 8, align: "right" },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}

function formatTimestamp(iso: string): string {
  // Show local HH:MM:SS for today, or MM-DD HH:MM for older.
  // Uses Intl for consistent locale-independent formatting.
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) {
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mo}-${dd} ${hh}:${mm}`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}m`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}
