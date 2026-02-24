import type { ClassificationResult, ClassifierContext } from "./types.js";

// Compiled at module level for <1ms latency.
// No trailing spaces on keyword alternatives — \b handles word boundaries.
const CODE_KEYWORDS =
  /\b(function|const|let|var|class|import|export|return|async|await|throw|npm|git|docker|kubectl|pip|cargo|make|gcc|javac|python|node|bash|curl)\b/i;
// Patterns that include non-word chars (parens, dots, arrows) — matched separately
// without \b fencing since their delimiters are structural, not word-boundary based.
const CODE_SYNTAX =
  /(?:if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|catch\s*\(|=>|console\.|\.map\s*\(|\.filter\s*\(|\.reduce\s*\()/i;
const WRITING_KEYWORDS =
  /\b(write|draft|compose|rewrite|summarize|paraphrase|translate|proofread|edit this|blog post|essay|article|letter|email draft|story)\b/i;
const STATUS_KEYWORDS =
  /\b(status|uptime|health|ping|alive|running|version|info|who are you|what are you)\b/i;

/** O(n) code-block detection — immune to backtracking (no regex). */
function hasCodeBlock(text: string): boolean {
  const first = text.indexOf("```");
  if (first === -1) {
    return false;
  }
  return text.indexOf("```", first + 3) !== -1;
}

/** Match 3+ list items (numbered or bulleted) in the message. */
function hasMultiStepList(text: string): boolean {
  const LIST_ITEM = /^\s*(?:\d+[.)]\s|[-*]\s)/;
  const lines = text.split("\n");
  let count = 0;
  for (const line of lines) {
    if (LIST_ITEM.test(line)) {
      count++;
      if (count >= 3) {
        return true;
      }
    }
  }
  return false;
}

/** Rough word count used as a proxy for message length (not a true token count). */
function estimateWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Pure, deterministic task classifier (IRM Phase 1 — rules only).
 *
 * Decision priority (highest → lowest):
 * 1. heartbeat flag
 * 2. sub_agent flag
 * 3. code keywords / code blocks (but "write a function" → coding, not writing)
 * 4. word count >500 or multi-step lists → planning
 * 5. writing keywords (only when no code signal)
 * 6. status keywords + short message
 * 7. requestedTools non-empty (Phase 2 — not yet wired in the pipeline)
 * 8. fallback → chat
 */
export function classifyTask(
  messageBody: string,
  context: ClassifierContext,
): ClassificationResult {
  if (context.isHeartbeat) {
    return { task: "heartbeat", confidence: 1.0 };
  }

  if (context.isSubAgent) {
    return { task: "sub_agent", confidence: 0.9 };
  }

  const hasCodeSignal =
    CODE_KEYWORDS.test(messageBody) || CODE_SYNTAX.test(messageBody) || hasCodeBlock(messageBody);
  if (hasCodeSignal) {
    return { task: "coding", confidence: 0.8 };
  }

  const words = estimateWordCount(messageBody);
  if (words > 500 || hasMultiStepList(messageBody)) {
    return { task: "planning", confidence: 0.7 };
  }

  if (WRITING_KEYWORDS.test(messageBody)) {
    return { task: "writing", confidence: 0.8 };
  }

  if (STATUS_KEYWORDS.test(messageBody) && words < 50) {
    return { task: "status", confidence: 0.75 };
  }

  if (context.requestedTools && context.requestedTools.length > 0) {
    return { task: "tool_use", confidence: 0.85 };
  }

  return { task: "chat", confidence: 0.6 };
}
