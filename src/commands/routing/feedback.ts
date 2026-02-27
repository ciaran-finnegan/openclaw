import { readRoutingFeedback } from "../../task-routing/catalogue/observed.js";
import { renderTable } from "../../terminal/table.js";

export type FeedbackCommandOptions = {
  tail?: string;
  json?: boolean;
};

export async function routingFeedbackCommand(opts: FeedbackCommandOptions): Promise<void> {
  const tail = Math.max(1, Number(opts.tail) || 20);
  const events = await readRoutingFeedback();

  if (events.length === 0) {
    console.log("No routing feedback events recorded yet.");
    return;
  }

  const recent = events.slice(-tail);

  if (opts.json) {
    console.log(JSON.stringify(recent, null, 2));
    return;
  }

  console.log(`\nLast ${recent.length} feedback event${recent.length === 1 ? "" : "s"}:\n`);

  const rows = recent.map((e) => ({
    time: formatTimestamp(e.timestamp),
    signal: e.signal,
    task: e.originalTaskType,
    original: e.originalModel,
    overrideTo: e.overriddenTo ?? "-",
    reason: e.reason ?? "-",
  }));

  const table = renderTable({
    columns: [
      { key: "time", header: "Time", minWidth: 8 },
      { key: "signal", header: "Signal", minWidth: 10 },
      { key: "task", header: "Task", minWidth: 8 },
      { key: "original", header: "Original Model", minWidth: 14, flex: true },
      { key: "overrideTo", header: "Override To", minWidth: 14, flex: true },
      { key: "reason", header: "Reason", minWidth: 10, flex: true },
    ],
    rows,
    border: "unicode",
  });
  console.log(table);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "invalid";
  }
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toTimeString().slice(0, 8);
  }
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${d.toTimeString().slice(0, 5)}`;
}
