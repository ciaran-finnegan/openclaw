import type { OpenClawConfig } from "../config/config.js";

/**
 * Check whether a routed model ref (e.g. "anthropic/claude-haiku-4-5") exists
 * in the user's configured provider models.
 *
 * This is a safety check to ensure routing never introduces a model the user
 * hasn't set up API access for. Returns true if:
 * - No providers are configured (nothing to check against)
 * - The provider isn't in the config (we can't verify; allow by default)
 * - The model ID is found in the provider's models array
 */
export function isModelAllowed(modelRef: string, config: OpenClawConfig): boolean {
  const providers = config.models?.providers;
  if (!providers) {
    // No provider config at all — nothing to check against, allow everything.
    return true;
  }

  // Parse "provider/model" format. Tier config should always use "provider/model"
  // format, but if it doesn't, we can't match against a specific provider's allowlist.
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx === -1) {
    return true;
  }

  const providerName = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  const providerConfig = providers[providerName];
  if (!providerConfig) {
    // Provider not in user config — can't verify, allow by default.
    return true;
  }

  // If the provider has no models list, it's an open-ended config (e.g. Ollama).
  if (!providerConfig.models || providerConfig.models.length === 0) {
    return true;
  }

  return providerConfig.models.some((m) => m.id === modelId);
}
