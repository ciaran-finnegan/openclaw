import type { ClassifierContext } from "./types.js";

/** Signals extracted from a message for complexity estimation. */
export type ComplexitySignals = {
  /** Word count as a proxy for information density. */
  wordCount: number;
  /** Whether multi-step instructions were detected (numbered lists, sequencing). */
  hasMultiStep: boolean;
  /** Number of tools/skills referenced in the context. */
  toolCount: number;
  /** Whether file/media attachments are present. */
  hasAttachments: boolean;
};

/** Match 3+ list items (numbered or bulleted). */
const LIST_ITEM = /^\s*(?:\d+[.)]\s|[-*]\s)/;

/** Sequencing language: "first...then...", "step 1...step 2...", etc.
 * Uses [^.!?\n] instead of `.` to avoid cross-sentence/paragraph false positives. */
const SEQUENCING_PATTERN =
  /\b(?:first\b[^.!?\n]*?\bthen\b|step\s+\d|phase\s+\d|next\b[^.!?\n]*?\bafter\b|finally\b[^.!?\n]*?\bonce\b)/i;

/**
 * Detect multi-step instructions: either 3+ list items or sequencing language.
 */
function detectMultiStep(text: string): boolean {
  // Check for numbered/bulleted lists
  const lines = text.split("\n");
  let listCount = 0;
  for (const line of lines) {
    if (LIST_ITEM.test(line)) {
      listCount++;
      if (listCount >= 3) {
        return true;
      }
    }
  }

  // Check for sequencing language
  return SEQUENCING_PATTERN.test(text);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Extract complexity signals from a message and optional context.
 */
export function extractComplexitySignals(
  message: string,
  context?: Pick<ClassifierContext, "requestedTools">,
): ComplexitySignals {
  return {
    wordCount: countWords(message),
    hasMultiStep: detectMultiStep(message),
    toolCount: context?.requestedTools?.length ?? 0,
    hasAttachments: false, // Future: wire from media context
  };
}

/**
 * Estimate complexity of a message on a 0.0–1.0 scale.
 *
 * Active scoring weights:
 * - Word count:   0–0.4 (0 at <=50 words, 0.4 at >=500 words, linear between)
 * - Multi-step:   0.25 bonus if detected
 * - Tool count:   0–0.2 (0.05 per tool, capped at 0.2)
 *
 * Reserved (not yet wired):
 * - Attachments:  0.15 bonus when media context is connected
 *
 * Result is clamped to [0, 1].
 */
export function estimateComplexity(
  message: string,
  context?: Pick<ClassifierContext, "requestedTools">,
): number {
  const signals = extractComplexitySignals(message, context);

  // Word count component: linear ramp from 50–500 words → 0–0.4
  const wordScore = Math.min(1, Math.max(0, (signals.wordCount - 50) / 450)) * 0.4;

  // Multi-step bonus
  const multiStepScore = signals.hasMultiStep ? 0.25 : 0;

  // Tool count component: 0.05 per tool, capped at 0.2
  const toolScore = Math.min(0.2, signals.toolCount * 0.05);

  // Attachment bonus
  const attachmentScore = signals.hasAttachments ? 0.15 : 0;

  return Math.min(1, wordScore + multiStepScore + toolScore + attachmentScore);
}
