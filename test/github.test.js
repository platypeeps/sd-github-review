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

test("reads and requests reviewers with the documented payload", async () => {
  const calls = [];
  const client = createClient(async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return jsonResponse({ users: [{ login: "copilot" }] });
    return jsonResponse({ users: [], teams: [] });
  });

  assert.deepEqual(await client.getRequestedReviewers(8), { users: [], teams: [] });
  await client.requestReviewer(8, "copilot-pull-request-reviewer[bot]");

  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    reviewers: ["copilot-pull-request-reviewer[bot]"],
  });
});
