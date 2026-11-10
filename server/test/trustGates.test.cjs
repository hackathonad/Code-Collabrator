// Configure the deployment before the build reads its environment.
process.env.GITHUB_TOKEN = "fake-shared-token";
process.env.GITHUB_SHARED_TOKEN_ENABLED = "true";
process.env.GITHUB_ALLOWED_REPOS = "acme/*,octo/allowed";
process.env.API_RATE_LIMIT = "2000";
process.env.GITHUB_API_RATE_LIMIT = "200";
process.env.GIT_WRITE_RATE_LIMIT = "100";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { env, parseServerEnvironment } = require("../dist/config/env");
const { ExecutionService, ExecutionServiceError } = require("../dist/modules/execution/executionService");
const { createValidationRunner } = require("../dist/modules/agent/validationRunner");
const { evaluateRepoAccess, matchesAllowlist, parseRepoAllowlist } = require("../dist/modules/git/githubPolicy");
const { resetRoomRouteLimiters } = require("../dist/routes/roomRoutes");

// ---- A tiny in-process stand-in for api.github.com. Everything else uses the real fetch. ----
const realFetch = globalThis.fetch;
const githubCalls = [];
const sha = (character) => character.repeat(40);
const repository = (owner, name, isPrivate) => ({ id: `${owner}/${name}`.length, name, owner: { login: owner }, full_name: `${owner}/${name}`, private: isPrivate, default_branch: "main", html_url: `https://github.com/${owner}/${name}`, description: null });
const repositories = {
  "acme/app": repository("acme", "app", true),
  "octo/allowed": repository("octo", "allowed", false),
  "other/public": repository("other", "public", false),
  "other/secret": repository("other", "secret", true)
};
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith("https://api.github.com")) return realFetch(input, init);
  const method = init?.method ?? "GET";
  const path = new URL(url).pathname;
  githubCalls.push(`${method} ${path}`);
  if (path === "/user") return jsonResponse({ login: "token-owner" });
  if (path === "/user/repos") return jsonResponse(Object.values(repositories));
  const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return jsonResponse({ message: "Not Found" }, 404);
  const [, owner, name, rest = ""] = match;
  const found = repositories[`${owner}/${name}`];
  if (!found) return jsonResponse({ message: "Not Found" }, 404);
  if (rest === "") return jsonResponse(found);
  if (rest === "/branches") return jsonResponse([{ name: "main", commit: { sha: sha("a") }, protected: false }]);
  if (rest === "/issues") return jsonResponse([]);
  if (rest.startsWith("/git/ref/heads/")) return jsonResponse({ object: { sha: sha("1") } });
  if (rest.startsWith("/git/trees/")) return jsonResponse({ tree: [{ path: "README.md", sha: sha("b"), type: "blob", size: 5 }] });
  if (rest.startsWith("/git/blobs/")) return jsonResponse({ encoding: "base64", content: Buffer.from("hello").toString("base64") });
  if (rest === "/commits") return jsonResponse([{ sha: sha("c"), commit: { message: "init", author: { name: "Ada", date: "2026-01-01T00:00:00Z" } } }]);
  if (rest === "/git/refs" && method === "POST") return jsonResponse({ ref: "refs/heads/feature", object: { sha: sha("1") } }, 201);
  if (rest === "/pulls" && method === "POST") return jsonResponse({ number: 7, html_url: "https://github.com/acme/app/pull/7", state: "open", title: "t", head: { ref: "feature" }, base: { ref: "main" } }, 201);
  if (rest === "/pulls") return jsonResponse([]);
  return jsonResponse({ message: "Not Found" }, 404);
};
test.after(() => { globalThis.fetch = realFetch; });

