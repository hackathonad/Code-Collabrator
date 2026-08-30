const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { parseServerEnvironment } = require("../dist/config/env");
const { logSafeEvent } = require("../dist/utils/safeLogger");

test("production configuration keeps a safe frontend default and rejects weak guest secrets", () => {
  const parsed = parseServerEnvironment({ NODE_ENV: "production" });
  assert.equal(parsed.config.isProduction, true);
  assert.deepEqual(parsed.config.clientOrigins, ["https://code-collabrator-client.vercel.app"]);
  assert.ok(parsed.issues.some((issue) => issue.includes("GUEST_SESSION_SECRET")));

  const insecureOrigin = parseServerEnvironment({ NODE_ENV: "production", CLIENT_URL: "http://app.example.test", GUEST_SESSION_SECRET: "a-unique-production-secret-that-is-long-enough" });
  assert.ok(insecureOrigin.issues.some((issue) => issue.includes("HTTPS")));

  const valid = parseServerEnvironment({
    NODE_ENV: "production",
    CLIENT_URL: "https://app.example.test",
    GUEST_SESSION_SECRET: "a-unique-production-secret-that-is-long-enough"
  });
  assert.deepEqual(valid.issues, []);
  assert.deepEqual(valid.config.clientOrigins, ["https://app.example.test"]);
});

test("production safety limits are configurable but never exceed hard bounds", () => {
  const configured = parseServerEnvironment({ NODE_ENV: "test", API_RATE_LIMIT: "99", AI_REQUEST_RATE_LIMIT: "17", AGENT_REQUEST_RATE_LIMIT: "9", AGENT_PATCH_RATE_LIMIT: "7", AGENT_VALIDATION_RATE_LIMIT: "5", AGENT_MAX_ITERATIONS: "8", AGENT_MAX_TOOL_CALLS: "20", AGENT_TIMEOUT_MS: "90000" });
  assert.deepEqual({ api: configured.config.apiRateLimit, ai: configured.config.aiRequestRateLimit, agent: configured.config.agentRequestRateLimit, patch: configured.config.agentPatchRateLimit, validation: configured.config.agentValidationRateLimit, iterations: configured.config.agentMaxIterations, tools: configured.config.agentMaxToolCalls, timeout: configured.config.agentTimeoutMs }, { api: 99, ai: 17, agent: 9, patch: 7, validation: 5, iterations: 8, tools: 20, timeout: 90_000 });
  const invalid = parseServerEnvironment({ NODE_ENV: "test", API_RATE_LIMIT: "0", AGENT_MAX_ITERATIONS: "9", AGENT_MAX_TOOL_CALLS: "21", AGENT_TIMEOUT_MS: "90001" });
  assert.equal(invalid.config.apiRateLimit, 180);
  assert.equal(invalid.config.agentMaxIterations, 8);
  assert.equal(invalid.config.agentMaxToolCalls, 20);
  assert.equal(invalid.config.agentTimeoutMs, 90_000);
});

test("structured safe logging redacts sensitive field names and values", () => {
  const original = console.info;
  const lines = [];
  console.info = (line) => lines.push(line);
  try {
    logSafeEvent("agent", "test", { apiKey: "server-secret-value", authorization: "Bearer private-token", note: "token=embedded-secret" });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("server-secret-value"), false);
  assert.equal(lines[0].includes("Bearer private-token"), false);
  assert.equal(lines[0].includes("embedded-secret"), false);
  assert.match(lines[0], /\"apiKey\":\"\[REDACTED\]\"/);
  assert.match(lines[0], /\"authorization\":\"\[REDACTED\]\"/);
});

test("health, readiness, safe headers, and unknown API handling are available without optional services", async () => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    const ready = await fetch(`${baseUrl}/ready`).then((response) => response.json());
    assert.equal(ready.ok, true);
    assert.equal(typeof ready.persistence.configured, "boolean");
    assert.equal(typeof ready.persistence.healthy, "boolean");
    assert.ok(["not-configured", "healthy", "unavailable"].includes(ready.persistence.status));
    const missing = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).message, "API route not found.");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
