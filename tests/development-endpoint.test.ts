import { describe, expect, it, vi } from "vitest";
import { run, validateDuckPostEndpoint, type GitHubContext } from "../src/index.js";

const developmentEndpoint = "https://dev.duckpost.app/api/ai-release-jobs";
const context: GitHubContext = {
  eventName: "push",
  ref: "refs/heads/main",
  repo: { owner: "duckpost", repo: "app" },
  sha: "abc123",
};

function createCore(endpoint: string) {
  const inputs: Record<string, string> = {
    "production-branch": "main",
    "duckpost-endpoint": endpoint,
    "include-diff-metadata": "false",
  };
  return {
    debug: vi.fn(),
    getInput: vi.fn((name: string) => inputs[name] ?? ""),
    info: vi.fn(),
    setFailed: vi.fn(),
    setSecret: vi.fn(),
    warning: vi.fn(),
  };
}

describe("development endpoint", () => {
  it("accepts the development HTTPS host and keeps the production default", () => {
    expect(validateDuckPostEndpoint(developmentEndpoint)).toBe(developmentEndpoint);
    expect(validateDuckPostEndpoint("")).toBe("https://duckpost.app/api/ai-release-jobs");
  });

  it.each([developmentEndpoint, ""])("posts the same payload and authentication for input %s", async (endpoint) => {
    const core = createCore(endpoint);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 202 }));

    await run(core, context, { DUCKPOST_TOKEN: "test-token" }, fetchImpl, vi.fn());

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(endpoint || "https://duckpost.app/api/ai-release-jobs");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "github:duckpost/app:push:refs/heads/main:abc123:main",
    });
    expect(JSON.parse(request?.body as string)).toEqual({
      before_sha: null,
      changed_files: [],
      commit_sha: "abc123",
      commits: [{ message: "push on refs/heads/main", sha: "abc123" }],
      compare_url: null,
      diff_summary: "Diff metadata collection disabled by action input.",
      event_name: "push",
      idempotency_key: "github:duckpost/app:push:refs/heads/main:abc123:main",
      release_branch: "main",
      repository_name: "app",
      repository_owner: "duckpost",
    });
  });

  it.each([
    "http://dev.duckpost.app/api/ai-release-jobs",
    "https://dev.duckpost.app.evil.example/api/ai-release-jobs",
    "https://evil.example/api/ai-release-jobs",
    "https://other.duckpost.app/api/ai-release-jobs",
    "https://dev.duckpost.app@evil.example/api/ai-release-jobs",
  ])("rejects unsafe endpoint %s before sending the token", async (endpoint) => {
    const core = createCore(endpoint);
    const fetchImpl = vi.fn<typeof fetch>();

    await run(core, context, { DUCKPOST_TOKEN: "test-token" }, fetchImpl, vi.fn());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("duckpost-endpoint"));
    expect(core.setSecret).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
