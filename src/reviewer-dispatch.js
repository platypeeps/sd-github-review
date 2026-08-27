// Shared Copilot reviewer-dispatch service. Runs the presence probe (already
// requested as a reviewer, or already reviewed the current head skipping
// DISMISSED reviews with a case-insensitive commit_id match) and performs the
// conditional requestReviewer call exactly once. Standalone calls it directly;
// the durable path wraps it with receipt observe/reconciliation. The review
// listing is skipped when no head SHA is available so a standalone event
// without a head never over-fetches. The GitHub client is injected.
//
// `requested` reports whether the reviewer is present AFTER the call, never
// whether we merely intended to add them. GitHub can return a non-error
// response to requestReviewer and add nobody; deriving `requested` from the
// pre-call probe reported that as success, which minted a durable receipt
// claiming a review request that never landed. `landing` carries the evidence.

// Landing outcomes. `not-attempted` and `unverified` are distinct on purpose:
// the first means no POST was needed, the second means a POST happened and we
// could not find out what it did. Neither may be read as a landed request.
export const LANDING_NOT_ATTEMPTED = "not-attempted";
export const LANDING_CONFIRMED = "confirmed";
export const LANDING_ABSENT = "absent";
export const LANDING_UNVERIFIED = "unverified";

// Re-read the requested-reviewer set and report what is actually there. A probe
// that throws yields `unverified` rather than a guess in either direction.
async function probeLanding(client, pullRequestNumber, reviewer) {
  try {
    const after = await client.getRequestedReviewers(pullRequestNumber);
    return after?.users?.some((user) => user.login === reviewer)
      ? LANDING_CONFIRMED
      : LANDING_ABSENT;
  } catch {
    return LANDING_UNVERIFIED;
  }
}

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
    const landing = await probeLanding(client, pullRequestNumber, reviewer);
    const landed = landing === LANDING_CONFIRMED;
    return {
      alreadyRequested,
      alreadyReviewed,
      alreadyPresent,
      requested: landed,
      rerequested: landed,
      landing,
    };
  }
  if (!alreadyPresent) {
    await client.requestReviewer(pullRequestNumber, reviewer);
    const landing = await probeLanding(client, pullRequestNumber, reviewer);
    return {
      alreadyRequested,
      alreadyReviewed,
      alreadyPresent,
      requested: landing === LANDING_CONFIRMED,
      rerequested: false,
      landing,
    };
  }
  return {
    alreadyRequested,
    alreadyReviewed,
    alreadyPresent,
    requested: false,
    rerequested: false,
    landing: LANDING_NOT_ATTEMPTED,
  };
}
