const API_VERSION = "2026-03-10";
const MAX_READ_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;
const SECONDARY_RATE_LIMIT_DELAY_MS = 60_000;
const RETRYABLE_READ_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericHeader(response, name) {
  const raw = response.headers.get(name);
  if (raw === null) return { present: false, value: null };
  const normalized = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    return { present: true, value: null };
  }
  const value = Number(normalized);
  return {
    present: true,
    value: Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY,
  };
}

function resourceHeader(response) {
  const value = response.headers.get("x-ratelimit-resource")?.trim();
  return value && /^[a-zA-Z0-9._:-]{1,64}$/u.test(value) ? value : null;
}

function rateLimitContext(response, result) {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = numericHeader(response, "retry-after");
  const remaining = numericHeader(response, "x-ratelimit-remaining");
  const reset = numericHeader(response, "x-ratelimit-reset");
  const secondaryMessage = typeof result?.message === "string"
    && /secondary rate limit/u.test(result.message.toLowerCase());
  const type = remaining.value === 0
    ? "primary"
    : retryAfter.present || response.status === 429 || secondaryMessage
      ? "secondary"
      : null;
  if (!type) return null;
  return {
    type,
    retryAfter,
    remaining,
    reset,
    resource: resourceHeader(response),
  };
}

function directedDelay(response, context, now) {
  const retryAfter = numericHeader(response, "retry-after");
  if (retryAfter.present) {
    if (Number.isFinite(retryAfter.value)) return retryAfter.value * 1_000;
    return Number.POSITIVE_INFINITY;
  }

  if (context?.remaining.value === 0) {
    if (!Number.isFinite(context.reset.value)) return Number.POSITIVE_INFINITY;
    return Math.max(0, (context.reset.value * 1_000) - now());
  }
  if (context?.type === "secondary") return SECONDARY_RATE_LIMIT_DELAY_MS;
  return null;
}

function retryDecision({ method, response, result, attempt, now }) {
  const context = rateLimitContext(response, result);
  const retryableStatus = RETRYABLE_READ_STATUSES.has(response.status)
    || (response.status === 403 && context !== null);
  if (method !== "GET" || !retryableStatus || attempt >= MAX_READ_ATTEMPTS) {
    return { retry: false, context, delayMs: null, capExceeded: false };
  }

  const requestedDelay = directedDelay(response, context, now);
  const delayMs = requestedDelay ?? Math.min(
    BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)),
    MAX_RETRY_DELAY_MS,
  );
  if (!Number.isFinite(delayMs) || delayMs > MAX_RETRY_DELAY_MS) {
    return { retry: false, context, delayMs, capExceeded: true };
  }
  return { retry: true, context, delayMs, capExceeded: false };
}

function formatRateLimit(context) {
  if (!context) return "";
  const fields = [`type=${context.type}`];
  if (context.retryAfter.present) {
    fields.push(Number.isFinite(context.retryAfter.value)
      ? `retry-after=${context.retryAfter.value}`
      : "retry-after=invalid-or-overflow");
  }
  if (context.remaining.present) {
    fields.push(Number.isFinite(context.remaining.value)
      ? `remaining=${context.remaining.value}`
      : "remaining=invalid-or-overflow");
  }
  if (context.reset.present) {
    fields.push(Number.isFinite(context.reset.value)
      ? `reset=${context.reset.value}`
      : "reset=invalid-or-overflow");
  }
  if (context.resource) fields.push(`resource=${context.resource}`);
  return `; rate-limit ${fields.join(" ")}`;
}

function responseError(method, path, response, result, attempt, decision) {
  const message = typeof result?.message === "string"
    ? result.message
    : `${response.status} ${response.statusText}`;
  const attempts = attempt > 1 ? `; attempts=${attempt}` : "";
  const cap = decision.capExceeded
    ? `; required retry delay exceeds ${MAX_RETRY_DELAY_MS}ms cap`
    : "";
  return new Error(
    `GitHub API ${method} ${path} failed: ${message}${attempts}${formatRateLimit(decision.context)}${cap}`,
  );
}

function transportError(method, path, error, attempt) {
  const message = error instanceof Error ? error.message : String(error);
  const attempts = attempt > 1 ? `; attempts=${attempt}` : "";
  return new Error(`GitHub API ${method} ${path} failed: ${message}${attempts}`, {
    cause: error,
  });
}

