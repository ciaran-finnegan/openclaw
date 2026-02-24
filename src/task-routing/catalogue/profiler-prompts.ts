import type { TaskType } from "../types.js";

export type ProfilerPrompt = {
  id: string;
  taskType: TaskType;
  prompt: string;
  /** Judge rubric: what a good answer should contain / demonstrate. */
  rubric: string;
  maxTokens: number;
};

/**
 * ~50 compact benchmark prompts for profiling local models.
 * Organised by task category (~7 per category).
 * Each prompt is designed to be quick (<30s) while testing capability.
 */
export const PROFILER_PROMPTS: ProfilerPrompt[] = [
  // ---- coding (8 prompts) ----
  {
    id: "code-1",
    taskType: "coding",
    prompt:
      "Write a TypeScript function that checks if a string is a valid IPv4 address. No libraries.",
    rubric:
      "Function validates four octets 0-255, handles edge cases (leading zeros, non-numeric), returns boolean.",
    maxTokens: 512,
  },
  {
    id: "code-2",
    taskType: "coding",
    prompt: "Write a Python function to find the longest common subsequence of two strings.",
    rubric:
      "Correct DP implementation with O(mn) time. Returns the subsequence string, not just length.",
    maxTokens: 512,
  },
  {
    id: "code-3",
    taskType: "coding",
    prompt:
      "Fix this JavaScript bug:\n```js\nfunction sum(arr) {\n  let total;\n  for (let i = 0; i <= arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}\n```",
    rubric:
      "Identifies both bugs: `total` not initialised to 0, and `<=` should be `<` (off-by-one).",
    maxTokens: 256,
  },
  {
    id: "code-4",
    taskType: "coding",
    prompt:
      "Write a SQL query to find the second highest salary from an `employees` table with columns `id`, `name`, `salary`.",
    rubric: "Correct SQL using DISTINCT, subquery or LIMIT/OFFSET or DENSE_RANK. Handles ties.",
    maxTokens: 256,
  },
  {
    id: "code-5",
    taskType: "coding",
    prompt:
      "Explain the time and space complexity of mergesort. Then write the merge step in TypeScript.",
    rubric:
      "Correctly states O(n log n) time, O(n) space. Merge function correctly combines two sorted arrays.",
    maxTokens: 512,
  },
  {
    id: "code-6",
    taskType: "coding",
    prompt:
      "Write a Bash one-liner to find all .ts files modified in the last 24 hours, excluding node_modules.",
    rubric: "Uses find with -mtime or -newer, excludes node_modules with -not -path or -prune.",
    maxTokens: 256,
  },
  {
    id: "code-7",
    taskType: "coding",
    prompt: "What does this regex match? `/^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$/`",
    rubric:
      "Correctly identifies it matches IPv4-like patterns (four groups of 1-3 digits separated by dots). Notes it doesn't validate range 0-255.",
    maxTokens: 256,
  },
  {
    id: "code-8",
    taskType: "coding",
    prompt:
      "Implement a simple LRU cache class in TypeScript with get(key) and put(key, value, capacity) methods.",
    rubric:
      "Uses Map for O(1) operations, maintains insertion order, evicts oldest on capacity overflow.",
    maxTokens: 512,
  },

  // ---- planning (7 prompts) ----
  {
    id: "plan-1",
    taskType: "planning",
    prompt:
      "Plan the architecture for a URL shortener service. List components, data stores, and API endpoints.",
    rubric:
      "Covers API design, database schema, redirect logic, analytics. Mentions scalability concerns.",
    maxTokens: 512,
  },
  {
    id: "plan-2",
    taskType: "planning",
    prompt: "Break down migrating a monolithic Node.js app to microservices into ordered steps.",
    rubric:
      "Identifies bounded contexts, data separation, API gateway, incremental approach, testing strategy.",
    maxTokens: 512,
  },
  {
    id: "plan-3",
    taskType: "planning",
    prompt:
      "Design a notification system that handles email, SMS, and push. What queues and services are needed?",
    rubric:
      "Mentions message queue, notification service, provider abstraction, retry logic, user preferences.",
    maxTokens: 512,
  },
  {
    id: "plan-4",
    taskType: "planning",
    prompt:
      "Create a rollback plan for a database migration that adds a NOT NULL column to a table with 10M rows.",
    rubric:
      "Phased approach: add nullable, backfill, set default, then alter. Rollback drops column or reverts constraint.",
    maxTokens: 512,
  },
  {
    id: "plan-5",
    taskType: "planning",
    prompt:
      "List the key decisions and trade-offs when choosing between REST and GraphQL for a new API.",
    rubric:
      "Covers caching, overfetching/underfetching, tooling, learning curve, N+1 queries, versioning.",
    maxTokens: 512,
  },
  {
    id: "plan-6",
    taskType: "planning",
    prompt:
      "Design a CI/CD pipeline for a TypeScript monorepo with 5 packages. What stages and checks are needed?",
    rubric: "Covers lint, typecheck, test, build, affected-only runs, caching, deploy stages.",
    maxTokens: 512,
  },
  {
    id: "plan-7",
    taskType: "planning",
    prompt: "Outline a disaster recovery plan for a cloud-hosted SaaS application.",
    rubric: "Covers RPO/RTO, backup strategy, multi-region, failover, runbooks, testing cadence.",
    maxTokens: 512,
  },

  // ---- writing (7 prompts) ----
  {
    id: "write-1",
    taskType: "writing",
    prompt:
      "Write a concise changelog entry for: Added dark mode support with system preference detection and manual toggle.",
    rubric:
      "Clear, user-facing description. Past tense or imperative. Mentions both auto-detection and manual toggle.",
    maxTokens: 256,
  },
  {
    id: "write-2",
    taskType: "writing",
    prompt: "Summarize the CAP theorem in 3 sentences for a junior developer.",
    rubric:
      "Accurately explains consistency, availability, partition tolerance trade-off. Accessible language.",
    maxTokens: 256,
  },
  {
    id: "write-3",
    taskType: "writing",
    prompt:
      "Write a professional email declining a meeting invitation due to a scheduling conflict, suggesting an alternative time.",
    rubric:
      "Polite, concise, suggests specific alternative. Professional tone without being overly formal.",
    maxTokens: 256,
  },
  {
    id: "write-4",
    taskType: "writing",
    prompt:
      'Translate this technical paragraph to non-technical language:\n"The API rate limiter uses a token bucket algorithm with a refill rate of 100 req/s and a burst capacity of 500 requests."',
    rubric:
      "Explains the concept without jargon. Conveys the idea of steady rate with burst allowance.",
    maxTokens: 256,
  },
  {
    id: "write-5",
    taskType: "writing",
    prompt:
      "Draft a one-paragraph README description for a CLI tool that manages Docker containers with a simpler interface.",
    rubric:
      "Clear value proposition, mentions target audience, key features, and how to get started.",
    maxTokens: 256,
  },
  {
    id: "write-6",
    taskType: "writing",
    prompt:
      "Write a git commit message for: refactored the authentication middleware to use async/await instead of callbacks, fixed a race condition in token refresh.",
    rubric:
      "Imperative mood, concise subject line, body explains why. Follows conventional commit style.",
    maxTokens: 256,
  },
  {
    id: "write-7",
    taskType: "writing",
    prompt:
      "Write JSDoc for a function: `async function retry<T>(fn: () => Promise<T>, maxAttempts: number, delayMs: number): Promise<T>`",
    rubric:
      "Documents parameters, return type, throws, and retry behavior. Mentions exponential backoff if applicable.",
    maxTokens: 256,
  },

  // ---- chat (7 prompts) ----
  {
    id: "chat-1",
    taskType: "chat",
    prompt: "What's the difference between == and === in JavaScript?",
    rubric: "Explains type coercion vs strict equality. Gives examples. Recommends === as default.",
    maxTokens: 256,
  },
  {
    id: "chat-2",
    taskType: "chat",
    prompt: "When would you use a Map instead of a plain object in JavaScript?",
    rubric:
      "Mentions non-string keys, iteration order, size property, performance for frequent additions/deletions.",
    maxTokens: 256,
  },
  {
    id: "chat-3",
    taskType: "chat",
    prompt: "Explain event bubbling in the DOM in one paragraph.",
    rubric:
      "Correctly describes event propagation from target up through ancestors. Mentions stopPropagation.",
    maxTokens: 256,
  },
  {
    id: "chat-4",
    taskType: "chat",
    prompt: "What's a good approach for handling errors in an Express.js API?",
    rubric:
      "Mentions error middleware, try/catch or async wrappers, error classes, logging, appropriate HTTP status codes.",
    maxTokens: 256,
  },
  {
    id: "chat-5",
    taskType: "chat",
    prompt: "Should I use `interface` or `type` in TypeScript? When does it matter?",
    rubric:
      "Explains declaration merging, extends vs intersection, performance. Practical guidance on when each is better.",
    maxTokens: 256,
  },
  {
    id: "chat-6",
    taskType: "chat",
    prompt: "What is the purpose of the `as const` assertion in TypeScript?",
    rubric:
      "Explains literal type narrowing, readonly properties, and use with enums/discriminated unions.",
    maxTokens: 256,
  },
  {
    id: "chat-7",
    taskType: "chat",
    prompt: "Hi! Can you help me debug something?",
    rubric:
      "Responds helpfully and asks for details. Shows willingness to help without being verbose.",
    maxTokens: 128,
  },

  // ---- status (7 prompts) ----
  {
    id: "status-1",
    taskType: "status",
    prompt: "ping",
    rubric: "Short acknowledgement (pong, alive, ok). Should not be verbose.",
    maxTokens: 64,
  },
  {
    id: "status-2",
    taskType: "status",
    prompt: "Are you there?",
    rubric: "Brief confirmation of availability.",
    maxTokens: 64,
  },
  {
    id: "status-3",
    taskType: "status",
    prompt: "What model are you?",
    rubric: "Identifies itself accurately. Brief response.",
    maxTokens: 128,
  },
  {
    id: "status-4",
    taskType: "status",
    prompt: "status",
    rubric: "Provides a status response or asks for clarification. Should be concise.",
    maxTokens: 128,
  },
  {
    id: "status-5",
    taskType: "status",
    prompt: "hello",
    rubric: "Friendly, brief greeting.",
    maxTokens: 64,
  },
  {
    id: "status-6",
    taskType: "status",
    prompt: "version",
    rubric: "Responds about its version/capabilities or asks for context. Brief.",
    maxTokens: 128,
  },
  {
    id: "status-7",
    taskType: "status",
    prompt: "health check",
    rubric: "Brief health/status confirmation.",
    maxTokens: 64,
  },

  // ---- tool_use (7 prompts) ----
  {
    id: "tool-1",
    taskType: "tool_use",
    prompt:
      'You have a tool called `search(query: string)` that searches a knowledge base. The user asks: "Find documents about rate limiting." Call the appropriate tool.',
    rubric: "Generates a properly formatted tool call with a reasonable search query.",
    maxTokens: 256,
  },
  {
    id: "tool-2",
    taskType: "tool_use",
    prompt:
      'You have two tools: `get_weather(city: string)` and `get_time(timezone: string)`. User says: "What\'s the weather and time in Tokyo?" Use both tools.',
    rubric: "Calls both tools with correct arguments. May call in parallel or sequentially.",
    maxTokens: 256,
  },
  {
    id: "tool-3",
    taskType: "tool_use",
    prompt:
      'You have a tool `run_sql(query: string)`. User asks: "How many users signed up last week?" Generate the SQL.',
    rubric: "Generates reasonable SQL with date range filter. Uses the tool correctly.",
    maxTokens: 256,
  },
  {
    id: "tool-4",
    taskType: "tool_use",
    prompt:
      'You have a tool `send_email(to: string, subject: string, body: string)`. User says: "Email john@example.com about the meeting tomorrow at 2pm." Use the tool.',
    rubric: "Calls tool with correct email, reasonable subject and body.",
    maxTokens: 256,
  },
  {
    id: "tool-5",
    taskType: "tool_use",
    prompt:
      'You have a `calculator(expression: string)` tool. User asks: "What is 15% of 847?" Use the tool to compute it.',
    rubric: "Calls calculator with correct expression (e.g., 847 * 0.15). Returns correct answer.",
    maxTokens: 256,
  },
  {
    id: "tool-6",
    taskType: "tool_use",
    prompt:
      'You have `read_file(path: string)` and `write_file(path: string, content: string)`. User says: "Read config.json and add a new key debug=true." Describe the tool calls needed.',
    rubric:
      "First reads the file, then writes with the modification. Correct ordering of operations.",
    maxTokens: 256,
  },
  {
    id: "tool-7",
    taskType: "tool_use",
    prompt:
      'A tool call returned an error: `{"error": "rate_limited", "retry_after": 5}`. How should you handle this?',
    rubric:
      "Suggests waiting the specified time then retrying. Mentions informing the user about the delay.",
    maxTokens: 256,
  },

  // ---- heartbeat (3 prompts — lightweight) ----
  {
    id: "hb-1",
    taskType: "heartbeat",
    prompt: "Reply with exactly one word: ok",
    rubric: "Responds with 'ok' or very close. Minimal tokens.",
    maxTokens: 16,
  },
  {
    id: "hb-2",
    taskType: "heartbeat",
    prompt: "Respond with a single emoji.",
    rubric: "Returns one emoji. No extra text.",
    maxTokens: 16,
  },
  {
    id: "hb-3",
    taskType: "heartbeat",
    prompt: "Echo: alive",
    rubric: "Responds with 'alive' or equivalent minimal response.",
    maxTokens: 16,
  },
];
