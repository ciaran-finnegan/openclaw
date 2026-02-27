import { describe, it, expect } from "vitest";
import { estimateComplexity, extractComplexitySignals } from "./complexity.js";

describe("extractComplexitySignals", () => {
  it("extracts word count", () => {
    const signals = extractComplexitySignals("hello world foo bar");
    expect(signals.wordCount).toBe(4);
  });

  it("detects multi-step lists (numbered)", () => {
    const msg = `Please do the following:
1. Create a file
2. Write tests
3. Run the build`;
    const signals = extractComplexitySignals(msg);
    expect(signals.hasMultiStep).toBe(true);
  });

  it("detects multi-step lists (bulleted)", () => {
    const msg = `Tasks:
- create the module
- write the tests
- update the docs`;
    const signals = extractComplexitySignals(msg);
    expect(signals.hasMultiStep).toBe(true);
  });

  it("does not detect multi-step with only 2 list items", () => {
    const msg = `Tasks:
- create the module
- write the tests`;
    const signals = extractComplexitySignals(msg);
    expect(signals.hasMultiStep).toBe(false);
  });

  it("detects sequencing language", () => {
    const msg = "First set up the database, then run the migration scripts.";
    const signals = extractComplexitySignals(msg);
    expect(signals.hasMultiStep).toBe(true);
  });

  it("does not false-positive on sequencing words across separate sentences", () => {
    const msg = `Finally, here is the summary of our meeting.
This is an unrelated paragraph about something else entirely.
Once the project is done we can celebrate.`;
    const signals = extractComplexitySignals(msg);
    expect(signals.hasMultiStep).toBe(false);
  });

  it("counts tools from context", () => {
    const signals = extractComplexitySignals("do something", {
      requestedTools: ["browser", "shell", "calendar"],
    });
    expect(signals.toolCount).toBe(3);
  });

  it("handles empty context", () => {
    const signals = extractComplexitySignals("hello");
    expect(signals.toolCount).toBe(0);
    expect(signals.hasAttachments).toBe(false);
  });
});

describe("estimateComplexity", () => {
  it("returns low complexity for short messages", () => {
    const score = estimateComplexity("hello");
    expect(score).toBeLessThan(0.1);
  });

  it("returns higher complexity for long messages", () => {
    // Generate a message with ~600 words
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const score = estimateComplexity(words);
    expect(score).toBeGreaterThanOrEqual(0.35);
  });

  it("increases complexity for multi-step instructions", () => {
    const simple = "Write a function";
    const multiStep = `Please do the following:
1. Create the module
2. Add error handling
3. Write unit tests
4. Update the documentation`;
    const simpleScore = estimateComplexity(simple);
    const multiStepScore = estimateComplexity(multiStep);
    expect(multiStepScore).toBeGreaterThan(simpleScore);
  });

  it("increases complexity with tool references", () => {
    const noTools = estimateComplexity("do something");
    const withTools = estimateComplexity("do something", {
      requestedTools: ["browser", "shell", "calendar", "file_read"],
    });
    expect(withTools).toBeGreaterThan(noTools);
  });

  it("clamps result to [0, 1]", () => {
    // Even with all signals maxed, should not exceed 1.0
    const words = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(" ");
    const msg = `${words}\n1. step one\n2. step two\n3. step three`;
    const score = estimateComplexity(msg, {
      requestedTools: ["a", "b", "c", "d", "e"],
    });
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 for empty string", () => {
    const score = estimateComplexity("");
    expect(score).toBe(0);
  });

  it("scores moderately complex messages in the 0.2-0.6 range", () => {
    // ~100 words with a list
    const msg = `I need you to help me refactor the authentication system.
Here are the requirements:
1. Replace JWT tokens with session-based auth
2. Add rate limiting to login endpoints
3. Update the middleware chain
The current code is in src/auth/ and uses express middleware.`;
    const score = estimateComplexity(msg);
    expect(score).toBeGreaterThanOrEqual(0.2);
    expect(score).toBeLessThanOrEqual(0.6);
  });
});
