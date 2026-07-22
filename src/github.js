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
