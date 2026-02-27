import {
  resolveAgentConfig,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveSessionAgentId,
  resolveAgentSkillsFilter,
} from "../../agents/agent-scope.js";
import { resolveModelRefFromString } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../../agents/workspace.js";
import { resolveChannelModelOverride } from "../../channels/model-overrides.js";
import { type OpenClawConfig, loadConfig } from "../../config/config.js";
import { applyLinkUnderstanding } from "../../link-understanding/apply.js";
import { applyMediaUnderstanding } from "../../media-understanding/apply.js";
import { defaultRuntime } from "../../runtime.js";
import { isModelAllowed } from "../../task-routing/allowlist.js";
import { applyBudgetGate } from "../../task-routing/catalogue/budget.js";
import { getCatalogueEntry } from "../../task-routing/catalogue/catalogue.js";
import {
  appendRoutingEvent,
  appendRoutingFeedback,
} from "../../task-routing/catalogue/observed.js";
import type { RoutingEvent, RoutingFeedbackEvent } from "../../task-routing/catalogue/types.js";
import {
  TIER_PRIORITY,
  getRoutingEscalationFallbacks,
  resolveTaskRoute,
} from "../../task-routing/resolve-task-route.js";
import { resolveCommandAuthorization } from "../command-auth.js";
import type { MsgContext } from "../templating.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import type { UsageCapture } from "./agent-runner.js";
import { resolveDefaultModel } from "./directive-handling.js";
import { resolveReplyDirectives } from "./get-reply-directives.js";
import { handleInlineActions } from "./get-reply-inline-actions.js";
import { runPreparedReply } from "./get-reply-run.js";
import { finalizeInboundContext } from "./inbound-context.js";
import { applyResetModelOverride } from "./session-reset-model.js";
import { initSessionState } from "./session.js";
import { stageSandboxMedia } from "./stage-sandbox-media.js";
import { createTypingController } from "./typing.js";

function mergeSkillFilters(channelFilter?: string[], agentFilter?: string[]): string[] | undefined {
  const normalize = (list?: string[]) => {
    if (!Array.isArray(list)) {
      return undefined;
    }
    return list.map((entry) => String(entry).trim()).filter(Boolean);
  };
  const channel = normalize(channelFilter);
  const agent = normalize(agentFilter);
  if (!channel && !agent) {
    return undefined;
  }
  if (!channel) {
    return agent;
  }
  if (!agent) {
    return channel;
  }
  if (channel.length === 0 || agent.length === 0) {
    return [];
  }
  const agentSet = new Set(agent);
  return channel.filter((name) => agentSet.has(name));
}

