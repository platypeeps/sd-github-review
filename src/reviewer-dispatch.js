// Shared Copilot reviewer-dispatch service. Runs the presence probe (already
// requested as a reviewer, or already reviewed the current head skipping
// DISMISSED reviews with a case-insensitive commit_id match) and performs the
// conditional requestReviewer call exactly once. Standalone calls it directly;
// the durable path wraps it with receipt observe/reconciliation. The review
// listing is skipped when no head SHA is available so a standalone event
// without a head never over-fetches. The GitHub client is injected.

export async function requestCopilotReviewer({
  client,
  pullRequestNumber,
  reviewer,
  headSha,
  forceRerequest = false,
}) {
  const requested = await client.getRequestedReviewers(pullRequestNumber);
  const alreadyRequested = Boolean(requested.users?.some((user) => user.login === reviewer));
  const alreadyReviewed = Boolean(
    !alreadyRequested
      && headSha
      && (await client.listPullRequestReviews(pullRequestNumber)).some(
        (review) =>
          review.user?.login === reviewer
          && review.commit_id?.toLowerCase() === headSha.toLowerCase()
          && review.state !== "DISMISSED",
      ),
  );
  const alreadyPresent = alreadyRequested || alreadyReviewed;
  // An authorized rerequest (validated one layer up) must force a fresh review
  // even when Copilot already reviewed this head or is still a requested
  // reviewer. GitHub does not re-notify a reviewer already in the requested
  // set, so a pending reviewer is removed before being re-requested.
  if (forceRerequest) {
    if (alreadyRequested) {
      await client.removeRequestedReviewer(pullRequestNumber, reviewer);
    }
    await client.requestReviewer(pullRequestNumber, reviewer);
    return { alreadyRequested, alreadyReviewed, alreadyPresent, requested: true, rerequested: true };
  }
  if (!alreadyPresent) {
    await client.requestReviewer(pullRequestNumber, reviewer);
  }
  return { alreadyRequested, alreadyReviewed, alreadyPresent, requested: !alreadyPresent, rerequested: false };
}
