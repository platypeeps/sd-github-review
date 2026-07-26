import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GitHubClient } from "./github.js";
import { normalizeOperation, runDurableAction, writeDurableSummary } from "./operations.js";
import {
  findSensitiveFiles,
  ignoredEventDecision,
  isTrustedCommand,
  modeFromLabels,
  normalizeConfidence,
  normalizeEscalationRoute,
  normalizeMode,
  parseList,
  parseReviewCommand,
  resolveExplicitMode,
  reviewLabels,
  routeReview,
} from "./router.js";

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
  const confidence = normalizeConfidence(input("confidence", "unknown", env));
  const lowConfidenceRoute = normalizeEscalationRoute(
    input("low-confidence-route", "deep", env),
    "low-confidence-route",
  );
  const highRiskRoute = normalizeEscalationRoute(
    input("high-risk-route", "copilot", env),
    "high-risk-route",
  );

  const pullRequestNumber = Number.parseInt(
    input("pr-number", "", env) || String(event.pull_request?.number ?? event.issue?.number ?? ""),
    10,
  );
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("could not infer a pull request number; set pr-number explicitly");
  }

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
  const sensitiveFiles = findSensitiveFiles(files, patterns);
  const decision = routeReview({
    configuredMode,
    labelMode,
    commandMode,
    eventName,
    eventAction: event.action,
    isRelevantLabelEvent: reviewLabels.has(eventLabel),
    draft: Boolean(pullRequest.draft),
    reviewDrafts,
    changedLines,
    changedLineThreshold,
    sensitiveFiles,
    highRiskRoute,
    confidence,
    lowConfidenceRoute,
  });

  let copilotRequested = false;
  if (decision.route === "copilot" && booleanInput("request-copilot", true, env)) {
    const reviewer = input("copilot-reviewer", "copilot-pull-request-reviewer[bot]", env);
    const requested = await getClient().getRequestedReviewers(pullRequestNumber);
    const alreadyRequested = requested.users?.some((user) => user.login === reviewer);
    const headSha = pullRequest.head?.sha;
    const alreadyReviewed =
      !alreadyRequested && headSha
        ? (await getClient().listPullRequestReviews(pullRequestNumber)).some(
            (review) =>
              review.user?.login === reviewer &&
              review.commit_id === headSha &&
              review.state !== "DISMISSED",
          )
        : false;
    if (!alreadyRequested && !alreadyReviewed) {
      await getClient().requestReviewer(pullRequestNumber, reviewer);
      copilotRequested = true;
    }
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
