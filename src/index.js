import { appendFile, readFile } from "node:fs/promises";
import { GitHubClient } from "./github.js";
import {
  findSensitiveFiles,
  isTrustedCommand,
  modeFromLabels,
  normalizeConfidence,
  normalizeMode,
  parseList,
  parseReviewCommand,
  reviewLabels,
  routeReview,
} from "./router.js";

function input(name, fallback = "") {
  return process.env[`INPUT_${name.toUpperCase().replace(/ /gu, "_")}`] ?? fallback;
}

function booleanInput(name, fallback = false) {
  const value = input(name, String(fallback)).trim().toLowerCase();
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function positiveIntegerInput(name, fallback) {
  const value = Number.parseInt(input(name, String(fallback)), 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `sd_review_${crypto.randomUUID()}`;
  await appendFile(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function writeSummary({ pullRequestNumber, route, reason, changedLines, sensitiveFiles, copilotRequested }) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const summary = [
    "### AI review route",
    "",
    `- Pull request: #${pullRequestNumber}`,
    `- Route: \`${route}\``,
    `- Reason: ${reason}`,
    `- Changed lines: ${changedLines}`,
    `- Sensitive files: ${sensitiveFiles.length}`,
    `- Copilot requested: ${copilotRequested}`,
    "",
  ].join("\n");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

function annotationEscape(value) {
  return String(value).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const configuredMode = normalizeMode(input("mode", "auto"));
  const confidence = normalizeConfidence(input("confidence", "unknown"));
  const lowConfidenceRoute = normalizeMode(input("low-confidence-route", "deep"), "low-confidence-route");
  if (!new Set(["deep", "copilot"]).has(lowConfidenceRoute)) {
    throw new Error("low-confidence-route must be deep or copilot");
  }

  const pullRequestNumber = Number.parseInt(
    input("pr-number") || String(event.pull_request?.number ?? event.issue?.number ?? ""),
    10,
  );
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("could not infer a pull request number; set pr-number explicitly");
  }

  const client = new GitHubClient({
    token: input("github-token"),
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
  });
  const pullRequest = event.pull_request ?? (await client.getPullRequest(pullRequestNumber));
  const labels = pullRequest.labels ?? event.issue?.labels ?? [];
  const labelMode = modeFromLabels(labels);
  const rawCommand = eventName === "issue_comment" ? parseReviewCommand(event.comment?.body) : null;
  const trustedAssociations = new Set(
    parseList(input("trusted-associations", "OWNER,MEMBER,COLLABORATOR")).map((value) => value.toUpperCase()),
  );
  const commandIsTrusted = rawCommand
    ? isTrustedCommand({
        association: event.comment?.author_association,
        commenter: event.comment?.user?.login,
        pullRequestAuthor: pullRequest.user?.login,
        trustedAssociations,
        allowPullRequestAuthor: booleanInput("allow-pr-author-commands", false),
      })
    : false;
  const commandMode = commandIsTrusted ? rawCommand : null;
  const changedLines = Number(pullRequest.additions ?? 0) + Number(pullRequest.deletions ?? 0);
  const patterns = parseList(input("sensitive-paths"));
  const files = await client.listPullRequestFiles(pullRequestNumber);
  const sensitiveFiles = findSensitiveFiles(files, patterns);
  const eventLabel = String(event.label?.name ?? "").toLowerCase();
  const decision = routeReview({
    configuredMode,
    labelMode,
    commandMode,
    eventName,
    eventAction: event.action,
    isRelevantLabelEvent: reviewLabels.has(eventLabel),
    draft: Boolean(pullRequest.draft),
    reviewDrafts: booleanInput("review-drafts", false),
    changedLines,
    changedLineThreshold: positiveIntegerInput("changed-line-threshold", 800),
    sensitiveFiles,
    confidence,
    lowConfidenceRoute,
  });

  let copilotRequested = false;
  if (decision.route === "copilot" && booleanInput("request-copilot", true)) {
    const reviewer = input("copilot-reviewer", "copilot-pull-request-reviewer[bot]");
    const requested = await client.getRequestedReviewers(pullRequestNumber);
    const alreadyRequested = requested.users?.some((user) => user.login === reviewer);
    if (!alreadyRequested) {
      await client.requestReviewer(pullRequestNumber, reviewer);
      copilotRequested = true;
    }
  }

  const model =
    decision.route === "cheap"
      ? input("cheap-model")
      : decision.route === "deep"
        ? input("deep-model")
        : "";
  const outputs = {
    route: decision.route,
    reason: decision.reason,
    model,
    "pull-request-number": String(pullRequestNumber),
    "changed-lines": String(changedLines),
    "sensitive-files": JSON.stringify(sensitiveFiles),
    "run-external-reviewer": String(decision.route === "cheap" || decision.route === "deep"),
    "copilot-requested": String(copilotRequested),
  };
  await Promise.all(Object.entries(outputs).map(([name, value]) => writeOutput(name, value)));
  await writeSummary({ pullRequestNumber, ...decision, changedLines, sensitiveFiles, copilotRequested });
  console.log(`Selected ${decision.route} for PR #${pullRequestNumber}: ${decision.reason}`);
}

main().catch((error) => {
  console.error(`::error::${annotationEscape(error.stack ?? error.message)}`);
  process.exitCode = 1;
});
