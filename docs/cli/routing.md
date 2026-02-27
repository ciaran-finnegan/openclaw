---
summary: "CLI reference for `openclaw routing` (catalogue, tiers, setup, stats, feedback, observed)"
read_when:
  - You want to inspect or configure task routing tiers
  - You want to view model benchmark scores or performance metrics
  - You want to review routing decisions, cost savings, or feedback events
title: "routing"
---

# `openclaw routing`

Manage task routing and model selection. Inspect the model catalogue, configure
tier mappings, review routing decisions, and monitor cost savings.

Related:

- Routing configuration guide: [Routing](/routing)
- Model providers: [Providers](/providers/models)

## Common commands

```bash
openclaw routing catalogue
openclaw routing tiers
openclaw routing setup
openclaw routing stats
```

## Subcommands

### `routing catalogue`

Display the model catalogue with benchmark scores.

Options:

- `--provider <name>` Filter by provider (e.g. `anthropic`, `openai`, `google`)
- `--json` Output as JSON

### `routing tiers`

Display current tier-to-model mappings. If no tiers are configured, shows
auto-detected suggestions based on your provider config.

Options:

- `--json` Output as JSON

### `routing setup`

Interactive wizard to configure routing tiers. Detects your configured providers,
suggests optimal tier mappings from the model catalogue, and saves the config.

### `routing set <tier> <model>`

Set the model for a specific routing tier.

```bash
openclaw routing set cheap google/gemini-2.5-flash
openclaw routing set mid anthropic/claude-sonnet-4-5
openclaw routing set top anthropic/claude-opus-4
```

Valid tiers: `cheap`, `mid`, `top`.

### `routing suggest-tiers`

Suggest optimal tier-to-model mappings based on catalogue scores and your
configured providers.

Options:

- `--json` Output as JSON

### `routing profile <model>`

Run benchmark prompts against a model and save a local performance profile.
Profiles contribute to the scorer's blended scores alongside catalogue data.

Options:

- `--rerun` Re-profile even if a cached profile exists
- `--judge <model>` Frontier model to use as LLM-as-judge scorer

### `routing stats`

Show routing cost summary and savings over the lookback period.

Options:

- `--json` Output as JSON
- `--detailed` Show per-task-type and per-model breakdown
- `--days <n>` Lookback period in days (default: 30)

### `routing log`

Show recent routing decisions.

Options:

- `--tail <n>` Number of recent events to show (default: 20)
- `--json` Output as JSON

### `routing feedback`

Show recent routing feedback events (overrides, retries, escalations).

Options:

- `--tail <n>` Number of recent events to show (default: 20)
- `--json` Output as JSON

### `routing observed`

Show observed per-model, per-task performance metrics aggregated from routing
events.

Options:

- `--json` Output as JSON
- `--days <n>` Lookback period in days (default: 30)

### `routing update-catalogue`

Validate and display shipped benchmark catalogue info.

Options:

- `--check` Check if a newer catalogue version is available

## Examples

```bash
# View all models in the catalogue
openclaw routing catalogue

# View only Anthropic models as JSON
openclaw routing catalogue --provider anthropic --json

# Check current tier config
openclaw routing tiers

# Set up routing interactively
openclaw routing setup

# Assign a model to the cheap tier
openclaw routing set cheap google/gemini-2.5-flash

# Review last 50 routing decisions
openclaw routing log --tail 50

# Check cost savings over the past week
openclaw routing stats --days 7 --detailed

# View observed model performance
openclaw routing observed --days 14
```
