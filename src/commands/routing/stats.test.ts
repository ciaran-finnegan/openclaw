import { describe, it, vi } from "vitest";

describe("routing stats integration", () => {
  it("handles empty log gracefully", async () => {
    // Import fresh to avoid caching issues.
    const { routingStatsCommand } = await import("./stats.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Stats reads from default stateDir, but we just verify it doesn't throw.
    // With no events on disk, it should print a "no events" message.
    await routingStatsCommand({ days: "1" });

    spy.mockRestore();
  });

  it("produces JSON output without throwing", async () => {
    const { routingStatsCommand } = await import("./stats.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await routingStatsCommand({ json: true, days: "1" });

    spy.mockRestore();
  });
});

describe("routing log integration", () => {
  it("handles empty log gracefully", async () => {
    const { routingLogCommand } = await import("./log.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await routingLogCommand({ tail: "5" });

    spy.mockRestore();
  });

  it("produces JSON output without throwing", async () => {
    const { routingLogCommand } = await import("./log.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await routingLogCommand({ json: true, tail: "5" });

    spy.mockRestore();
  });
});