export async function getReplyFromConfig(
  ctx: MsgContext,
  opts?: GetReplyOptions,
  configOverride?: OpenClawConfig,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const isFastTestEnv = process.env.OPENCLAW_TEST_FAST === "1";
  const cfg = configOverride ?? loadConfig();
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const agentSessionKey = targetSessionKey || ctx.SessionKey;
  const agentId = resolveSessionAgentId({
    sessionKey: agentSessionKey,
    config: cfg,
  });
  const mergedSkillFilter = mergeSkillFilters(
    opts?.skillFilter,
    resolveAgentSkillsFilter(cfg, agentId),
  );
  const resolvedOpts =
    mergedSkillFilter !== undefined ? { ...opts, skillFilter: mergedSkillFilter } : opts;
  const agentCfg = cfg.agents?.defaults;
  const sessionCfg = cfg.session;
  const { defaultProvider, defaultModel, aliasIndex } = resolveDefaultModel({
    cfg,
    agentId,
  });
  let provider = defaultProvider;
  let model = defaultModel;
  let hasResolvedHeartbeatModelOverride = false;
  if (opts?.isHeartbeat) {
    // Prefer the resolved per-agent heartbeat model passed from the heartbeat runner,
    // fall back to the global defaults heartbeat model for backward compatibility.
    const heartbeatRaw =
      opts.heartbeatModelOverride?.trim() ?? agentCfg?.heartbeat?.model?.trim() ?? "";
    const heartbeatRef = heartbeatRaw
      ? resolveModelRefFromString({
          raw: heartbeatRaw,
          defaultProvider,
          aliasIndex,
        })
      : null;
    if (heartbeatRef) {
      provider = heartbeatRef.ref.provider;
      model = heartbeatRef.ref.model;
      hasResolvedHeartbeatModelOverride = true;
    }
  }

  const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, agentId) ?? DEFAULT_AGENT_WORKSPACE_DIR;
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: !agentCfg?.skipBootstrap && !isFastTestEnv,
  });
  const workspaceDir = workspace.dir;
  const agentDir = resolveAgentDir(cfg, agentId);
  const timeoutMs = resolveAgentTimeoutMs({ cfg, overrideSeconds: opts?.timeoutOverrideSeconds });
  const configuredTypingSeconds =
    agentCfg?.typingIntervalSeconds ?? sessionCfg?.typingIntervalSeconds;
  const typingIntervalSeconds =
    typeof configuredTypingSeconds === "number" ? configuredTypingSeconds : 6;
  const typing = createTypingController({
    onReplyStart: opts?.onReplyStart,
    onCleanup: opts?.onTypingCleanup,
    typingIntervalSeconds,
    silentToken: SILENT_REPLY_TOKEN,
    log: defaultRuntime.log,
  });
  opts?.onTypingController?.(typing);

  const finalized = finalizeInboundContext(ctx);

  if (!isFastTestEnv) {
    await applyMediaUnderstanding({
      ctx: finalized,
      cfg,
      agentDir,
      activeModel: { provider, model },
    });
    await applyLinkUnderstanding({
      ctx: finalized,
      cfg,
    });
  }

  const commandAuthorized = finalized.CommandAuthorized;
  resolveCommandAuthorization({
    ctx: finalized,
    cfg,
    commandAuthorized,
  });
  const sessionState = await initSessionState({
    ctx: finalized,
    cfg,
    commandAuthorized,
  });
  let {
    sessionCtx,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    isNewSession,
    resetTriggered,
    systemSent,
    abortedLastRun,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    triggerBodyNormalized,
    bodyStripped,
  } = sessionState;

  await applyResetModelOverride({
    cfg,
    resetTriggered,
    bodyStripped,
    sessionCtx,
    ctx: finalized,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultProvider,
    defaultModel,
    aliasIndex,
  });

  const channelModelOverride = resolveChannelModelOverride({
    cfg,
    channel:
      groupResolution?.channel ??
      sessionEntry.channel ??
      sessionEntry.origin?.provider ??
      (typeof finalized.OriginatingChannel === "string"
        ? finalized.OriginatingChannel
        : undefined) ??
      finalized.Provider,
    groupId: groupResolution?.id ?? sessionEntry.groupId,
    groupChannel: sessionEntry.groupChannel ?? sessionCtx.GroupChannel ?? finalized.GroupChannel,
    groupSubject: sessionEntry.subject ?? sessionCtx.GroupSubject ?? finalized.GroupSubject,
    parentSessionKey: sessionCtx.ParentSessionKey,
  });
  const hasSessionModelOverride = Boolean(
    sessionEntry.modelOverride?.trim() || sessionEntry.providerOverride?.trim(),
  );
  if (!hasResolvedHeartbeatModelOverride && !hasSessionModelOverride && channelModelOverride) {
    const resolved = resolveModelRefFromString({
      raw: channelModelOverride.model,
      defaultProvider,
      aliasIndex,
    });
    if (resolved) {
      provider = resolved.ref.provider;
      model = resolved.ref.model;
    }
  }

  // Task-aware routing (IRM Phase 1+2+3) — only when enabled and no higher-priority override.
  // Heartbeats route through the classifier (→ cheap tier) unless a dedicated
  // heartbeat model override is configured, in which case the override above
  // already selected the model.
  // Merge per-agent routing overrides (shallow) over global defaults.
  const perAgentRouting = resolveAgentConfig(cfg, agentId)?.routing;
  const routingConfig = perAgentRouting
    ? {
        ...agentCfg?.routing,
        ...perAgentRouting,
        // Deep-merge tiers so per-agent can override individual tiers.
        tiers: { ...agentCfg?.routing?.tiers, ...perAgentRouting.tiers },
        taskMap: { ...agentCfg?.routing?.taskMap, ...perAgentRouting.taskMap },
      }
    : agentCfg?.routing;
  let activeRoutingDecision: ReturnType<typeof resolveTaskRoute> = null;
  let routingDecisionMs = 0; // time spent in budget gate + classification + scoring
  let activeBudgetGate: Awaited<ReturnType<typeof applyBudgetGate>> | undefined;
  const replyStartMs = Date.now(); // tracks total round-trip for latencyMs
  if (
    routingConfig?.enabled &&
    !hasResolvedHeartbeatModelOverride &&
    !hasSessionModelOverride &&
    !channelModelOverride
  ) {
    // IRM Phase 3: compute budget gate before routing decision.
    const routingStartMs = Date.now();
    const budgetGate = routingConfig.budget?.enabled
      ? await applyBudgetGate(routingConfig.budget)
      : undefined;
    activeBudgetGate = budgetGate;

    activeRoutingDecision = resolveTaskRoute({
      routingConfig,
      messageBody: bodyStripped ?? "",
      context: {
        isHeartbeat: Boolean(opts?.isHeartbeat),
        isSubAgent: Boolean(sessionEntry.spawnedBy),
      },
      budgetGate,
      cfg,
    });
    routingDecisionMs = Date.now() - routingStartMs;

    // Allowlist enforcement: verify the routed model exists in the user's
    // provider config. If not, skip routing for this request.
    if (activeRoutingDecision && !isModelAllowed(activeRoutingDecision.model, cfg)) {
      activeRoutingDecision = null;
    }

    if (activeRoutingDecision) {
      const routedRef = resolveModelRefFromString({
        raw: activeRoutingDecision.model,
        defaultProvider,
        aliasIndex,
      });
      if (routedRef) {
        provider = routedRef.ref.provider;
        model = routedRef.ref.model;
      }
    }
  }

  const directiveResult = await resolveReplyDirectives({
    ctx: finalized,
    cfg,
    agentId,
    agentDir,
    workspaceDir,
    agentCfg,
    sessionCtx,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    triggerBodyNormalized,
    commandAuthorized,
    defaultProvider,
    defaultModel,
    aliasIndex,
    provider,
    model,
    hasResolvedHeartbeatModelOverride,
    typing,
    opts: resolvedOpts,
    skillFilter: mergedSkillFilter,
  });
  if (directiveResult.kind === "reply") {
    return directiveResult.reply;
  }

  let {
    commandSource,
    command,
    allowTextCommands,
    skillCommands,
    directives,
    cleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    provider: resolvedProvider,
    model: resolvedModel,
    modelState,
    contextTokens,
    inlineStatusRequested,
    directiveAck,
    perMessageQueueMode,
    perMessageQueueOptions,
  } = directiveResult.result;
  provider = resolvedProvider;
  model = resolvedModel;

  // Phase 4: if routing was active and the user switched models via /model directive,
  // log a model_override feedback event.
  if (activeRoutingDecision && sessionKey) {
    const resolvedLabel = `${resolvedProvider}/${resolvedModel}`;
    if (resolvedLabel !== activeRoutingDecision.model) {
      const feedbackEvent: RoutingFeedbackEvent = {
        timestamp: new Date().toISOString(),
        sessionKey,
        originalModel: activeRoutingDecision.model,
        originalTaskType: activeRoutingDecision.classification.task,
        signal: "model_override",
        overriddenTo: resolvedLabel,
      };
      void appendRoutingFeedback(feedbackEvent).catch(() => {
        // Best-effort logging — do not block the reply path.
      });
    }
  }

  const inlineActionResult = await handleInlineActions({
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    workspaceDir,
    isGroup,
    opts: resolvedOpts,
    typing,
    allowTextCommands,
    inlineStatusRequested,
    command,
    skillCommands,
    directives,
    cleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation: () => defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    resolveDefaultThinkingLevel: modelState.resolveDefaultThinkingLevel,
    provider,
    model,
    contextTokens,
    directiveAck,
    abortedLastRun,
    skillFilter: mergedSkillFilter,
  });
  if (inlineActionResult.kind === "reply") {
    return inlineActionResult.reply;
  }
  directives = inlineActionResult.directives;
  abortedLastRun = inlineActionResult.abortedLastRun ?? abortedLastRun;

  await stageSandboxMedia({
    ctx,
    sessionCtx,
    cfg,
    sessionKey,
    workspaceDir,
  });

  // IRM Phase 3: capture token usage for cost tracking in routing events.
  const usageCapture: UsageCapture = {};

  const reply = await runPreparedReply({
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    agentCfg,
    sessionCfg,
    commandAuthorized,
    command,
    commandSource,
    allowTextCommands,
    directives,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    elevatedEnabled,
    elevatedAllowed,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    modelState,
    provider,
    model,
    perMessageQueueMode,
    perMessageQueueOptions,
    typing,
    opts: resolvedOpts,
    defaultProvider,
    defaultModel,
    timeoutMs,
    isNewSession,
    resetTriggered,
    systemSent,
    sessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    storePath,
    workspaceDir,
    abortedLastRun,
    usageCapture,
    // IRM: when routing is active, inject escalation fallbacks so retries
    // try the next-higher tier before falling back to the normal chain.
    routingEscalationFallbacks:
      activeRoutingDecision && routingConfig
        ? getRoutingEscalationFallbacks(activeRoutingDecision, routingConfig)
        : undefined,
  });

  // IRM Phase 3: log observed routing event with real token counts and cost.
  if (activeRoutingDecision && routingConfig?.enabled) {
    const hasReply = reply !== undefined && reply !== null;
    const inputTokens = usageCapture.input ?? 0;
    const outputTokens = usageCapture.output ?? 0;

    // Calculate actual cost using the catalogue's per-MTok pricing.
    const catalogueEntry = getCatalogueEntry(activeRoutingDecision.model);
    const actualCost = catalogueEntry
      ? (inputTokens * catalogueEntry.cost.inputPerMTok +
          outputTokens * catalogueEntry.cost.outputPerMTok) /
        1_000_000
      : undefined;

    // Estimate savings vs frontier. Clamp to zero — if the routed model
    // is more expensive (stale pricing, unusual token mix), don't report
    // negative savings which would confuse the stats display.
    const frontierModel = routingConfig.tiers?.frontier?.model;
    let savedCost: number | undefined;
    let wouldHaveUsedModel: string | undefined;
    if (frontierModel && activeRoutingDecision.tier !== "frontier" && actualCost !== undefined) {
      const frontierEntry = getCatalogueEntry(frontierModel);
      if (frontierEntry) {
        const frontierCost =
          (inputTokens * frontierEntry.cost.inputPerMTok +
            outputTokens * frontierEntry.cost.outputPerMTok) /
          1_000_000;
        savedCost = Math.max(0, frontierCost - actualCost);
        wouldHaveUsedModel = frontierModel;
      }
    }

    // Phase 4: detect fallback → set retried/escalated flags.
    const retried = usageCapture.fallbackOccurred === true;
    let escalated = false;
    if (retried && usageCapture.fallbackModel && routingConfig.tiers) {
      // Check if the fallback model belongs to a higher tier than the originally routed tier.
      // TIER_PRIORITY is ordered highest-capability-first: ["frontier", "mid", "cheap"].
      // A lower index = higher tier. Escalation means fallback landed on a higher tier.
      const routedTier = activeRoutingDecision.tier;
      const fallbackModelRef = usageCapture.fallbackModel;
      const routedIdx = TIER_PRIORITY.indexOf(routedTier);
      let fallbackIdx = -1;
      const tierEntries = routingConfig?.tiers ?? {};
      for (const [name, tc] of Object.entries(tierEntries)) {
        if (tc?.model === fallbackModelRef || fallbackModelRef?.endsWith(`/${tc?.model}`)) {
          fallbackIdx = TIER_PRIORITY.indexOf(name);
          break;
        }
      }
      // Escalated if the fallback tier has a lower index (= higher capability) than the routed tier.
      escalated = fallbackIdx !== -1 && routedIdx !== -1 && fallbackIdx < routedIdx;
    }

    const event: RoutingEvent = {
      timestamp: new Date().toISOString(),
      model: activeRoutingDecision.model,
      taskType: activeRoutingDecision.classification.task,
      success: hasReply,
      retried,
      escalated,
      // latencyMs: total round-trip (routing decision through reply completion).
      // routingLatencyMs: time spent in classification + scoring only.
      latencyMs: Date.now() - replyStartMs,
      inputTokens,
      outputTokens,
      actualCost,
      savedCost,
      wouldHaveUsedModel,
      routingLatencyMs: routingDecisionMs,
    };
    void appendRoutingEvent(event, undefined, routingConfig?.logging).catch(() => {
      // Best-effort logging — do not block the reply path.
    });

    // Phase 4: log feedback events for retry/escalation.
    if (retried && sessionKey) {
      const feedbackEvent: RoutingFeedbackEvent = {
        timestamp: new Date().toISOString(),
        sessionKey,
        originalModel: activeRoutingDecision.model,
        originalTaskType: activeRoutingDecision.classification.task,
        signal: escalated ? "escalation" : "retry",
        overriddenTo: usageCapture.fallbackModel,
        reason: "fallback triggered during agent run",
      };
      void appendRoutingFeedback(feedbackEvent).catch(() => {
        // Best-effort logging — do not block the reply path.
      });
    }
  }

  // Surface budget warning to the operator when overBudgetAction is "warn".
  if (activeBudgetGate?.warn && activeBudgetGate.reason) {
    defaultRuntime.log("warn", `[routing] ${activeBudgetGate.reason}`);
  }

  return reply;
}
