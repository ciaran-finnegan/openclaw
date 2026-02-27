import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { appendRoutingFeedback, readRoutingFeedback, resolveFeedbackPath } from "./observed.js";
import type { RoutingFeedbackEvent } from "./types.js";

describe("routing feedback JSONL", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "feedback-test-"));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  const baseFeedback: RoutingFeedbackEvent = {
    timestamp: "2026-02-24T10:00:00Z",
    sessionKey: "test-session",
    originalModel: "anthropic/claude-haiku-4-5",
    originalTaskType: "chat",
    signal: "model_override",
    overriddenTo: "anthropic/claude-opus-4-6",
  };

  it("returns empty array when no file exists", async () => {
    const events = await readRoutingFeedback(tmpDir);
    expect(events).toEqual([]);
  });

  it("appends and reads a single feedback event", async () => {
    await appendRoutingFeedback(baseFeedback, tmpDir);
    const events = await readRoutingFeedback(tmpDir);
    expect(events).toHaveLength(1);
    expect(events[0].signal).toBe("model_override");
    expect(events[0].originalModel).toBe("anthropic/claude-haiku-4-5");
    expect(events[0].overriddenTo).toBe("anthropic/claude-opus-4-6");
  });

  it("appends multiple events and reads in chronological order", async () => {
    const event1: RoutingFeedbackEvent = {
      ...baseFeedback,
      timestamp: "2026-02-24T10:00:00Z",
      signal: "model_override",
    };
    const event2: RoutingFeedbackEvent = {
      ...baseFeedback,
      timestamp: "2026-02-24T11:00:00Z",
      signal: "retry",
      overriddenTo: undefined,
      reason: "fallback triggered",
    };
    const event3: RoutingFeedbackEvent = {
      ...baseFeedback,
      timestamp: "2026-02-24T12:00:00Z",
      signal: "escalation",
      overriddenTo: "anthropic/claude-opus-4-6",
      reason: "escalated to higher tier",
    };

    await appendRoutingFeedback(event1, tmpDir);
    await appendRoutingFeedback(event2, tmpDir);
    await appendRoutingFeedback(event3, tmpDir);

    const events = await readRoutingFeedback(tmpDir);
    expect(events).toHaveLength(3);
    expect(events[0].signal).toBe("model_override");
    expect(events[1].signal).toBe("retry");
    expect(events[2].signal).toBe("escalation");
  });

  it("resolves feedback path correctly", () => {
    const p = resolveFeedbackPath(tmpDir);
    expect(p).toContain("routing");
    expect(p).toContain("feedback.jsonl");
  });

  it("skips malformed lines gracefully", async () => {
    const feedbackPath = resolveFeedbackPath(tmpDir);
    await fsp.mkdir(path.dirname(feedbackPath), { recursive: true });
    const validLine = JSON.stringify(baseFeedback);
    await fsp.writeFile(feedbackPath, `${validLine}\nnot-json\n${validLine}\n`, "utf8");

    const events = await readRoutingFeedback(tmpDir);
    expect(events).toHaveLength(2);
  });
});
