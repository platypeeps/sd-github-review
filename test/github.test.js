import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github.js";

function jsonResponse(body, { status = 200, statusText = "OK" } = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    statusText,
    headers: body === null ? {} : { "content-type": "application/json" },
  });
}

function createClient(fetchImpl) {
  return new GitHubClient({
    token: "test-token",
    repository: "platypeeps/example",
    apiUrl: "https://github.example/api/v3/",
    fetchImpl,
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
    jsonResponse({ message: "secondary rate limit" }, { status: 403, statusText: "Forbidden" }),
  );

  await assert.rejects(
    client.getPullRequest(4),
    /GitHub API GET \/repos\/platypeeps\/example\/pulls\/4 failed: secondary rate limit/u,
  );
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
