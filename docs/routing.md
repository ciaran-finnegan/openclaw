---
title: "Intelligent Routing"
description: "Cost-optimised model selection for multi-task AI agents"
---

# Intelligent Routing

## Overview

Intelligent Routing (IRM) classifies each incoming request by task type and routes it to the cheapest model tier configured for that category. This reduces cost for simple tasks (chat, status checks) while preserving access to frontier models for complex work (coding, planning).

Routing is **opt-in** and disabled by default. When disabled, all requests use the agent default model.

The routing pipeline runs in this order:

1. **Budget gate** blocks the request entirely if the budget is exceeded (with `block` action)
2. **Classify** the message into one of 8 task categories
3. **Budget gate** downgrades the tier if spending exceeds configured thresholds
4. **Estimate complexity** and upgrade the tier if the message exceeds the tier ceiling (respecting any budget cap)
5. **Score** the selected model using a three-layer data system (catalogue, profile, observed)
6. **Check allowlist** (in the calling pipeline) to verify the selected model is in the provider config

## Quick Start

Add a `routing` block to your agent defaults in `openclaw.yaml`:

```yaml
agents:
  defaults:
    routing:
      enabled: true
      tiers:
        cheap:
          model: anthropic/claude-haiku-4-5
        mid:
          model: anthropic/claude-sonnet-4-6
        frontier:
          model: anthropic/claude-opus-4-6
```

### Mixed-provider setup

```yaml
agents:
  defaults:
    routing:
      enabled: true
      tiers:
        cheap:
          model: openai/gpt-4o-mini
        mid:
          model: anthropic/claude-sonnet-4-6
        frontier:
          model: anthropic/claude-opus-4-6
```

### Local + cloud hybrid

```yaml
agents:
  defaults:
    routing:
      enabled: true
      tiers:
        cheap:
          model: ollama/llama3
        mid:
          model: anthropic/claude-sonnet-4-6
        frontier:
          model: anthropic/claude-opus-4-6
```

## Configuration Reference

All routing configuration lives under `agents.defaults.routing`.

| Field            | Type                         | Default        | Description                                               |
| ---------------- | ---------------------------- | -------------- | --------------------------------------------------------- |
| `enabled`        | `boolean`                    | `false`        | Enable intelligent routing                                |
| `strategy`       | `"task-aware"`               | `"task-aware"` | Routing strategy (only task-aware is currently supported) |
| `tiers`          | `Record<string, TierConfig>` | -              | Map of tier names to model configurations                 |
| `taskMap`        | `Record<TaskType, string>`   | See below      | Override default task-to-tier mappings                    |
| `classifier`     | `ClassifierConfig`           | -              | Classifier settings                                       |
| `scorer.weights` | `WeightsConfig`              | See below      | Scoring weight overrides                                  |
| `budget`         | `BudgetConfig`               | -              | Budget controls                                           |

### Tier configuration

Each tier entry:

| Field           | Type           | Default    | Description                                                |
| --------------- | -------------- | ---------- | ---------------------------------------------------------- |
| `model`         | `string`       | _required_ | Model identifier (e.g. `anthropic/claude-haiku-4-5`)       |
| `maxComplexity` | `number (0-1)` | -          | Maximum complexity score before upgrading to the next tier |

### Classifier configuration

| Field                 | Type           | Default   | Description                                    |
| --------------------- | -------------- | --------- | ---------------------------------------------- |
| `type`                | `"rules"`      | `"rules"` | Classifier type                                |
| `confidenceThreshold` | `number (0-1)` | `0`       | Minimum confidence to trust classification     |
| `fallbackTier`        | `string`       | -         | Tier to use when confidence is below threshold |

### Scorer weights

| Field        | Type     | Default | Description                   |
| ------------ | -------- | ------- | ----------------------------- |
| `quality`    | `number` | `0.5`   | Weight for task quality score |
| `cost`       | `number` | `0.3`   | Weight for cost efficiency    |
| `speed`      | `number` | `0.15`  | Weight for latency            |
| `contextFit` | `number` | `0.05`  | Weight for context window fit |

### Budget configuration

| Field              | Type                               | Default       | Description                    |
| ------------------ | ---------------------------------- | ------------- | ------------------------------ |
| `enabled`          | `boolean`                          | `false`       | Enable budget tracking         |
| `dailyLimit`       | `number`                           | -             | Maximum daily spend in USD     |
| `monthlyLimit`     | `number`                           | -             | Maximum monthly spend in USD   |
| `overBudgetAction` | `"downgrade" \| "block" \| "warn"` | `"downgrade"` | Action when budget is exceeded |

## Task Categories

The rules-based classifier recognises 8 task types:

| Task Type   | Detection Signals                              | Default Tier |
| ----------- | ---------------------------------------------- | ------------ |
| `heartbeat` | Heartbeat context flag                         | cheap        |
| `status`    | Status/health/version keywords + short message | cheap        |
| `chat`      | Default fallback for general conversation      | cheap        |
| `writing`   | Write/draft/compose/translate keywords         | mid          |
| `coding`    | Code keywords, syntax patterns, code blocks    | frontier     |
| `planning`  | 500+ words or 3+ list items                    | frontier     |
| `tool_use`  | Requested tools in context                     | frontier     |
| `sub_agent` | Sub-agent context flag                         | mid          |

Classification priority runs top to bottom. Each classification includes a confidence score (0-1).

Override default mappings with `taskMap`:

```yaml
routing:
  taskMap:
    chat: mid # Use mid tier for chat instead of cheap
    writing: frontier # Use frontier for writing tasks
```

## Model Catalogue