export class GitHubClient {
  constructor({
    token,
    repository,
    apiUrl = "https://api.github.com",
    fetchImpl = fetch,
    sleepImpl = sleep,
    now = () => Date.now(),
  }) {
    if (!token) throw new Error("github-token is required");
    const [owner, repo] = String(repository ?? "").split("/");
    if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be in owner/repo form");
    this.owner = owner;
    this.repo = repo;
    this.apiUrl = apiUrl.replace(/\/$/u, "");
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.now = now;
    this.headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "sd-github-review",
    };
  }

  async request(path, { method = "GET", body } = {}) {
    const maximumAttempts = method === "GET" ? MAX_READ_ATTEMPTS : 1;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let response;
      let text;
      try {
        response = await this.fetch(`${this.apiUrl}${path}`, {
          method,
          headers: { ...this.headers, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        text = await response.text();
      } catch (error) {
        if (method !== "GET" || attempt >= maximumAttempts) {
          throw transportError(method, path, error, attempt);
        }
        await this.sleep(Math.min(
          BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)),
          MAX_RETRY_DELAY_MS,
        ));
        continue;
      }

      let result = null;
      let parseError = null;
      if (text) {
        try {
          result = JSON.parse(text);
        } catch (error) {
          parseError = error;
        }
      }
      if (response.ok) {
        if (parseError) throw parseError;
        return result;
      }

      const decision = retryDecision({
        method,
        response,
        result,
        attempt,
        now: this.now,
      });
      if (decision.retry) {
        await this.sleep(decision.delayMs);
        continue;
      }
      throw responseError(method, path, response, result, attempt, decision);
    }
    throw new Error(`GitHub API ${method} ${path} failed without a terminal response`);
  }

  getPullRequest(number) {
    return this.request(`/repos/${this.owner}/${this.repo}/pulls/${number}`);
  }

  async listPullRequestFiles(number) {
    const files = [];
    for (let page = 1; page <= 30; page += 1) {
      const batch = await this.request(
        `/repos/${this.owner}/${this.repo}/pulls/${number}/files?per_page=100&page=${page}`,
      );
      files.push(...batch.map((file) => file.filename));
      if (batch.length < 100) return files;
    }
    throw new Error("pull request contains more than 3,000 files; route it explicitly");
  }

  async compareCommits(base, head, { maximumPages = 30 } = {}) {
    if (!Number.isInteger(maximumPages) || maximumPages < 1) {
      throw new TypeError("maximumPages must be a positive integer");
    }
    const files = [];
    let comparison = null;
    let commitCount = 0;
    for (let page = 1; page <= maximumPages; page += 1) {
      const result = await this.request(
        `/repos/${this.owner}/${this.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100&page=${page}`,
      );
      const commits = Array.isArray(result?.commits) ? result.commits : [];
      const pageFiles = Array.isArray(result?.files) ? result.files : [];
      const current = {
        status: result?.status ?? null,
        aheadBy: result?.ahead_by ?? null,
        behindBy: result?.behind_by ?? null,
        totalCommits: result?.total_commits ?? null,
        mergeBaseSha: result?.merge_base_commit?.sha ?? null,
      };
      if (comparison === null) {
        comparison = current;
      } else if (JSON.stringify(comparison) !== JSON.stringify(current)) {
        return {
          ...comparison,
          files,
          commitCount,
          truncated: files.length >= 300,
          incomplete: true,
          inconsistent: true,
        };
      }
      // GitHub exposes changed files only on the first compare page and caps
      // that list at 300, even while commit pagination continues.
      if (page === 1) files.push(...pageFiles);
      else if (pageFiles.length > 0) {
        return {
          ...comparison,
          files,
          commitCount,
          truncated: files.length >= 300,
          incomplete: true,
          inconsistent: true,
        };
      }
      commitCount += commits.length;
      const allCommitsObserved = Number.isInteger(comparison.totalCommits)
        && commitCount >= comparison.totalCommits;
      if (allCommitsObserved || commits.length < 100) {
        return {
          ...comparison,
          files,
          commitCount,
          truncated: files.length >= 300,
          incomplete: Number.isInteger(comparison.totalCommits)
            && commitCount < comparison.totalCommits,
          inconsistent: false,
        };
      }
    }
    return {
      ...comparison,
      files,
      commitCount,
      truncated: files.length >= 300,
      incomplete: true,
      inconsistent: false,
    };
  }

  async listCheckRuns(head, name) {
    const checkRuns = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        check_name: name,
        filter: "all",
        per_page: "100",
        page: String(page),
      });
      const result = await this.request(
        `/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(head)}/check-runs?${query}`,
      );
      const batch = Array.isArray(result?.check_runs) ? result.check_runs : [];
      checkRuns.push(...batch);
      if (batch.length < 100) return checkRuns;
    }
  }

  createCheckRun(payload) {
    return this.request(`/repos/${this.owner}/${this.repo}/check-runs`, {
      method: "POST",
      body: payload,
    });
  }

  updateCheckRun(id, payload) {
    return this.request(`/repos/${this.owner}/${this.repo}/check-runs/${id}`, {
      method: "PATCH",
      body: payload,
    });
  }

  getRequestedReviewers(number) {
    return this.request(`/repos/${this.owner}/${this.repo}/pulls/${number}/requested_reviewers`);
  }

  async listPullRequestReviews(number) {
    const reviews = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.request(
        `/repos/${this.owner}/${this.repo}/pulls/${number}/reviews?per_page=100&page=${page}`,
      );
      reviews.push(...batch);
      if (batch.length < 100) return reviews;
    }
  }

  requestReviewer(number, reviewer) {
    return this.request(`/repos/${this.owner}/${this.repo}/pulls/${number}/requested_reviewers`, {
      method: "POST",
      body: { reviewers: [reviewer] },
    });
  }
}
