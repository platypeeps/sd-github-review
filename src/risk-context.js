// Shared risk-context builder. Both the standalone and durable entrypoints
// assemble the same normalized routing context (changed lines, threshold,
// sensitive files, confidence, escalation routes, draft flags) and feed it to
// the route-policy owner. Centralizing the assembly keeps standalone and
// durable parity provable. Entrypoint-specific concerns (command/label/trust
// derivation, the durable policy block, route==="auto" file gating, and
// successor compare) stay at the entrypoints.
import { findSensitiveFiles } from "./path-match.js";
import { normalizeConfidence, normalizeEscalationRoute } from "./normalize.js";

export function buildRiskContext({
  changedLines,
  changedLineThreshold,
  files,
  sensitivePaths,
  confidence,
  lowConfidenceRoute,
  highRiskRoute,
  draft,
  reviewDrafts,
}) {
  return {
    changedLines,
    changedLineThreshold,
    sensitiveFiles: findSensitiveFiles(files, sensitivePaths),
    confidence: normalizeConfidence(confidence),
    lowConfidenceRoute: normalizeEscalationRoute(lowConfidenceRoute, "low-confidence-route"),
    highRiskRoute: normalizeEscalationRoute(highRiskRoute, "high-risk-route"),
    draft,
    reviewDrafts,
  };
}
