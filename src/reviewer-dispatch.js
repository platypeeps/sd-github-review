// Shared Copilot reviewer-dispatch service. Runs the presence probe (already
// requested as a reviewer, or already reviewed the current head skipping
// DISMISSED reviews with a case-insensitive commit_id match) and performs the
// conditional requestReviewer call exactly once. Standalone calls it directly;
// the durable path wraps it with receipt observe/reconciliation. The review
// listing is skipped when no head SHA is available so a standalone event
// without a head never over-fetches. The GitHub client is injected.
//
// `requested` reports whether THIS CALL added the reviewer, confirmed by
// reading the set back afterwards -- never whether we merely intended to. It is
// deliberately false when the reviewer was already present and no POST was
// needed: that is a real presence, but this call did not create it, and
// `alreadyPresent` is the field that reports it. GitHub can return a non-error
// response to requestReviewer and add nobody; deriving `requested` from the
// pre-call probe reported that as success, which minted a durable receipt
// claiming a review request that never landed. `landing` carries the evidence.

// Landing outcomes. `not-attempted` and `unverified` are distinct on purpose:
// the first means no POST was needed, the second means a POST happened and we
// could not find out what it did. Neither may be read as a landed request.
// `declined` means GitHub received the POST, understood it, and refused it for
// this pull request -- a terminal answer, not a transport accident.
export const LANDING_NOT_ATTEMPTED = "not-attempted";
export const LANDING_CONFIRMED = "confirmed";
export const LANDING_ABSENT = "absent";
export const LANDING_UNVERIFIED = "unverified";
export const LANDING_DECLINED = "declined";

// What the presence probe found, and -- for a pending request -- which head it
// belongs to. A pending reviewer request carries no commit anchor in the
// requested-reviewers payload, so "Copilot is a requested reviewer" says
// nothing about whether the request was made for THIS head. Reading it as if
// it did is what let a request for one head satisfy presence at every later
// one (issue #158): the run at the new head short-circuited, wrote a
// satisfied receipt, and waited forever for an exact-head review nobody asked
// for.
export const PRESENCE_ABSENT = "absent";
export const PRESENCE_REVIEWED = "reviewed-head";
export const PRESENCE_CURRENT = "current-head";
export const PRESENCE_STALE = "stale-request";
export const PRESENCE_UNVERIFIED = "unverified";

// GitHub logins are case-insensitive, and the API echoes its own canonical
// casing, which need not match the configured reviewer string. An exact
// comparison would read a landed request as absent.
function sameLogin(left, right) {
  return typeof left === "string" && typeof right === "string"
    && left.toLowerCase() === right.toLowerCase();
}

// Re-read the requested-reviewer set and report what is actually there. A probe
// that throws yields `unverified` rather than a guess in either direction, and
// so does a response with no readable reviewer set: `request()` returns `null`
// for a 2xx with an empty body, and `absent` is a positive claim --
// "GitHub accepted the request and added nobody" -- that this probe is the only
// source of. Falling through to it on an unreadable payload would manufacture
// the exact evidence the caller fails closed on.
async function probeLanding(client, pullRequestNumber, reviewer) {
  let after;
  try {
    after = await client.getRequestedReviewers(pullRequestNumber);
  } catch {
    return LANDING_UNVERIFIED;
  }
  if (!Array.isArray(after?.users)) return LANDING_UNVERIFIED;
  return after.users.some((user) => sameLogin(user?.login, reviewer))
    ? LANDING_CONFIRMED
    : LANDING_ABSENT;
}

// A 422 is GitHub saying it parsed the request and refuses it for this pull
// request. That is the one status the API gives that separates "the backend
// declined" from "we do not know what happened": transport errors, timeouts,
// 5xx, and auth failures all carry no such statement and stay on the throw
// path, where the caller records them as `failed`. Nothing here infers a
// decline from anything but the status -- not diff size, not the message.
function declineOf(error) {
  if (error?.status !== 422) return null;
  return {
    status: 422,
    message: typeof error.apiMessage === "string" && error.apiMessage
      ? error.apiMessage
      : "Unprocessable Entity",
  };
}

async function requestAndProbe(client, pullRequestNumber, reviewer) {
  try {
    await client.requestReviewer(pullRequestNumber, reviewer);
  } catch (error) {
    const declined = declineOf(error);
    if (!declined) throw error;
    return { landing: LANDING_DECLINED, declined };
  }
  return { landing: await probeLanding(client, pullRequestNumber, reviewer) };
}

