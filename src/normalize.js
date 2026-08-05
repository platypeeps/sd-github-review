// Value canonicalizers and input parsers. These validate and normalize caller
// mode/route/confidence values, review labels, and comment commands. They are
// canonicalization, not routing policy, so both the versioned protocol codecs
// and the route-policy owner can consume them without a policy dependency.
// Leaf module: no local imports.

const MODES = new Set(["auto", "cheap", "deep", "copilot", "none"]);
const ESCALATION_ROUTES = new Set(["deep", "copilot"]);
const CONFIDENCE_LEVELS = new Set(["unknown", "high", "medium", "low"]);
const EXPLICIT_LABELS = new Map([
  ["review:cheap", "cheap"],
  ["review:deep", "deep"],
  ["review:copilot", "copilot"],
  ["review:none", "none"],
]);

export function normalizeMode(value, field = "mode") {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!MODES.has(mode)) {
    throw new Error(`${field} must be one of: ${[...MODES].join(", ")}`);
  }
  return mode;
}

export function normalizeEscalationRoute(value, field) {
  const route = String(value ?? "").trim().toLowerCase();
  if (!ESCALATION_ROUTES.has(route)) {
    throw new Error(`${field} must be deep or copilot`);
  }
  return route;
}

export function normalizeConfidence(value) {
  const confidence = String(value ?? "unknown").trim().toLowerCase();
  if (!CONFIDENCE_LEVELS.has(confidence)) {
    throw new Error("confidence must be one of: unknown, high, medium, low");
  }
  return confidence;
}

export function parseList(value) {
  return String(value ?? "")
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseReviewCommand(body) {
  const match = String(body ?? "").match(/^\s*\/review\s+(auto|cheap|deep|copilot|none)\s*$/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

export function modeFromLabels(labels) {
  const selected = new Set(
    labels
      .map((label) => (typeof label === "string" ? label : label?.name))
      .map((label) => String(label ?? "").toLowerCase())
      .filter((label) => EXPLICIT_LABELS.has(label))
      .map((label) => EXPLICIT_LABELS.get(label)),
  );

  if (selected.size > 1) {
    throw new Error(`conflicting review labels select multiple routes: ${[...selected].join(", ")}`);
  }
  return [...selected][0] ?? null;
}

export function isTrustedCommand({
  association,
  commenter,
  pullRequestAuthor,
  trustedAssociations,
  allowPullRequestAuthor,
}) {
  if (allowPullRequestAuthor && commenter && commenter === pullRequestAuthor) {
    return true;
  }
  return trustedAssociations.has(String(association ?? "").toUpperCase());
}

export function ignoredEventDecision({
  eventName,
  eventAction,
  isRelevantLabelEvent = true,
  commandMode,
}) {
  if (eventName === "issue_comment" && !commandMode) {
    return { route: "none", reason: "comment did not contain a trusted review command" };
  }
  if (eventName === "pull_request" && eventAction === "labeled" && !isRelevantLabelEvent) {
    return { route: "none", reason: "label event was unrelated to review routing" };
  }
  return null;
}

export function resolveExplicitMode({ configuredMode, commandMode, labelMode }) {
  const explicitMode = configuredMode !== "auto" ? configuredMode : commandMode ?? labelMode;
  return explicitMode && explicitMode !== "auto" ? explicitMode : null;
}

// Canonical review-label registry. Kept module-private so importers cannot
// mutate it and silently repoint label routing for the whole process (A-020).
const reviewLabelSet = new Set(["review:auto", ...EXPLICIT_LABELS.keys()]);

export function isReviewLabel(label) {
  return reviewLabelSet.has(label);
}

// Read-only view for callers that must enumerate the label names (e.g. the
// installer↔router parity check). Strings are immutable; freezing the array
// blocks add/reorder, so no mutable collection escapes the module.
export const reviewLabelNames = Object.freeze([...reviewLabelSet]);
