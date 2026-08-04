import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GitHubClient } from "./github.js";
import { normalizeOperation, runDurableAction, writeDurableSummary } from "./operations.js";
import { buildRiskContext } from "./risk-context.js";
import { requestCopilotReviewer } from "./reviewer-dispatch.js";
import {
  ignoredEventDecision,
  isTrustedCommand,
  modeFromLabels,
  normalizeMode,
  parseList,
  parseReviewCommand,
  resolveExplicitMode,
  reviewLabels,
} from "./normalize.js";
import { routeReview } from "./router.js";

function input(name, fallback = "", env = process.env) {
  return env[`INPUT_${name.toUpperCase().replace(/ /gu, "_")}`] ?? fallback;
}

function booleanInput(name, fallback = false, env = process.env) {
  const value = input(name, String(fallback), env).trim().toLowerCase();
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function positiveIntegerInput(name, fallback, env = process.env) {
  const value = Number.parseInt(input(name, String(fallback), env), 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

// Decode a pull-request identity as a complete positive decimal. Rejects
// suffixes (`12garbage`), signs, whitespace variants, leading zeros, zero, and
// unsafe integers with a field-specific bounded error. Never trims: a value
// carrying surrounding whitespace is malformed, not sanitizable.
function decodePullRequestNumber(rawValue, fieldName) {
  if (!/^[1-9][0-9]*$/u.test(rawValue) || !Number.isSafeInteger(Number(rawValue))) {
    throw new Error(`${fieldName} must be a complete positive integer`);
  }
  return Number(rawValue);
}

// Bind the event identity and the optional override to one validated PR number
// before any GitHub client is constructed or any output is emitted. A conflict
// between an event-carried identity and a non-matching override is rejected
// rather than silently resolved in the override's favor.
function resolvePullRequestNumber(event, env) {
  const overrideRaw = input("pr-number", "", env);
  const overrideNumber = overrideRaw === "" ? null : decodePullRequestNumber(overrideRaw, "pr-number");
  const eventIdentity = event.pull_request?.number ?? event.issue?.number;
  const eventNumber =
    eventIdentity === undefined || eventIdentity === null
      ? null
      : decodePullRequestNumber(String(eventIdentity), "event pull request number");
  if (overrideNumber !== null && eventNumber !== null && overrideNumber !== eventNumber) {
    throw new Error(`pr-number ${overrideNumber} conflicts with event pull request #${eventNumber}`);
  }
  const pullRequestNumber = overrideNumber ?? eventNumber;
  if (pullRequestNumber === null) {
    throw new Error("could not infer a pull request number; set pr-number explicitly");
  }
  return pullRequestNumber;
}

export async function writeOutput(
  name,
  value,
  { env = process.env, appendFileImpl = appendFile } = {},
) {
  const outputPath = env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `sd_review_${crypto.randomUUID()}`;
  await appendFileImpl(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

export async function writeSummary(
  { pullRequestNumber, route, reason, changedLines, sensitiveFiles, copilotRequested },
  { env = process.env, appendFileImpl = appendFile } = {},
) {
  if (!env.GITHUB_STEP_SUMMARY) return;
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
  await appendFileImpl(env.GITHUB_STEP_SUMMARY, summary);
}

export function annotationEscape(value) {
  return String(value).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

async function emitResult({
  pullRequestNumber,
  decision,
  changedLines,
  sensitiveFiles,
  copilotRequested,
  model,
  outputWriter,
  summaryWriter,
  logger,
}) {
  const outputs = {
    operation: "standalone",
    route: decision.route,
    reason: decision.reason,
    model,
    "pull-request-number": String(pullRequestNumber),
    "changed-lines": String(changedLines),
    "sensitive-files": JSON.stringify(sensitiveFiles),
    "run-external-reviewer": String(decision.route === "cheap" || decision.route === "deep"),
    "copilot-requested": String(copilotRequested),
  };
  for (const [name, value] of Object.entries(outputs)) {
    await outputWriter(name, value);
  }
  await summaryWriter({ pullRequestNumber, ...decision, changedLines, sensitiveFiles, copilotRequested });
  logger(`Selected ${decision.route} for PR #${pullRequestNumber}: ${decision.reason}`);
  return { decision, outputs, changedLines, sensitiveFiles, copilotRequested };
}

export async function runAction({
  event,
  eventName,
  env = process.env,
  clientFactory = (options) => new GitHubClient(options),
  outputWriter,
  summaryWriter,
  logger = (message) => console.log(message),
  now,
  receiptStoreFactory,
}) {
  const emitOutput = outputWriter ?? ((name, value) => writeOutput(name, value, { env }));
  const operation = normalizeOperation(input("operation", "standalone", env));
  if (operation !== "standalone") {
    return runDurableAction({
      operation,
      env,
      clientFactory,
      outputWriter: emitOutput,
      summaryWriter: summaryWriter ?? ((summary) => writeDurableSummary(summary, { env })),
      logger,
      ...(now ? { now } : {}),
      receiptStoreFactory,
    });
  }
  const emitSummary = summaryWriter ?? ((summary) => writeSummary(summary, { env }));
  const configuredMode = normalizeMode(input("mode", "auto", env));

  const pullRequestNumber = resolvePullRequestNumber(event, env);

  const rawCommand = eventName === "issue_comment" ? parseReviewCommand(event.comment?.body) : null;
  const eventLabel = String(event.label?.name ?? "").toLowerCase();
  const preNetworkDecision = ignoredEventDecision({
    eventName,
    eventAction: event.action,
    isRelevantLabelEvent: reviewLabels.has(eventLabel),
    commandMode: rawCommand,
  });
  if (preNetworkDecision) {
    const changedLines =
      Number(event.pull_request?.additions ?? 0) + Number(event.pull_request?.deletions ?? 0);
    return emitResult({
      pullRequestNumber,
      decision: preNetworkDecision,
      changedLines,
      sensitiveFiles: [],
      copilotRequested: false,
      model: "",
      outputWriter: emitOutput,
      summaryWriter: emitSummary,
      logger,
    });
  }

  let client;
  const getClient = () => {
    client ??= clientFactory({
      token: input("github-token", "", env),
      repository: env.GITHUB_REPOSITORY,
      apiUrl: env.GITHUB_API_URL,
    });
    return client;
  };
  const pullRequest = event.pull_request ?? (await getClient().getPullRequest(pullRequestNumber));
  const labels = pullRequest.labels ?? event.issue?.labels ?? [];
  const labelMode = modeFromLabels(labels);
  const trustedAssociations = new Set(
    parseList(input("trusted-associations", "OWNER,MEMBER,COLLABORATOR", env)).map((value) =>
      value.toUpperCase(),
    ),
  );
  const commandIsTrusted = rawCommand
    ? isTrustedCommand({
        association: event.comment?.author_association,
        commenter: event.comment?.user?.login,
        pullRequestAuthor: pullRequest.user?.login,
        trustedAssociations,
        allowPullRequestAuthor: booleanInput("allow-pr-author-commands", false, env),
      })
    : false;
  const commandMode = commandIsTrusted ? rawCommand : null;
  const changedLines = Number(pullRequest.additions ?? 0) + Number(pullRequest.deletions ?? 0);
  const reviewDrafts = booleanInput("review-drafts", false, env);
  const changedLineThreshold = positiveIntegerInput("changed-line-threshold", 800, env);
  const ignoredDecision = ignoredEventDecision({
    eventName,
    eventAction: event.action,
    isRelevantLabelEvent: reviewLabels.has(eventLabel),
    commandMode,
  });
  const explicitMode = resolveExplicitMode({ configuredMode, commandMode, labelMode });
  const needsSensitivePathEvaluation =
    !ignoredDecision && !explicitMode && !(pullRequest.draft && !reviewDrafts);
  const patterns = needsSensitivePathEvaluation
    ? parseList(input("sensitive-paths", "", env))
    : [];
  const files = needsSensitivePathEvaluation
    ? await getClient().listPullRequestFiles(pullRequestNumber)
    : [];
  const risk = buildRiskContext({
    changedLines,
    changedLineThreshold,
    files,
    sensitivePaths: patterns,
    confidence: input("confidence", "unknown", env),
    lowConfidenceRoute: input("low-confidence-route", "deep", env),
    highRiskRoute: input("high-risk-route", "copilot", env),
    draft: Boolean(pullRequest.draft),
    reviewDrafts,
  });
  const sensitiveFiles = risk.sensitiveFiles;
  const decision = routeReview({
    configuredMode,
    labelMode,
    commandMode,
    eventName,
    eventAction: event.action,
    isRelevantLabelEvent: reviewLabels.has(eventLabel),
    ...risk,
  });

  let copilotRequested = false;
  if (decision.route === "copilot" && booleanInput("request-copilot", true, env)) {
    const dispatch = await requestCopilotReviewer({
      client: getClient(),
      pullRequestNumber,
      reviewer: input("copilot-reviewer", "copilot-pull-request-reviewer[bot]", env),
      headSha: pullRequest.head?.sha,
    });
    copilotRequested = dispatch.requested;
  }

  const model =
    decision.route === "cheap"
      ? input("cheap-model", "", env)
      : decision.route === "deep"
        ? input("deep-model", "", env)
        : "";
  return emitResult({
    pullRequestNumber,
    decision,
    changedLines,
    sensitiveFiles,
    copilotRequested,
    model,
    outputWriter: emitOutput,
    summaryWriter: emitSummary,
    logger,
  });
}

export async function main({ env = process.env, readFileImpl = readFile, ...options } = {}) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  const event = JSON.parse(await readFileImpl(eventPath, "utf8"));
  return runAction({ event, eventName: env.GITHUB_EVENT_NAME ?? "", env, ...options });
}

export function errorAnnotation(error) {
  return `::error::${annotationEscape(error.stack ?? error.message)}`;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(errorAnnotation(error));
    process.exitCode = 1;
  });
}