function latestRequestEventAt(events, reviewer) {
  let latest = null;
  for (const event of events) {
    if (event?.event !== "review_requested") continue;
    if (!sameLogin(event.requested_reviewer?.login, reviewer)) continue;
    const at = Date.parse(event.created_at ?? "");
    if (!Number.isFinite(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

// Decide which head a pending request belongs to. The committer date is a
// lower bound on when the head could have been pushed, so a request created
// before it cannot have been made for this head: that direction is a proof.
// The other direction is not -- a commit created locally before the request
// and pushed after it reads as current -- and is the accepted residual; it is
// still strictly narrower than treating every pending request as current.
//
// Evidence that cannot be read yields `unverified`, never a guess. The
// reviewer IS present; what is unknown is which head. Re-requesting on every
// timeline read failure would buy a duplicate review per API blip, so the
// caller keeps today's behaviour for `unverified` and surfaces it as an
// anomaly instead of silently trusting it.
async function anchorPendingRequest(client, pullRequestNumber, reviewer, headSha) {
  let events;
  let commit;
  try {
    events = await client.listIssueTimeline(pullRequestNumber);
    commit = await client.getCommit(headSha);
  } catch {
    return PRESENCE_UNVERIFIED;
  }
  if (!Array.isArray(events)) return PRESENCE_UNVERIFIED;
  const requestedAt = latestRequestEventAt(events, reviewer);
  const committedAt = Date.parse(commit?.commit?.committer?.date ?? "");
  if (requestedAt === null || !Number.isFinite(committedAt)) return PRESENCE_UNVERIFIED;
  return requestedAt < committedAt ? PRESENCE_STALE : PRESENCE_CURRENT;
}

export async function requestCopilotReviewer({
  client,
  pullRequestNumber,
  reviewer,
  headSha,
  forceRerequest = false,
}) {
  // `request()` answers `null` for a 2xx with an empty body, so this probe can
  // yield no object at all. Reading `.users` off it directly would throw before
  // any POST, turning an unreadable pre-probe into an unhandled exception
  // instead of the fail-closed path. Unreadable means "not known to be
  // present", so the POST still happens and `probeLanding` renders the verdict.
  const requested = await client.getRequestedReviewers(pullRequestNumber);
  const alreadyRequested = Boolean(requested?.users?.some((user) => sameLogin(user?.login, reviewer)));
  const alreadyReviewed = Boolean(
    !alreadyRequested
      && headSha
      && (await client.listPullRequestReviews(pullRequestNumber)).some(
        (review) =>
          sameLogin(review.user?.login, reviewer)
          && review.commit_id?.toLowerCase() === headSha.toLowerCase()
          && review.state !== "DISMISSED",
      ),
  );
  const alreadyPresent = alreadyRequested || alreadyReviewed;
  const base = { alreadyRequested, alreadyReviewed, alreadyPresent };
  // An authorized rerequest (validated one layer up) must force a fresh review
  // even when Copilot already reviewed this head or is still a requested
  // reviewer. GitHub does not re-notify a reviewer already in the requested
  // set, so a pending reviewer is removed before being re-requested. The
  // caller has already decided to re-request, so no anchor evidence is read.
  if (forceRerequest) {
    if (alreadyRequested) {
      await client.removeRequestedReviewer(pullRequestNumber, reviewer);
    }
    const outcome = await requestAndProbe(client, pullRequestNumber, reviewer);
    const landed = outcome.landing === LANDING_CONFIRMED;
    return {
      ...base,
      requested: landed,
      rerequested: landed,
      presence: alreadyReviewed
        ? PRESENCE_REVIEWED
        : alreadyRequested ? PRESENCE_UNVERIFIED : PRESENCE_ABSENT,
      ...outcome,
    };
  }
  if (!alreadyPresent) {
    const outcome = await requestAndProbe(client, pullRequestNumber, reviewer);
    return {
      ...base,
      requested: outcome.landing === LANDING_CONFIRMED,
      rerequested: false,
      presence: PRESENCE_ABSENT,
      ...outcome,
    };
  }
  // A review is anchored by its commit_id; a pending request is not, so only
  // the latter needs evidence. Without a head there is nothing to anchor to.
  const presence = alreadyReviewed
    ? PRESENCE_REVIEWED
    : headSha
      ? await anchorPendingRequest(client, pullRequestNumber, reviewer, headSha)
      : PRESENCE_UNVERIFIED;
  if (presence === PRESENCE_STALE) {
    // The pending request was made for an earlier head and will produce a
    // review anchored there. Re-request so GitHub notifies for this head; the
    // removal is what makes GitHub treat it as a new request.
    await client.removeRequestedReviewer(pullRequestNumber, reviewer);
    const outcome = await requestAndProbe(client, pullRequestNumber, reviewer);
    const landed = outcome.landing === LANDING_CONFIRMED;
    return {
      ...base,
      requested: landed,
      rerequested: landed,
      presence,
      ...outcome,
    };
  }
  return {
    ...base,
    requested: false,
    rerequested: false,
    presence,
    landing: LANDING_NOT_ATTEMPTED,
  };
}
