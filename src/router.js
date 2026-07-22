const MODES = new Set(["auto", "cheap", "deep", "copilot", "none"]);
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

export function globToRegExp(pattern) {
  let normalized = String(pattern).trim().replace(/^\.\//u, "").replace(/^\//u, "");
  if (!normalized) {
    throw new Error("sensitive path patterns cannot be empty");
  }

  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "u");
}

export function findSensitiveFiles(files, patterns) {
  const matchers = patterns.map(globToRegExp);
  return files.filter((file) => matchers.some((matcher) => matcher.test(file)));
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

export function routeReview({
  configuredMode,
  labelMode,
  commandMode,
  eventName,
  eventAction,
  isRelevantLabelEvent = true,
  draft,
  reviewDrafts,
  changedLines,
  changedLineThreshold,
  sensitiveFiles,
  confidence,
  lowConfidenceRoute,
}) {
  if (eventName === "issue_comment" && !commandMode) {
    return { route: "none", reason: "comment did not contain a trusted review command" };
  }
  if (eventName === "pull_request" && eventAction === "labeled" && !isRelevantLabelEvent) {
    return { route: "none", reason: "label event was unrelated to review routing" };
  }

  const explicitMode = configuredMode !== "auto" ? configuredMode : commandMode ?? labelMode;
  if (explicitMode && explicitMode !== "auto") {
    return { route: explicitMode, reason: `explicit ${explicitMode} route selected` };
  }
  if (draft && !reviewDrafts) {
    return { route: "none", reason: "draft pull requests are disabled" };
  }
  if (sensitiveFiles.length > 0) {
    return {
      route: "copilot",
      reason: `${sensitiveFiles.length} sensitive file${sensitiveFiles.length === 1 ? "" : "s"} changed`,
    };
  }
  if (changedLines >= changedLineThreshold) {
    return {
      route: "copilot",
      reason: `${changedLines} changed lines met the ${changedLineThreshold} line threshold`,
    };
  }
  if (confidence === "low") {
    return { route: lowConfidenceRoute, reason: `earlier reviewer confidence was low` };
  }
  return { route: "cheap", reason: "routine pull request within configured risk limits" };
}

export const reviewLabels = new Set(["review:auto", ...EXPLICIT_LABELS.keys()]);
