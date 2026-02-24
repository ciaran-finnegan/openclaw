/** Task categories recognized by the IRM classifier. */
export type TaskType =
  | "heartbeat"
  | "status"
  | "chat"
  | "writing"
  | "coding"
  | "planning"
  | "tool_use"
  | "sub_agent";

export type ClassificationResult = {
  task: TaskType;
  confidence: number;
};

export type ClassifierContext = {
  isHeartbeat: boolean;
  isSubAgent: boolean;
  requestedTools?: string[];
};

export type TaskRoutingTierConfig = {
  model: string;
  maxComplexity?: number;
};

export type TaskRoutingClassifierConfig = {
  type?: "rules";
  confidenceThreshold?: number;
  fallbackTier?: string;
};

export type TaskRoutingConfig = {
  enabled?: boolean;
  strategy?: "task-aware";
  tiers?: Record<string, TaskRoutingTierConfig>;
  taskMap?: Partial<Record<TaskType, string>>;
  classifier?: TaskRoutingClassifierConfig;
  scorer?: {
    weights?: {
      quality?: number;
      cost?: number;
      speed?: number;
      contextFit?: number;
    };
  };
};

export type RoutingDecision = {
  classification: ClassificationResult;
  tier: string;
  model: string;
  /** Composite score from the model scorer, if available. */
  score?: number;
};
