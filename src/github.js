const API_VERSION = "2026-03-10";

export class GitHubClient {
  constructor({ token, repository, apiUrl = "https://api.github.com", fetchImpl = fetch }) {
    if (!token) throw new Error("github-token is required");
    const [owner, repo] = String(repository ?? "").split("/");
    if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be in owner/repo form");
    this.owner = owner;
    this.repo = repo;
    this.apiUrl = apiUrl.replace(/\/$/u, "");
    this.fetch = fetchImpl;
    this.headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "sd-github-review",
    };
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await this.fetch(`${this.apiUrl}${path}`, {
      method,
      headers: { ...this.headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = result?.message ?? `${response.status} ${response.statusText}`;
      throw new Error(`GitHub API ${method} ${path} failed: ${message}`);
    }
    return result;
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
