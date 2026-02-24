import { describe, it, expect } from "vitest";
import { classifyTask } from "./classifier.js";
import type { ClassifierContext } from "./types.js";

const base: ClassifierContext = { isHeartbeat: false, isSubAgent: false };

describe("classifyTask", () => {
  // --- heartbeat ---
  describe("heartbeat", () => {
    it("returns heartbeat when isHeartbeat flag is set", () => {
      const result = classifyTask("anything here", { ...base, isHeartbeat: true });
      expect(result).toEqual({ task: "heartbeat", confidence: 1.0 });
    });

    it("heartbeat takes priority over all other signals", () => {
      const result = classifyTask("write a function to parse JSON", {
        ...base,
        isHeartbeat: true,
        isSubAgent: true,
        requestedTools: ["bash"],
      });
      expect(result.task).toBe("heartbeat");
    });
  });

  // --- sub_agent ---
  describe("sub_agent", () => {
    it("returns sub_agent when isSubAgent flag is set", () => {
      const result = classifyTask("summarize the file", { ...base, isSubAgent: true });
      expect(result).toEqual({ task: "sub_agent", confidence: 0.9 });
    });

    it("heartbeat beats sub_agent", () => {
      const result = classifyTask("hi", { isHeartbeat: true, isSubAgent: true });
      expect(result.task).toBe("heartbeat");
    });
  });

  // --- coding ---
  describe("coding", () => {
    it("detects code keywords", () => {
      expect(classifyTask("const x = 42", base).task).toBe("coding");
      expect(classifyTask("write a function to sort an array", base).task).toBe("coding");
      expect(classifyTask("import foo from bar", base).task).toBe("coding");
      expect(classifyTask("run npm install", base).task).toBe("coding");
    });

    it("detects bare keywords at end of string or before punctuation", () => {
      expect(classifyTask("use docker", base).task).toBe("coding");
      expect(classifyTask("install npm", base).task).toBe("coding");
      expect(classifyTask("run git", base).task).toBe("coding");
      expect(classifyTask("try python.", base).task).toBe("coding");
    });

    it("detects code syntax patterns", () => {
      expect(classifyTask("arr.map(x => x)", base).task).toBe("coding");
      expect(classifyTask("items.filter(Boolean)", base).task).toBe("coding");
      expect(classifyTask("if (x > 0) {}", base).task).toBe("coding");
      expect(classifyTask("const fn = () => 42", base).task).toBe("coding");
    });

    it("detects code blocks", () => {
      const msg = "Fix this:\n```js\nconsole.log('hi')\n```";
      expect(classifyTask(msg, base).task).toBe("coding");
    });

    it("does not false-positive on unterminated code fence", () => {
      // Single backtick fence with no closing — should not hang or match as code block.
      const msg = "Here is some text with ``` but no closing fence";
      // Falls through to chat (no code keywords, no closing fence).
      expect(classifyTask(msg, base).task).toBe("chat");
    });

    it("coding wins over writing keywords when both present", () => {
      // "write a function" has both writing keyword and code keyword
      const result = classifyTask("write a function that parses CSV", base);
      expect(result.task).toBe("coding");
    });

    it("returns confidence 0.8 for coding", () => {
      expect(classifyTask("async function main() {}", base).confidence).toBe(0.8);
    });
  });

  // --- planning ---
  describe("planning", () => {
    it("detects long messages (>500 tokens)", () => {
      const longMsg = Array(501).fill("word").join(" ");
      expect(classifyTask(longMsg, base).task).toBe("planning");
    });

    it("detects multi-step lists", () => {
      const msg = "Here is the plan:\n1. Do A\n2. Do B\n3. Do C\n4. Do D";
      expect(classifyTask(msg, base).task).toBe("planning");
    });

    it("detects bullet lists", () => {
      const msg = "Steps:\n- first\n- second\n- third";
      expect(classifyTask(msg, base).task).toBe("planning");
    });

    it("returns confidence 0.7 for planning", () => {
      const longMsg = Array(501).fill("word").join(" ");
      expect(classifyTask(longMsg, base).confidence).toBe(0.7);
    });
  });

  // --- writing ---
  describe("writing", () => {
    it("detects writing keywords", () => {
      expect(classifyTask("draft a blog post about AI", base).task).toBe("writing");
      expect(classifyTask("compose an email to the team", base).task).toBe("writing");
      expect(classifyTask("summarize the meeting notes", base).task).toBe("writing");
      expect(classifyTask("translate this to French", base).task).toBe("writing");
    });

    it("returns confidence 0.8 for writing", () => {
      expect(classifyTask("draft a letter", base).confidence).toBe(0.8);
    });
  });

  // --- status ---
  describe("status", () => {
    it("detects short status queries", () => {
      expect(classifyTask("status", base).task).toBe("status");
      expect(classifyTask("are you alive?", base).task).toBe("status");
      expect(classifyTask("what version are you?", base).task).toBe("status");
      expect(classifyTask("who are you", base).task).toBe("status");
    });

    it("does not classify long messages as status even with status keyword", () => {
      const longStatus = `status ${"word ".repeat(60)}`;
      expect(classifyTask(longStatus, base).task).not.toBe("status");
    });

    it("returns confidence 0.75 for status", () => {
      expect(classifyTask("ping", base).confidence).toBe(0.75);
    });
  });

  // --- tool_use ---
  describe("tool_use", () => {
    it("detects requestedTools", () => {
      const result = classifyTask("do something", { ...base, requestedTools: ["bash", "search"] });
      expect(result).toEqual({ task: "tool_use", confidence: 0.85 });
    });

    it("empty requestedTools does not trigger tool_use", () => {
      const result = classifyTask("hello", { ...base, requestedTools: [] });
      expect(result.task).toBe("chat");
    });
  });

  // --- chat (default) ---
  describe("chat", () => {
    it("returns chat for generic messages", () => {
      expect(classifyTask("hello", base).task).toBe("chat");
      expect(classifyTask("what's up?", base).task).toBe("chat");
      expect(classifyTask("tell me a joke", base).task).toBe("chat");
    });

    it("returns chat for empty string", () => {
      expect(classifyTask("", base).task).toBe("chat");
    });

    it("returns confidence 0.6 for chat", () => {
      expect(classifyTask("hello there", base).confidence).toBe(0.6);
    });
  });

  // --- priority edge cases ---
  describe("priority", () => {
    it("coding beats writing for 'write a function'", () => {
      expect(classifyTask("write a function to parse JSON", base).task).toBe("coding");
    });

    it("coding beats status for 'git status'", () => {
      expect(classifyTask("run git status", base).task).toBe("coding");
    });

    it("planning beats writing for long write request", () => {
      const longWrite = `write ${"detailed paragraph ".repeat(300)}`;
      expect(classifyTask(longWrite, base).task).toBe("planning");
    });
  });
});
