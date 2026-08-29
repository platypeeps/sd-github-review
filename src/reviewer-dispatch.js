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
// this pull request -- a terminal answer from the API, not a transport
// accident and not a statement about the reviewer's intent.
export const LANDING_NOT_ATTEMPTED = "not-attempted";
export const LANDING_CONFIRMED = "confirmed";
export const LANDING_ABSENT = "absent";
export const LANDING_UNVERIFIED = "unverified";
export const LANDING_DECLINED = "declined";

// What the presence probe found. A review is anchored to a head by its
// commit_id; a pending reviewer request is not -- the requested-reviewers
// payload carries no commit and no timestamp, so "Copilot is a requested
// reviewer" says nothing about which head the request was made for. Reading
// it as coverage of THIS head is what let a request for one head satisfy
// presence at every later one (issue #158): the run at the new head
// short-circuited, wrote a satisfied receipt, and waited forever for an
// exact-head review nobody asked for.
//
// `unverified` is the pre-probe itself being unreadable: presence is not
// known either way. `unanchored-request` is a pending request whose head is
// unknown. They are kept apart because the caller acts on them differently.
export const PRESENCE_ABSENT = "absent";
export const PRESENCE_REVIEWED = "reviewed-head";
export const PRESENCE_UNANCHORED = "unanchored-request";
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
// request -- validation failed, the reviewer cannot be requested here, the
// endpoint reports it was spammed, or whatever else the API's own message
// says. Some of those clear on their own; none clears by repeating the same
// POST at the same head, which is why the receipt settles (as a thrown 422
// already did, as `failed`) and the sanctioned recovery is an authorized
// re-request. That is the one status the API
// gives that separates "the backend refused this POST" from "we do not know
// what happened": transport errors, timeouts, 5xx, and auth failures all
// carry no such statement and stay on the throw path, where the caller
// records them as `failed`. Nothing here infers a decline from anything but
// the status -- not diff size, not the message -- and nothing here claims to
// know why GitHub refused: the message is recorded verbatim for the operator.
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

// `rerequestPending` is the caller's statement that it holds no record of a
// reviewer request for this head. The durable path can say that: its first
// attempt dispatches only when no receipt records prior dispatched work for
// the head (a later authorized attempt forces the re-request anyway), so a
// request it finds pending was not made by it at this head -- either it
// belongs to an earlier head, or someone else made it. Neither can be told
// apart from the API, and only the first would be a wrong thing to
// re-request, so the pending reviewer is removed and re-requested (removal
// is what makes GitHub notify again). Cost: at most one extra review per
// head, and only when someone else -- a person, another workflow, or the
// repository's automatic Copilot review setting -- requested the reviewer at
// this head first. That is bought deliberately -- no evidence GitHub exposes
// proves which head a pending request is for, and a commit's own timestamps
// are written by the committer, not observed by the server, so nothing
// derived from them is a proof in either direction. A gate prefers a loud
// duplicate to a silent bypass. If the POST after the removal fails, the
// caller records the failure and routes it to a human, the same posture as
// a failed authorized re-request.
//
// A caller with no such record (standalone, or no head at all) leaves it off:
// the pending request keeps its presence and is reported `unanchored-request`
// so the caller knows the head is unproven.
export async function requestCopilotReviewer({
  client,
  pullRequestNumber,
  reviewer,
  headSha,
  forceRerequest = false,
  rerequestPending = false,
}) {
  // `request()` answers `null` for a 2xx with an empty body, so this probe can
  // yield no object at all. Reading `.users` off it directly would throw before
  // any POST, turning an unreadable pre-probe into an unhandled exception
  // instead of the fail-closed path. Unreadable means "not known to be
  // present", so the POST still happens and `probeLanding` renders the
  // verdict; what it is not is `absent`, which is a positive claim, so the
  // presence is reported `unverified`.
  const requested = await client.getRequestedReviewers(pullRequestNumber);
  const probeReadable = Array.isArray(requested?.users);
  const alreadyRequested = probeReadable
    && requested.users.some((user) => sameLogin(user?.login, reviewer));
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
  const presence = alreadyReviewed
    ? PRESENCE_REVIEWED
    : alreadyRequested
      ? PRESENCE_UNANCHORED
      : probeReadable ? PRESENCE_ABSENT : PRESENCE_UNVERIFIED;
  // An authorized rerequest (validated one layer up) must force a fresh review
  // even when Copilot already reviewed this head or is still a requested
  // reviewer. GitHub does not re-notify a reviewer already in the requested
  // set, so a pending reviewer is removed before being re-requested. The
  // same removal serves a pending request the caller holds no record of.
  if (forceRerequest || (alreadyRequested && rerequestPending)) {
    if (alreadyRequested) {
      await client.removeRequestedReviewer(pullRequestNumber, reviewer);
    }
    const outcome = await requestAndProbe(client, pullRequestNumber, reviewer);
    const landed = outcome.landing === LANDING_CONFIRMED;
    return { ...base, requested: landed, rerequested: landed, presence, ...outcome };
  }
  if (!alreadyPresent) {
    const outcome = await requestAndProbe(client, pullRequestNumber, reviewer);
    return {
      ...base,
      requested: outcome.landing === LANDING_CONFIRMED,
      rerequested: false,
      presence,
      ...outcome,
    };
  }
  return { ...base, requested: false, rerequested: false, presence, landing: LANDING_NOT_ATTEMPTED };
}
