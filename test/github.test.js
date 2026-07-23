import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github.js";

function jsonResponse(body, { status = 200, statusText = "OK", headers = {} } = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    statusText,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers,
    },
  });
}

function createClient(fetchImpl, options = {}) {
  return new GitHubClient({
    token: "test-token",
    repository: "platypeeps/example",
    apiUrl: "https://github.example/api/v3/",
    fetchImpl,
    ...options,
  });
}

test("sends versioned authenticated GitHub API requests", async () => {
  const calls = [];
  const client = createClient(async (...args) => {
    calls.push(args);
    return jsonResponse({ number: 17 });
  });

  assert.deepEqual(await client.getPullRequest(17), { number: 17 });
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, "https://github.example/api/v3/repos/platypeeps/example/pulls/17");
  assert.equal(options.method, "GET");
  assert.equal(options.headers.Authorization, "Bearer test-token");
  assert.equal(options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(options.headers["User-Agent"], "sd-github-review");
});

test("lists every pull request file page and stops after a short page", async () => {
  const calls = [];
  const client = createClient(async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    const count = page === 1 ? 100 : 2;
    return jsonResponse(
      Array.from({ length: count }, (_, index) => ({ filename: `page-${page}/file-${index}.js` })),
    );
  });

  const files = await client.listPullRequestFiles(9);

  assert.equal(files.length, 102);
  assert.equal(files[0], "page-1/file-0.js");
  assert.equal(files.at(-1), "page-2/file-1.js");
  assert.equal(calls.length, 2);
});

test("fails explicitly when automatic routing exceeds GitHub's 3,000-file window", async () => {
  let callCount = 0;
  const client = createClient(async () => {
    callCount += 1;
    return jsonResponse(Array.from({ length: 100 }, (_, index) => ({ filename: `file-${index}.js` })));
  });

  await assert.rejects(client.listPullRequestFiles(11), /more than 3,000 files/u);
  assert.equal(callCount, 30);
});

test("surfaces GitHub API error messages with method and path", async () => {
  const client = createClient(async () =>
    jsonResponse({ message: "secondary rate limit" }, {
      status: 422,
      statusText: "Unprocessable Content",
    }),
  );

  await assert.rejects(
    client.getPullRequest(4),
    /GitHub API GET \/repos\/platypeeps\/example\/pulls\/4 failed: secondary rate limit/u,
  );
});

