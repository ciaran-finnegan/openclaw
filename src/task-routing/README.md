# Task Routing (IRM)

Intelligent Routing Module: classifies incoming messages by task type and routes them to the cheapest adequate model tier.

## Architecture

Pipeline order in `resolveTaskRoute()`:

```
                    incoming message
                          │
                          ▼
                  ┌───────────────┐
                  │  Budget Gate   │  block if budget exceeded
                  │  (budget.ts)   │  (pre-check)
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │   Classifier   │  rules-based, 8 task types
                  │ (classifier.ts)│  confidence 0–1
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  Budget Gate   │  downgrade tier if spend
                  │  (budget.ts)   │  exceeds 75%/90%/100%
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  Complexity    │  upgrade tier if message
                  │  Estimator     │  exceeds maxComplexity
                  │(complexity.ts) │  (respects budget cap)
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │    Scorer      │  three-layer blending:
                  │  (scorer.ts)   │  catalogue + profile + observed
                  └───────┬───────┘
                          │
                          ▼
                  RoutingDecision { tier, model, score }
                          │
                          ▼  (checked externally in get-reply.ts)
                  ┌───────────────┐
                  │   Allowlist    │  verifies model is in
                  │ (allowlist.ts) │  provider config
                  └───────────────┘
```

## File Index

| File                                 | Purpose                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| `types.ts`                           | Core types: TaskType, TaskRoutingConfig, RoutingDecision             |
| `classifier.ts`                      | Rules-based task classifier (8 categories)                           |
| `complexity.ts`                      | Message complexity estimator (0-1 scale)                             |
| `allowlist.ts`                       | Model allowlist enforcement against provider config                  |
| `resolve-task-route.ts`              | Main routing function: classifies, scores, applies budget/complexity |
| `index.ts`                           | Public re-exports                                                    |
| `catalogue/types.ts`                 | Catalogue, profile, observed, feedback, and scorer types             |
| `catalogue/catalogue.ts`             | Shipped benchmark catalogue loader and lookup                        |
| `catalogue/benchmark-catalogue.json` | Community benchmark data                                             |
| `catalogue/scorer.ts`                | Three-layer composite scorer                                         |
| `catalogue/profiler.ts`              | Local model profiler                                                 |
| `catalogue/profiler-prompts.ts`      | Benchmark prompts for profiling                                      |
| `catalogue/observed.ts`              | Observed JSONL read/write, feedback events, cost aggregation         |
| `catalogue/budget.ts`                | Progressive budget gate                                              |
| `catalogue/index.ts`                 | Catalogue re-exports                                                 |

### Test Files

| File                          | Coverage                                       |
| ----------------------------- | ---------------------------------------------- |
| `classifier.test.ts`          | Task classification rules                      |
| `complexity.test.ts`          | Complexity signal extraction and scoring       |
| `allowlist.test.ts`           | Allowlist enforcement                          |
| `resolve-task-route.test.ts`  | Routing decisions, budget, complexity upgrades |
| `routing-integration.test.ts` | End-to-end integration tests                   |
| `catalogue/budget.test.ts`    | Budget gate bands and JSONL integration        |
| `catalogue/scorer.test.ts`    | Scorer blending and composite scoring          |
| `catalogue/catalogue.test.ts` | Catalogue lookup and filtering                 |
| `catalogue/observed.test.ts`  | Observed JSONL read/write                      |
| `catalogue/feedback.test.ts`  | Feedback JSONL read/write                      |

## Docs

Full configuration guide: https://docs.openclaw.ai/routing
