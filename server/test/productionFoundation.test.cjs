const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { parseServerEnvironment } = require("../dist/config/env");

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
    const missing = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).message, "API route not found.");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
