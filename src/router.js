// Route-policy owner. Holds the pure automatic routing decision (routeReview)
// and the versioned route-selection policy (selectProtocolRoute + floors,
// local-evidence, and successor handling). Canonicalizers/parsers live in
// normalize.js; path matching in path-match.js; versioned decoding in
// protocol.js. This module imports the protocol decode seam
// (decodeRoutingInputs) but no codec internals, keeping the one-way edge
// router -> protocol.
import {
  ignoredEventDecision,
  normalizeMode,
  resolveExplicitMode,
} from "./normalize.js";
import { decodeRoutingInputs } from "./protocol.js";

const ROUTE_STRENGTH = new Map([
  ["none", 0],
  ["cheap", 1],
  ["deep", 2],
  ["copilot", 3],
]);

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
  highRiskRoute = "copilot",
  confidence,
  lowConfidenceRoute,
}) {
  const ignoredDecision = ignoredEventDecision({
    eventName,
    eventAction,
    isRelevantLabelEvent,
    commandMode,
  });
  if (ignoredDecision) return ignoredDecision;

  const explicitMode = resolveExplicitMode({ configuredMode, commandMode, labelMode });
  if (explicitMode) {
    return { route: explicitMode, reason: `explicit ${explicitMode} route selected` };
  }
  if (draft && !reviewDrafts) {
    return { route: "none", reason: "draft pull requests are disabled" };
  }
  if (sensitiveFiles.length > 0) {
    return {
      route: highRiskRoute,
      reason: `${sensitiveFiles.length} sensitive file${sensitiveFiles.length === 1 ? "" : "s"} changed`,
    };
  }
  if (changedLines >= changedLineThreshold) {
    return {
      route: highRiskRoute,
      reason: `${changedLines} changed lines met the ${changedLineThreshold} line threshold`,
    };
  }
  if (confidence === "low") {
    return { route: lowConfidenceRoute, reason: `earlier reviewer confidence was low` };
  }
  return { route: "cheap", reason: "routine pull request within configured risk limits" };
}

function resolvedRoute(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const route = normalizeMode(value, field);
  if (route === "auto") throw new Error(`${field} must be a resolved route`);
  return route;
}

function weakerRoute(left, right) {
  return ROUTE_STRENGTH.get(left) <= ROUTE_STRENGTH.get(right) ? left : right;
}

function strongerRoute(left, right) {
  return ROUTE_STRENGTH.get(left) >= ROUTE_STRENGTH.get(right) ? left : right;
}

function successorMatchesRequest(evidence, request) {
  if (!request.supersedes) {
    throw new Error("successorEvidence requires request.supersedes");
  }
  if (evidence.priorReceiptId !== request.supersedes.priorReceiptId) {
    throw new Error("successorEvidence.priorReceiptId must match request.supersedes");
  }
  if (evidence.priorLogicalDispatchId !== request.supersedes.priorLogicalDispatchId) {
    throw new Error("successorEvidence.priorLogicalDispatchId must match request.supersedes");
  }
  if (evidence.priorHeadSha !== request.supersedes.priorHeadSha) {
    throw new Error("successorEvidence.priorHeadSha must match request.supersedes");
  }
  if (evidence.currentHeadSha !== request.headSha) {
    throw new Error("successorEvidence.currentHeadSha must match request.headSha");
  }
}

export function selectProtocolRoute(inputs) {
  const {
    request,
    sensitiveFiles,
    changedLines,
    changedLineThreshold,
    confidence,
    lowConfidenceRoute,
    highRiskRoute,
    draft,
    reviewDrafts,
    allowBookkeepingNone,
    localConfidenceThreshold,
    successorEvidence: decodedSuccessorEvidence,
    independentReviewFloor,
    localEvidenceRoute,
  } = decodeRoutingInputs(inputs);

  const baseDecision = routeReview({
    configuredMode: request.route,
    labelMode: null,
    commandMode: null,
    eventName: "workflow_dispatch",
    eventAction: "requested",
    draft,
    reviewDrafts,
    changedLines,
    changedLineThreshold,
    sensitiveFiles,
    highRiskRoute,
    confidence,
    lowConfidenceRoute,
  });

  if (request.route !== "auto") {
    return {
      ...baseDecision,
      policyVersion: request.policyVersion,
      floorApplied: null,
      localEvidence: request.localReview ? "ignored-explicit" : "absent",
      successorEvidence: decodedSuccessorEvidence ? "ignored-explicit" : "absent",
    };
  }

  const configuredFloor = resolvedRoute(
    independentReviewFloor ?? "none",
    "policy.independentReviewFloor",
  );
  const riskFloor = sensitiveFiles.length > 0 || changedLines >= changedLineThreshold
    ? highRiskRoute
    : "none";
  const floor = strongerRoute(configuredFloor, riskFloor);
  let route = baseDecision.route;
  const reasons = [baseDecision.reason];
  let localEvidence = request.localReview ? "ineligible" : "absent";
  let successorEvidence = decodedSuccessorEvidence ? "ineligible" : "absent";

  if (request.localReview) {
    const threshold = localConfidenceThreshold;
    const eligible = ["clean", "fully-dispositioned"].includes(request.localReview.outcome)
      && request.localReview.confidence >= threshold
      && request.localReview.dispositionCounts.unresolved === 0;
    if (eligible) {
      const target = resolvedRoute(
        localEvidenceRoute ?? "cheap",
        "policy.localEvidenceRoute",
      );
      const reduced = weakerRoute(route, target);
      localEvidence = reduced === route ? "unchanged" : "lowered";
      route = reduced;
      reasons.push(
        localEvidence === "lowered"
          ? `eligible exact-head local evidence lowered auto to ${route}`
          : "eligible exact-head local evidence did not lower the automatic route",
      );
    } else {
      reasons.push("local evidence supplied no positive routing confidence");
    }
  }

  if (decodedSuccessorEvidence) {
    successorMatchesRequest(decodedSuccessorEvidence, request);
    if (decodedSuccessorEvidence.comparison === "bookkeeping-only" && allowBookkeepingNone) {
      route = weakerRoute(route, "none");
      successorEvidence = "lowered";
      reasons.push("trusted bookkeeping-only successor evidence selected none");
    } else {
      successorEvidence = "unchanged";
      reasons.push("successor evidence did not qualify for a lower route");
    }
  }

  const beforeFloor = route;
  route = strongerRoute(route, floor);
  const floorApplied = route === beforeFloor ? null : floor;
  if (floorApplied) {
    reasons.push(`review floor required ${floorApplied}`);
  }
  return {
    route,
    reason: reasons.join("; "),
    policyVersion: request.policyVersion,
    floorApplied,
    localEvidence,
    successorEvidence,
  };
}
