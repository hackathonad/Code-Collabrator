const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { GitHubApiError, GitHubClient, validateBranchName, validateRepositoryPath, validateRepositoryPart } = require("../dist/modules/git/githubClient");
const { projectService } = require("../dist/modules/git/projectService");
const { createWorkspaceFromProjectFiles, createWorkspace } = require("../dist/modules/rooms/workspaceService");
const { roomStore } = require("../dist/modules/rooms/roomStore");
const { createApp } = require("../dist/app");

const response = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });

test("GitHub identifiers and repository paths reject traversal and unsafe files", () => {
  assert.equal(validateRepositoryPart("octo-org", "owner"), "octo-org");
  assert.throws(() => validateRepositoryPart("octo/org", "owner"), (error) => error.code === "INVALID_REPOSITORY");
  assert.throws(() => validateBranchName("feature/../main"), (error) => error.code === "INVALID_BRANCH");
  assert.throws(() => validateRepositoryPath("src/../.env"), (error) => error.code === "UNSAFE_REPOSITORY_PATH");
  assert.throws(() => validateRepositoryPath("secrets.txt"), (error) => error.code === "UNSAFE_REPOSITORY_PATH");
  assert.equal(validateRepositoryPath("src/index.ts"), "src/index.ts");
});

test("GitHub client uses the fixed API origin, bounds responses, and normalizes failures", async () => {
  const calls = [];
  const client = new GitHubClient({ token: "server-only-token", fetcher: async (url, init) => { calls.push({ url, init }); return response({ login: "octocat" }); } });
  assert.deepEqual(await client.getAuthenticatedUser(), { login: "octocat" });
  assert.equal(calls[0].url, "https://api.github.com/user");
  assert.equal(calls[0].init.headers.Authorization, "Bearer server-only-token");
  const failing = new GitHubClient({ token: "server-only-token", fetcher: async () => response({ message: "rate limited" }, 403, { "x-ratelimit-remaining": "0" }) });
  await assert.rejects(() => failing.getAuthenticatedUser(), (error) => error instanceof GitHubApiError && error.code === "GITHUB_RATE_LIMITED" && !error.message.includes("rate limited"));
});

test("project status, staging, bounded diff, and push bookkeeping stay workspace scoped", () => {
  projectService.clear();
  const workspace = createWorkspace("owner-a", "workspace-a", "javascript", "console.log('one')", "Project");
  projectService.importProject({ roomId: "aaaaaaaa", workspaceId: workspace.id, name: "Project", description: null, owner: "octocat", repository: "demo", repositoryUrl: "https://github.com/octocat/demo", defaultBranch: "main", branch: "main", head: "1111111", files: [{ path: "main.js", content: "console.log('one')" }] });
  const imported = createWorkspaceFromProjectFiles(workspace, [{ path: "main.js", content: "console.log('one')" }], "owner-a", "Project");
  let summary = projectService.getSummary(imported);
  assert.equal(summary.status.state, "clean");
  imported.files[imported.activeFileId].content = "console.log('two')";
  summary = projectService.getSummary(imported);
  assert.equal(summary.status.entries[0].status, "modified");
  projectService.stage("aaaaaaaa", imported, "main.js", true);
  assert.equal(projectService.planCommit("aaaaaaaa", imported, "update output").files.length, 1);
  projectService.markPushed("aaaaaaaa", imported, "2222222", "update output", "octocat");
  assert.equal(projectService.getSummary(imported).status.state, "clean");
  assert.equal(projectService.getSummary({ ...imported, id: "other-workspace" }), null);
});

test("room project endpoints preserve guest authorization and expose no GitHub token", async () => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${baseUrl}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "Owner" }) }).then((res) => res.json());
    const roomId = created.room.roomId; const token = created.participant.guestToken;
    const status = await fetch(`${baseUrl}/api/rooms/${roomId}/github/status?guestToken=${encodeURIComponent(token)}`).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(status.status, 200);
    assert.equal(status.body.connection.connected, false);
    assert.equal(JSON.stringify(status.body).includes("server-only-token"), false);
    const unauthorized = await fetch(`${baseUrl}/api/rooms/${roomId}/project`).then((res) => res.status);
    assert.equal(unauthorized, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
