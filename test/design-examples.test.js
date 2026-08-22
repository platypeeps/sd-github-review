// DESIGN.md's review-request example is copy-paste starting material for durable
// consumers, so a drifted example is a real defect: it shipped with `mode`
// instead of `route`, an `owner/repo` string instead of a repository object, and
// no `attempt`/`correlationId`/`policyVersion` at all. Copying it produced three
// consecutive decode errors. Decoding the documented block here keeps the prose
// honest by construction rather than by review.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { decodeReviewRequest } from "../src/protocol.js";

const designPath = fileURLToPath(new URL("../DESIGN.md", import.meta.url));

// Anchor on `localReview` rather than on block order or on `route`. Block order
// breaks silently if the document is reorganized, and `route` is one of the
// fields most likely to drift — anchoring on it would make a drifted example
// look *missing* ("found 0") instead of failing to decode, which is the whole
// signal this test exists to give.
function extractReviewRequestExample(markdown) {
  const blocks = [...markdown.matchAll(/```jsonc\n([\s\S]*?)```/gu)].map((match) => match[1]);
  const candidates = blocks.filter((block) => /"localReview"\s*:/u.test(block));
  assert.equal(
    candidates.length,
    1,
    `DESIGN.md must contain exactly one jsonc review-request example; found ${candidates.length}`,
  );
  // Strip // comments so a future annotated example still parses.
  return candidates[0].replaceAll(/^\s*\/\/.*$/gmu, "");
}

test("the DESIGN.md review-request example decodes", async () => {
  const markdown = await readFile(designPath, "utf8");
  const example = JSON.parse(extractReviewRequestExample(markdown));

  assert.doesNotThrow(() => decodeReviewRequest(example));

  // Guard the two fields that were actually wrong, so a regression to the old
  // shape fails with a pointed message instead of a generic decode error.
  assert.equal(example.mode, undefined, "the request field is `route`, not `mode`");
  assert.equal(
    typeof example.repository,
    "object",
    "`repository` is an {owner, name} object, not an owner/repo string",
  );
});