const withServer = async (work) => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const response = await realFetch(baseUrl + path, {
      signal: AbortSignal.timeout(8_000),
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { "X-Guest-Token": token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try { await work({ call, baseUrl }); } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
};

test("a shared GitHub token is ignored unless the operator opts in, and the operator is told", () => {
  const ignored = parseServerEnvironment({ NODE_ENV: "test", GITHUB_TOKEN: "secret-token" });
  assert.equal(ignored.config.githubToken, "", "the token must not be usable without the explicit opt-in");
  assert.ok(ignored.issues.some((issue) => issue.includes("GITHUB_SHARED_TOKEN_ENABLED")));

  const enabled = parseServerEnvironment({ NODE_ENV: "test", GITHUB_TOKEN: "secret-token", GITHUB_SHARED_TOKEN_ENABLED: "true" });
  assert.equal(enabled.config.githubToken, "secret-token");
  assert.ok(enabled.issues.some((issue) => issue.includes("GITHUB_ALLOWED_REPOS")), "an empty allowlist is called out");

  const scoped = parseServerEnvironment({ NODE_ENV: "test", GITHUB_TOKEN: "t", GITHUB_SHARED_TOKEN_ENABLED: "true", GITHUB_ALLOWED_REPOS: "Acme/App, acme/*, not-valid, ../evil/x, a/b/c" });
  assert.deepEqual(scoped.config.githubAllowedRepos, ["acme/app", "acme/*"], "entries are normalized and malformed ones dropped");
  assert.equal(scoped.issues.some((issue) => issue.includes("GITHUB_ALLOWED_REPOS")), false);
});

test("project checks default off in production and on for development, with an explicit override", () => {
  assert.equal(parseServerEnvironment({ NODE_ENV: "production" }).config.serverProjectChecks, false);
  assert.equal(parseServerEnvironment({ NODE_ENV: "development" }).config.serverProjectChecks, true);
  assert.equal(parseServerEnvironment({ NODE_ENV: "production", ENABLE_SERVER_PROJECT_CHECKS: "true" }).config.serverProjectChecks, true);
  assert.equal(parseServerEnvironment({ NODE_ENV: "development", ENABLE_SERVER_PROJECT_CHECKS: "false" }).config.serverProjectChecks, false);
});

test("repository policy: allowlist is strict; without one only public reads are allowed", () => {
  assert.deepEqual(parseRepoAllowlist(undefined), []);
  assert.equal(matchesAllowlist("Acme", "Anything", ["acme/*"]), true);
  assert.equal(matchesAllowlist("acme", "app", ["acme/app"]), true);
  assert.equal(matchesAllowlist("acme", "other", ["acme/app"]), false);

  const allowlist = ["acme/*"];
  assert.equal(evaluateRepoAccess({ owner: "acme", repository: "app", mode: "write", allowlist }).allowed, true);
  assert.equal(evaluateRepoAccess({ owner: "acme", repository: "app", mode: "read", allowlist, isPrivate: true }).allowed, true, "an allowlisted private repository is readable");
  assert.equal(evaluateRepoAccess({ owner: "evil", repository: "x", mode: "read", allowlist, isPrivate: false }).allowed, false, "a public repository outside the allowlist is still refused");

  assert.equal(evaluateRepoAccess({ owner: "o", repository: "r", mode: "read", allowlist: [], isPrivate: false }).allowed, true);
  assert.equal(evaluateRepoAccess({ owner: "o", repository: "r", mode: "read", allowlist: [], isPrivate: true }).allowed, false);
  assert.equal(evaluateRepoAccess({ owner: "o", repository: "r", mode: "read", allowlist: [] }).allowed, false, "unknown privacy is treated as private");
  assert.equal(evaluateRepoAccess({ owner: "o", repository: "r", mode: "write", allowlist: [], isPrivate: false }).allowed, false, "no writes without an allowlist");
});

test("guests can only reach allowlisted repositories through the shared token", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ call }) => {
    const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
    const { roomId } = created.body.room;
    const owner = created.body.participant.guestToken;
    const root = `/api/rooms/${roomId}`;

    assert.equal((await call("POST", `${root}/github/connect`, { token: owner })).status, 200);

    const listed = await call("GET", `${root}/github/repositories`, { token: owner });
    assert.deepEqual(listed.body.repositories.map((entry) => entry.fullName).sort(), ["acme/app", "octo/allowed"], "other repositories the token can see are not offered");

    const refused = await call("GET", `${root}/github/repositories/other/public`, { token: owner });
    assert.equal(refused.status, 403);
    assert.match(refused.body.message, /allowlist/);
    assert.equal((await call("GET", `${root}/github/repositories/acme/app`, { token: owner })).status, 200, "an allowlisted private repository is available");
    assert.equal((await call("GET", `${root}/github/repositories/other/public/branches`, { token: owner })).status, 403);
    assert.equal((await call("GET", `${root}/github/repositories/other/secret/issues`, { token: owner })).status, 403);

    githubCalls.length = 0;
    const deniedImport = await call("POST", `${root}/project/import`, { token: owner, body: { owner: "other", repository: "secret" } });
    assert.equal(deniedImport.status, 403);
    assert.equal(githubCalls.some((entry) => entry.includes("/git/trees") || entry.includes("/git/blobs")), false, "no repository contents are fetched for a denied import");

    const imported = await call("POST", `${root}/project/import`, { token: owner, body: { owner: "acme", repository: "app" } });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal((await call("POST", `${root}/git/branch`, { token: owner, body: { branch: "feature" } })).status, 200, "writes to an allowlisted repository work");
    assert.equal((await call("POST", `${root}/pull-requests`, { token: owner, body: { title: "A change" } })).status, 200);
  });
});