test("retries transient reads with deterministic bounded backoff", async () => {
  const sleeps = [];
  let callCount = 0;
  const client = createClient(
    async () => {
      callCount += 1;
      return callCount < 3
        ? jsonResponse({ message: "temporarily unavailable" }, {
            status: 503,
            statusText: "Service Unavailable",
          })
        : jsonResponse({ number: 19 });
    },
    { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
  );

  assert.deepEqual(await client.getPullRequest(19), { number: 19 });
  assert.equal(callCount, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test("retries every documented transient read status", async () => {
  for (const status of [408, 500, 502, 503, 504]) {
    const sleeps = [];
    let callCount = 0;
    const client = createClient(
      async () => {
        callCount += 1;
        return callCount === 1
          ? jsonResponse({ message: `transient ${status}` }, {
              status,
              statusText: "Transient",
            })
          : jsonResponse({ number: status });
      },
      { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
    );

    assert.deepEqual(await client.getPullRequest(status), { number: status });
    assert.equal(callCount, 2);
    assert.deepEqual(sleeps, [1_000]);
  }
});

test("retries read transport failures but never sleeps in tests", async () => {
  const sleeps = [];
  let callCount = 0;
  const client = createClient(
    async () => {
      callCount += 1;
      if (callCount === 1) throw new Error("socket reset");
      return jsonResponse({ number: 20 });
    },
    { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
  );

  assert.deepEqual(await client.getPullRequest(20), { number: 20 });
  assert.equal(callCount, 2);
  assert.deepEqual(sleeps, [1_000]);
});

test("reports attempt exhaustion while preserving the GitHub error message", async () => {
  const sleeps = [];
  let callCount = 0;
  const client = createClient(
    async () => {
      callCount += 1;
      return jsonResponse({ message: "upstream unavailable" }, {
        status: 502,
        statusText: "Bad Gateway",
      });
    },
    { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
  );

  await assert.rejects(
    client.getPullRequest(21),
    /GitHub API GET \/repos\/platypeeps\/example\/pulls\/21 failed: upstream unavailable; attempts=3/u,
  );
  assert.equal(callCount, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test("does not retry deterministic failures or unproven 403 responses", async () => {
  for (const [status, message] of [
    [422, "Validation Failed"],
    [403, "Resource not accessible by integration"],
  ]) {
    const sleeps = [];
    let callCount = 0;
    const client = createClient(
      async () => {
        callCount += 1;
        return jsonResponse({ message }, { status, statusText: "Rejected" });
      },
      { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
    );

    await assert.rejects(client.getPullRequest(22), new RegExp(message, "u"));
    assert.equal(callCount, 1);
    assert.deepEqual(sleeps, []);
  }
});

test("honors retry-after and primary reset headers without exposing other headers", async () => {
  const secondarySleeps = [];
  let secondaryCalls = 0;
  const secondary = createClient(
    async () => {
      secondaryCalls += 1;
      return secondaryCalls === 1
        ? jsonResponse({ message: "secondary rate limit" }, {
            status: 429,
            statusText: "Too Many Requests",
            headers: { "retry-after": "2", authorization: "secret" },
          })
        : jsonResponse({ number: 23 });
    },
    { sleepImpl: async (milliseconds) => secondarySleeps.push(milliseconds) },
  );
  assert.deepEqual(await secondary.getPullRequest(23), { number: 23 });
  assert.deepEqual(secondarySleeps, [2_000]);

  const primarySleeps = [];
  let primaryCalls = 0;
  const primary = createClient(
    async () => {
      primaryCalls += 1;
      return primaryCalls === 1
        ? jsonResponse({ message: "API rate limit exceeded" }, {
            status: 403,
            statusText: "Forbidden",
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "105",
              "x-ratelimit-resource": "core",
            },
          })
        : jsonResponse({ number: 24 });
    },
    {
      sleepImpl: async (milliseconds) => primarySleeps.push(milliseconds),
      now: () => 100_000,
    },
  );
  assert.deepEqual(await primary.getPullRequest(24), { number: 24 });
  assert.deepEqual(primarySleeps, [5_000]);
});

test("uses the bounded secondary fallback and refuses over-cap directed waits", async () => {
  const fallbackSleeps = [];
  let fallbackCalls = 0;
  const fallback = createClient(
    async () => {
      fallbackCalls += 1;
      return fallbackCalls === 1
        ? jsonResponse({ message: "You have exceeded a secondary rate limit." }, {
            status: 403,
            statusText: "Forbidden",
          })
        : jsonResponse({ number: 25 });
    },
    { sleepImpl: async (milliseconds) => fallbackSleeps.push(milliseconds) },
  );
  assert.deepEqual(await fallback.getPullRequest(25), { number: 25 });
  assert.deepEqual(fallbackSleeps, [60_000]);

  const capSleeps = [];
  let capCalls = 0;
  const capped = createClient(
    async () => {
      capCalls += 1;
      return jsonResponse({ message: "secondary rate limit" }, {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "61", authorization: "secret-response-value" },
      });
    },
    { sleepImpl: async (milliseconds) => capSleeps.push(milliseconds) },
  );
  await assert.rejects(capped.getPullRequest(26), (error) => {
    assert.match(
      error.message,
      /secondary rate limit; rate-limit type=secondary retry-after=61; required retry delay exceeds 60000ms cap/u,
    );
    assert.equal(error.message.includes("secret-response-value"), false);
    return true;
  });
  assert.equal(capCalls, 1);
  assert.deepEqual(capSleeps, []);
});

test("reports bounded primary rate-limit context when reset exceeds the cap", async () => {
  const sleeps = [];
  let callCount = 0;
  const client = createClient(
    async () => {
      callCount += 1;
      return jsonResponse({ message: "API rate limit exceeded" }, {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "200",
          "x-ratelimit-resource": "core",
        },
      });
    },
    {
      sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
      now: () => 100_000,
    },
  );

  await assert.rejects(
    client.getPullRequest(28),
    /API rate limit exceeded; rate-limit type=primary remaining=0 reset=200 resource=core; required retry delay exceeds 60000ms cap/u,
  );
  assert.equal(callCount, 1);
  assert.deepEqual(sleeps, []);
});

test("fails closed on malformed rate-limit headers and suppresses unsafe resource values", async () => {
  const sleeps = [];
  let callCount = 0;
  const client = createClient(
    async () => {
      callCount += 1;
      return jsonResponse({ message: "API rate limit exceeded" }, {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "not-an-epoch",
          "x-ratelimit-resource": "unsafe resource value",
        },
      });
    },
    { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
  );

  await assert.rejects(client.getPullRequest(29), (error) => {
    assert.match(
      error.message,
      /rate-limit type=primary remaining=0 reset=invalid-or-overflow; required retry delay exceeds 60000ms cap/u,
    );
    assert.equal(error.message.includes("unsafe resource value"), false);
    return true;
  });
  assert.equal(callCount, 1);
  assert.deepEqual(sleeps, []);
});

test("never retries an interrupted reviewer request", async () => {
  const sleeps = [];
  let callCount = 0;
  const client = createClient(
    async () => {
      callCount += 1;
      throw new Error("connection closed after send");
    },
    { sleepImpl: async (milliseconds) => sleeps.push(milliseconds) },
  );

  await assert.rejects(
    client.requestReviewer(27, "copilot-pull-request-reviewer[bot]"),
    /GitHub API POST \/repos\/platypeeps\/example\/pulls\/27\/requested_reviewers failed: connection closed after send/u,
  );
  assert.equal(callCount, 1);
  assert.deepEqual(sleeps, []);
});

test("reads requested and completed reviews and sends the documented request payload", async () => {
  const calls = [];
  const client = createClient(async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return jsonResponse({ users: [{ login: "copilot" }] });
    if (url.includes("/reviews?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return jsonResponse(
        page === 1
          ? Array.from({ length: 100 }, (_, index) => ({ id: index, commit_id: "head" }))
          : [{ id: 100, commit_id: "head" }],
      );
    }
    return jsonResponse({ users: [], teams: [] });
  });

  assert.deepEqual(await client.getRequestedReviewers(8), { users: [], teams: [] });
  assert.equal((await client.listPullRequestReviews(8)).length, 101);
  await client.requestReviewer(8, "copilot-pull-request-reviewer[bot]");

  assert.equal(calls.length, 4);
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[3].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    reviewers: ["copilot-pull-request-reviewer[bot]"],
  });
});

test("paginates compare metadata and fails closed on inconsistent pages", async () => {
  const calls = [];
  const client = createClient(async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return jsonResponse({
      status: page === 1 ? "ahead" : "diverged",
      ahead_by: 2,
      behind_by: 0,
      total_commits: 101,
      merge_base_commit: { sha: "a".repeat(40) },
      commits: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({
        sha: `${page}-${index}`,
      })),
      files: Array.from({ length: page === 1 ? 1 : 0 }, (_, index) => ({
        filename: `page-${page}/file-${index}.md`,
      })),
    });
  });

  const comparison = await client.compareCommits("a".repeat(40), "b".repeat(40));

  assert.equal(comparison.incomplete, true);
  assert.equal(comparison.inconsistent, true);
  assert.equal(comparison.files.length, 1);
  assert.match(calls[0], /compare\/a{40}\.\.\.b{40}\?per_page=100&page=1$/u);
});

test("compare pagination reads commits while bounding files to the first page", async () => {
  const client = createClient(async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return jsonResponse({
      status: "ahead",
      ahead_by: 101,
      behind_by: 0,
      total_commits: 101,
      merge_base_commit: { sha: "a".repeat(40) },
      commits: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({
        sha: `${page}-${index}`,
      })),
      files: page === 1
        ? Array.from({ length: 300 }, (_, index) => ({ filename: `file-${index}.md` }))
        : undefined,
    });
  });

  const comparison = await client.compareCommits("a".repeat(40), "b".repeat(40));

  assert.equal(comparison.commitCount, 101);
  assert.equal(comparison.files.length, 300);
  assert.equal(comparison.truncated, true);
  assert.equal(comparison.incomplete, false);
});

test("rejects invalid compare pagination limits before transport", async () => {
  let called = false;
  const client = createClient(async () => {
    called = true;
    return jsonResponse({});
  });

  for (const maximumPages of [0, -1, 1.5, "1", null]) {
    await assert.rejects(
      client.compareCommits("a".repeat(40), "b".repeat(40), { maximumPages }),
      /maximumPages must be a positive integer/u,
    );
  }
  assert.equal(called, false);
});

test("lists named check runs across pages", async () => {
  const calls = [];
  const client = createClient(async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return jsonResponse({
      check_runs: Array.from({ length: page === 1 ? 100 : 2 }, (_, index) => ({
        id: page * 1000 + index,
      })),
    });
  });

  const checks = await client.listCheckRuns("c".repeat(40), "sd-github-review/receipt");

  assert.equal(checks.length, 102);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /check_name=sd-github-review%2Freceipt/u);
  assert.match(calls[0], /filter=all/u);
});

test("creates and updates check runs with documented HTTP methods", async () => {
  const calls = [];
  const client = createClient(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: 41 });
  });
  const createPayload = { name: "sd-github-review/receipt", head_sha: "d".repeat(40) };
  const updatePayload = { status: "completed", conclusion: "success" };

  await client.createCheckRun(createPayload);
  await client.updateCheckRun(41, updatePayload);

  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), createPayload);
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), updatePayload);
  assert.match(calls[1].url, /\/check-runs\/41$/u);
});