The scorer uses three layers of data to evaluate models:

1. **Community catalogue** - Shipped benchmark scores for known models. Updated with each release.
2. **Local profiles** - Generated by running benchmark prompts against your models locally.
3. **Observed performance** - Accumulated from actual routing events over time.

### Blending formula

| Data available                    | Blend                                    |
| --------------------------------- | ---------------------------------------- |
| Catalogue only                    | 100% catalogue                           |
| Catalogue + profile               | 50% catalogue, 50% profile               |
| Catalogue + observed (50+ events) | 30% catalogue, 70% observed              |
| All three layers                  | 20% catalogue, 20% profile, 60% observed |

View the catalogue:

```bash
openclaw routing catalogue
openclaw routing catalogue --provider anthropic
```

Profile a local model:

```bash
openclaw routing profile ollama/llama3
```

## Budget Controls

The budget gate applies progressive restrictions as spending approaches limits:

| Budget Used | Band        | Effect                                 |
| ----------- | ----------- | -------------------------------------- |
| 0-75%       | normal      | No restrictions                        |
| 75-90%      | mid-only    | Frontier tier blocked, max tier is mid |
| 90-100%     | cheap-only  | Only cheap tier allowed                |
| 100%+       | over-budget | Depends on `overBudgetAction`          |

### Over-budget actions

- **downgrade** (default): Force cheapest tier for all requests
- **block**: Reject the request (routing returns null; the caller decides how to handle it)
- **warn**: Allow routing to proceed; sets a warning flag the caller can surface to the user

Both `dailyLimit` and `monthlyLimit` are checked; the tighter constraint wins.

```yaml
routing:
  budget:
    enabled: true
    dailyLimit: 10.00
    monthlyLimit: 200.00
    overBudgetAction: downgrade
```

## Quality Safeguards

### Confidence threshold

When the classifier is uncertain about a message, you can fall back to a safer tier:

```yaml
routing:
  classifier:
    confidenceThreshold: 0.75
    fallbackTier: mid
```

If classification confidence is below 0.75, the request routes to the `mid` tier instead of the default for that task type.

### Complexity estimator

Each tier can set a `maxComplexity` ceiling. When a message exceeds it, the router upgrades to the next tier:

```yaml
routing:
  tiers:
    cheap:
      model: anthropic/claude-haiku-4-5
      maxComplexity: 0.15
    mid:
      model: anthropic/claude-sonnet-4-6
      maxComplexity: 0.5
    frontier:
      model: anthropic/claude-opus-4-6
```

Complexity is estimated from word count, multi-step instructions (lists, sequencing language), tool count, and attachments. The score ranges from 0.0 to 1.0.

Budget gates take precedence: if budget restricts to cheap, complexity cannot upgrade past cheap.

### Allowlist enforcement

Routing never introduces a model the user has not configured API access for. If `models.providers` lists specific models, routing checks the selected model against the allowlist. See [Model Providers](/concepts/model-providers) for provider configuration.

### Escalation detection

Routing events track `retried` and `escalated` flags. These feed back into the observed performance data, lowering the effective score for models that frequently need retries or escalations.

## Feedback Loop

### What gets logged

- **Routing events** (`routing/observed.jsonl`): Every routing decision with model, task type, cost, latency, retry/escalation flags
- **Feedback events** (`routing/feedback.jsonl`): Model overrides, retries, escalations, user re-asks

### How feedback improves routing

Observed performance accumulates over time and blends into the scorer. Models with high retry or escalation rates receive lower effective scores, which reduces their composite score in future scoring calls.

## CLI Commands

| Command                             | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| `openclaw routing catalogue`        | Display model catalogue with benchmark scores |
| `openclaw routing profile <model>`  | Run benchmark prompts against a model         |
| `openclaw routing suggest-tiers`    | Suggest optimal tier-to-model mappings        |
| `openclaw routing stats`            | Show routing cost summary and savings         |
| `openclaw routing log`              | Show recent routing decisions                 |
| `openclaw routing feedback`         | Show recent feedback events                   |
| `openclaw routing update-catalogue` | Validate shipped benchmark catalogue          |

Common options:

- `--json`: Output machine-readable JSON
- `--provider <name>`: Filter by provider (catalogue command)
- `--tail <n>`: Number of recent events (log and feedback commands)
- `--detailed`: Per-task and per-model breakdown (stats command)

## Example Configurations

### Simple two-tier setup

```yaml
agents:
  defaults:
    routing:
      enabled: true
      tiers:
        cheap:
          model: anthropic/claude-haiku-4-5
        frontier:
          model: anthropic/claude-opus-4-6
      taskMap:
        writing: frontier
        sub_agent: cheap
```

### With budget controls

```yaml
agents:
  defaults:
    routing:
      enabled: true
      tiers:
        cheap:
          model: anthropic/claude-haiku-4-5
        mid:
          model: anthropic/claude-sonnet-4-6
        frontier:
          model: anthropic/claude-opus-4-6
      budget:
        enabled: true
        dailyLimit: 15.00
        monthlyLimit: 300.00
        overBudgetAction: downgrade
```

### Strict quality settings

```yaml
agents:
  defaults:
    routing:
      enabled: true
      tiers:
        cheap:
          model: anthropic/claude-haiku-4-5
          maxComplexity: 0.1
        mid:
          model: anthropic/claude-sonnet-4-6
          maxComplexity: 0.4
        frontier:
          model: anthropic/claude-opus-4-6
      classifier:
        confidenceThreshold: 0.8
        fallbackTier: frontier
      budget:
        enabled: true
        monthlyLimit: 500.00
        overBudgetAction: warn
```