test("with no allowlist the shared token is read-only and public-only", async () => {
  resetRoomRouteLimiters();
  const original = env.githubAllowedRepos;
  await withServer(async ({ call }) => {
    const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
    const { roomId } = created.body.room;
    const owner = created.body.participant.guestToken;
    const root = `/api/rooms/${roomId}`;
    assert.equal((await call("POST", `${root}/github/connect`, { token: owner })).status, 200);
    assert.equal((await call("POST", `${root}/project/import`, { token: owner, body: { owner: "acme", repository: "app" } })).status, 200);

    env.githubAllowedRepos = [];
    try {
      const listed = await call("GET", `${root}/github/repositories`, { token: owner });
      assert.deepEqual(listed.body.repositories.map((entry) => entry.fullName).sort(), ["octo/allowed", "other/public"], "private repositories are hidden");
      assert.equal((await call("GET", `${root}/github/repositories/other/public`, { token: owner })).status, 200);
      const privateRead = await call("GET", `${root}/github/repositories/other/secret`, { token: owner });
      assert.equal(privateRead.status, 403);
      assert.match(privateRead.body.message, /Private repositories/);
      assert.equal((await call("GET", `${root}/github/repositories/other/secret/branches`, { token: owner })).status, 403);
      assert.equal((await call("POST", `${root}/project/import`, { token: owner, body: { owner: "acme", repository: "app" } })).status, 403, "a private repository cannot be imported");

      for (const [path, body] of [["git/branch", { branch: "feature" }], ["pull-requests", { title: "A change" }]]) {
        const response = await call("POST", `${root}/${path}`, { token: owner, body });
        assert.equal(response.status, 403, `${path} is a write`);
        assert.match(response.body.message, /Writing to GitHub is disabled/, `${path} must be refused as a write, not merely as a private read`);
      }
    } finally {
      env.githubAllowedRepos = original;
    }
  });
});

test("an execution service that is turned off refuses fixed checks and says why", () => {
  const off = new ExecutionService({ enabled: false });
  const capabilities = off.capabilities();
  assert.equal(capabilities.available, false);
  assert.ok(capabilities.actions.every((action) => action.available === false));
  assert.match(capabilities.message, /turned off/);
  for (const action of ["tests", "build", "lint", "typecheck", "diagnostics"]) {
    assert.throws(() => off.start({ roomId: "r", workspaceId: "w", ownerId: "o", action }), (error) => error instanceof ExecutionServiceError && error.code === "EXECUTION_DISABLED", action);
  }
  assert.equal(off.start({ roomId: "r", workspaceId: "w", ownerId: "o", action: "run" }).status, "unavailable", "the honest Run notice still works");

  const on = new ExecutionService({ enabled: true });
  assert.equal(on.capabilities().available, true);
  assert.equal(on.capabilities().actions.find((action) => action.action === "tests").available, true);
  assert.equal(on.capabilities().actions.find((action) => action.action === "run").available, false);
});

test("a disabled validation runner never starts a process and reports unavailable", async () => {
  const result = await createValidationRunner({ enabled: false })("tests");
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.exitCode, null);
  assert.match(result.summary, /unavailable/);
});

test("when project checks are off, every entry point reports it instead of running anything", async () => {
  resetRoomRouteLimiters();
  const original = env.serverProjectChecks;
  env.serverProjectChecks = false;
  try {
    await withServer(async ({ call }) => {
      const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
      const { roomId } = created.body.room;
      const owner = created.body.participant.guestToken;

      const ready = await call("GET", "/ready");
      assert.equal(ready.body.execution.available, false);

      const capabilities = await call("GET", `/api/rooms/${roomId}/execution/capabilities`, { token: owner });
      assert.equal(capabilities.body.capabilities.available, false);

      const started = await call("POST", `/api/rooms/${roomId}/execution`, { token: owner, body: { action: "tests" } });
      assert.equal(started.status, 403);
      assert.equal(started.body.code, "EXECUTION_DISABLED");

      const validated = await call("POST", `/api/ai/rooms/${roomId}/agent/validate`, { token: owner, body: { category: "lint" } });
      assert.equal(validated.status, 422);
      assert.equal(validated.body.validation.status, "unavailable");
      assert.match(validated.body.validation.summary, /turned off/);
    });
  } finally {
    env.serverProjectChecks = original;
  }
});
