import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRoutingEvent,
  aggregateObserved,
  readRoutingEvents,
  resolveObservedPath,
} from "./observed.js";
import type { RoutingEvent } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "openclaw-observed-test-"));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<RoutingEvent> = {}): RoutingEvent {
  return {
    timestamp: new Date().toISOString(),
    model: "anthropic/claude-sonnet-4-6",
    taskType: "coding",
    success: true,
    retried: false,
    escalated: false,
    latencyMs: 500,
    inputTokens: 100,
    outputTokens: 200,
    ...overrides,
  };
}

describe("resolveObservedPath", () => {
  it("constructs path under state dir", () => {
    const p = resolveObservedPath("/tmp/test-state");
    expect(p).toBe("/tmp/test-state/routing/observed.jsonl");
  });
});

describe("appendRoutingEvent", () => {
  it("creates the file and appends an event", async () => {
    const event = makeEvent();
    await appendRoutingEvent(event, tmpDir);

    const filePath = resolveObservedPath(tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = await fsp.readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ model: event.model, taskType: event.taskType });
  });

  it("appends multiple events", async () => {
    await appendRoutingEvent(makeEvent({ model: "model-a" }), tmpDir);
    await appendRoutingEvent(makeEvent({ model: "model-b" }), tmpDir);
    await appendRoutingEvent(makeEvent({ model: "model-c" }), tmpDir);

    const events = await readRoutingEvents(tmpDir);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.model)).toEqual(["model-a", "model-b", "model-c"]);
  });
});

describe("readRoutingEvents", () => {
  it("returns empty array when file does not exist", async () => {
    const events = await readRoutingEvents(tmpDir);
    expect(events).toEqual([]);
  });

  it("skips malformed lines", async () => {
    const filePath = resolveObservedPath(tmpDir);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(
      filePath,
      [
        JSON.stringify(makeEvent({ model: "valid" })),
        "this is not json",
        JSON.stringify(makeEvent({ model: "also-valid" })),
        "",
      ].join("\n"),
    );

    const events = await readRoutingEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0].model).toBe("valid");
    expect(events[1].model).toBe("also-valid");
  });
});

describe("aggregateObserved", () => {
  it("returns undefined when no events match", async () => {
    const result = await aggregateObserved("nonexistent", "coding", tmpDir);
    expect(result).toBeUndefined();
  });

  it("aggregates matching events correctly", async () => {
    // 3 success, 1 retry, 1 escalated
    await appendRoutingEvent(
      makeEvent({
        success: true,
        retried: false,
        escalated: false,
        latencyMs: 100,
        inputTokens: 50,
        outputTokens: 100,
      }),
      tmpDir,
    );
    await appendRoutingEvent(
      makeEvent({
        success: true,
        retried: true,
        escalated: false,
        latencyMs: 200,
        inputTokens: 60,
        outputTokens: 120,
      }),
      tmpDir,
    );
    await appendRoutingEvent(
      makeEvent({
        success: false,
        retried: false,
        escalated: true,
        latencyMs: 300,
        inputTokens: 70,
        outputTokens: 140,
      }),
      tmpDir,
    );
    await appendRoutingEvent(
      makeEvent({
        success: true,
        retried: false,
        escalated: false,
        latencyMs: 400,
        inputTokens: 80,
        outputTokens: 160,
      }),
      tmpDir,
    );

    const result = await aggregateObserved("anthropic/claude-sonnet-4-6", "coding", tmpDir);
    expect(result).toBeDefined();
    expect(result!.requests).toBe(4);
    expect(result!.successRate).toBe(0.75);
    expect(result!.retryRate).toBe(0.25);
    expect(result!.escalationRate).toBe(0.25);
    expect(result!.avgLatencyMs).toBe(250);
    expect(result!.avgInputTokens).toBe(65);
    expect(result!.avgOutputTokens).toBe(130);
    expect(result!.effectiveScore).toBeCloseTo(0.75 * (1 - 0.25 * 0.5));
  });

  it("only aggregates events for the specified model and task type", async () => {
    await appendRoutingEvent(makeEvent({ model: "model-a", taskType: "coding" }), tmpDir);
    await appendRoutingEvent(makeEvent({ model: "model-a", taskType: "chat" }), tmpDir);
    await appendRoutingEvent(makeEvent({ model: "model-b", taskType: "coding" }), tmpDir);

    const result = await aggregateObserved("model-a", "coding", tmpDir);
    expect(result).toBeDefined();
    expect(result!.requests).toBe(1);
  });

  it("derives period from event timestamps", async () => {
    await appendRoutingEvent(makeEvent({ timestamp: "2026-01-01T00:00:00Z" }), tmpDir);
    await appendRoutingEvent(makeEvent({ timestamp: "2026-01-15T00:00:00Z" }), tmpDir);

    const result = await aggregateObserved("anthropic/claude-sonnet-4-6", "coding", tmpDir);
    expect(result!.period).toBe("2026-01-01/2026-01-15");
  });
});
