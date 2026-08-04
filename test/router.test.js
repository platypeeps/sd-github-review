import assert from "node:assert/strict";
import test from "node:test";
import { findSensitiveFiles } from "../src/path-match.js";
import {
  ignoredEventDecision,
  isTrustedCommand,
  modeFromLabels,
  normalizeEscalationRoute,
  parseReviewCommand,
  resolveExplicitMode,
} from "../src/normalize.js";
import { routeReview } from "../src/router.js";

const base = {
  configuredMode: "auto",
  labelMode: null,
  commandMode: null,
  eventName: "pull_request",
  eventAction: "opened",
  draft: false,
  reviewDrafts: false,
  changedLines: 100,
  changedLineThreshold: 800,
  sensitiveFiles: [],
  highRiskRoute: "copilot",
  confidence: "unknown",
  lowConfidenceRoute: "deep",
};

test("routes a routine pull request to the cheap reviewer", () => {
  assert.deepEqual(routeReview(base), {
    route: "cheap",
    reason: "routine pull request within configured risk limits",
  });
});

test("routes sensitive paths to Copilot", () => {
  const decision = routeReview({ ...base, sensitiveFiles: ["src/auth/session.ts"] });
  assert.equal(decision.route, "copilot");
  assert.match(decision.reason, /sensitive file/u);
});

test("routes sensitive paths to the configured deep reviewer", () => {
  const decision = routeReview({
    ...base,
    sensitiveFiles: ["src/auth/session.ts"],
    highRiskRoute: "deep",
  });
  assert.equal(decision.route, "deep");
  assert.match(decision.reason, /sensitive file/u);
});

test("routes a large pull request to Copilot", () => {
  assert.equal(routeReview({ ...base, changedLines: 799 }).route, "cheap");
  assert.equal(routeReview({ ...base, changedLines: 800 }).route, "copilot");
  assert.equal(
    routeReview({ ...base, changedLines: 800, highRiskRoute: "deep" }).route,
    "deep",
  );
});

test("routes low confidence to the configured escalation", () => {
  assert.equal(routeReview({ ...base, confidence: "low" }).route, "deep");
  assert.equal(routeReview({ ...base, confidence: "low", lowConfidenceRoute: "copilot" }).route, "copilot");
});

test("validates escalation routes through one shared contract", () => {
  assert.equal(normalizeEscalationRoute(" DEEP ", "high-risk-route"), "deep");
  assert.equal(normalizeEscalationRoute("copilot", "low-confidence-route"), "copilot");
  for (const route of ["auto", "cheap", "none", ""]) {
    assert.throws(
      () => normalizeEscalationRoute(route, "high-risk-route"),
      /high-risk-route must be deep or copilot/u,
    );
  }
});

test("explicit commands and labels override automatic risk routing", () => {
  assert.equal(routeReview({ ...base, commandMode: "none", sensitiveFiles: ["src/auth.ts"] }).route, "none");
  assert.equal(routeReview({ ...base, labelMode: "deep", changedLines: 1_000 }).route, "deep");
  assert.equal(
    routeReview({ ...base, commandMode: "copilot", highRiskRoute: "deep" }).route,
    "copilot",
  );
});

test("configured non-auto mode has highest precedence", () => {
  assert.equal(routeReview({ ...base, configuredMode: "cheap", commandMode: "copilot" }).route, "cheap");
});

test("drafts are skipped by default", () => {
  assert.equal(routeReview({ ...base, draft: true }).route, "none");
});

test("unrelated comments and label events do not retrigger a review", () => {
  assert.equal(routeReview({ ...base, eventName: "issue_comment" }).route, "none");
  assert.equal(
    routeReview({ ...base, eventAction: "labeled", isRelevantLabelEvent: false }).route,
    "none",
  );
});

test("parses only exact review commands", () => {
  assert.equal(parseReviewCommand(" /review copilot\n"), "copilot");
  assert.equal(parseReviewCommand("please /review copilot"), null);
  assert.equal(parseReviewCommand("/review copilot now"), null);
});

test("detects conflicting route labels", () => {
  assert.equal(modeFromLabels([{ name: "review:deep" }]), "deep");
  assert.throws(() => modeFromLabels(["review:cheap", "review:copilot"]), /conflicting/u);
});

test("matches documented glob syntax", () => {
  assert.deepEqual(
    findSensitiveFiles(
      ["auth/token.ts", "src/auth/token.ts", "src/billing.ts", "docs/auth.md"],
      ["**/auth/**", "**/billing.*"],
    ),
    ["auth/token.ts", "src/auth/token.ts", "src/billing.ts"],
  );
});

test("trusts repository members and optionally the PR author", () => {
  const args = {
    association: "NONE",
    commenter: "contributor",
    pullRequestAuthor: "contributor",
    trustedAssociations: new Set(["MEMBER"]),
    allowPullRequestAuthor: false,
  };
  assert.equal(isTrustedCommand(args), false);
  assert.equal(isTrustedCommand({ ...args, association: "MEMBER" }), true);
  assert.equal(isTrustedCommand({ ...args, allowPullRequestAuthor: true }), true);
});

test("exposes shared event-gate and explicit-route decisions", () => {
  assert.deepEqual(
    ignoredEventDecision({ eventName: "issue_comment", commandMode: null }),
    { route: "none", reason: "comment did not contain a trusted review command" },
  );
  assert.equal(
    resolveExplicitMode({ configuredMode: "auto", commandMode: "deep", labelMode: "cheap" }),
    "deep",
  );
  assert.equal(
    resolveExplicitMode({ configuredMode: "auto", commandMode: "auto", labelMode: "cheap" }),
    null,
  );
});
