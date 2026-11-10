// Regression: the non-streaming agent route used to abort itself ~1ms after the
// request body was parsed (request "close" fires then on Node >= 16), so a
// working provider always produced "Agent generation was cancelled." and any
// early error response was swallowed, leaving the client hanging.
process.env.API_RATE_LIMIT = "2000";
process.env.AI_IP_RATE_LIMIT = "1000";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { aiService } = require("../dist/modules/ai/aiService");
const { resetAIBudget } = require("../dist/services/aiBudget");

let providerSignal = null;
let providerDelayMs = 150;
aiService.registerProvider({
  id: "custom",
  descriptor: { id: "custom", name: "custom", label: "Fake", available: true, health: "healthy", capabilities: ["chat"], supportsStreaming: false, supportsToolCalling: false, supportsVision: false, supportsLocalModels: false, models: [{ id: "m", label: "m" }], defaultModel: "m" },
  isConfigured: () => true,
  async complete(request) {
    providerSignal = request.signal ?? null;
    await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
    return { content: JSON.stringify({ type: "final", text: "hello from the fake provider" }), provider: "custom", model: "m" };
  }
});

const withServer = async (work) => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await work(baseUrl); } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
};

const startRoom = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Probe" }) });
  const body = await response.json();
  return { roomId: body.room.roomId, token: body.participant.guestToken };
};

const agentRequest = (baseUrl, roomId, token, extra = {}) => fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Guest-Token": token },
  body: JSON.stringify({ prompt: "say hello", mode: "ASK", settings: { provider: "custom", model: "m", streaming: false }, ...extra }),
  ...(extra.signal ? { signal: extra.signal } : {})
});

test("a healthy provider completes over HTTP instead of being cancelled by the request lifecycle", async () => {
  resetAIBudget();
  providerDelayMs = 150;
  await withServer(async (baseUrl) => {
    const { roomId, token } = await startRoom(baseUrl);
    const response = await agentRequest(baseUrl, roomId, token);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.result.stoppedReason, "completed", `unexpected result: ${JSON.stringify(body.result)}`);
    assert.equal(body.result.finalText, "hello from the fake provider");
    assert.ok(body.result.events.some((event) => event.type === "final"));
  });
});

test("early errors reach the client instead of hanging the request", async () => {
  resetAIBudget();
  await withServer(async (baseUrl) => {
    const { roomId, token } = await startRoom(baseUrl);
    const started = Date.now();
    const noSession = await fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", settings: { provider: "custom", model: "m" } }), signal: AbortSignal.timeout(5_000) });
    assert.equal(noSession.status, 401);
    const badSettings = await fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent`, { method: "POST", headers: { "Content-Type": "application/json", "X-Guest-Token": token }, body: JSON.stringify({ prompt: "x", settings: { provider: "nope", model: "m" } }), signal: AbortSignal.timeout(5_000) });
    assert.equal(badSettings.status, 400);
    assert.ok(Date.now() - started < 3_000, "error responses are immediate");
  });
});

test("a client that disconnects mid-run does cancel the provider request", async () => {
  resetAIBudget();
  providerDelayMs = 1_500;
  providerSignal = null;
  await withServer(async (baseUrl) => {
    const { roomId, token } = await startRoom(baseUrl);
    const controller = new AbortController();
    const pending = agentRequest(baseUrl, roomId, token, { signal: controller.signal }).catch(() => "aborted");
    for (let waited = 0; !providerSignal && waited < 2_000; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(providerSignal, "the provider was reached");
    assert.equal(providerSignal.aborted, false, "the run is not cancelled while the client is still connected");
    controller.abort();
    assert.equal(await pending, "aborted");
    for (let waited = 0; !providerSignal.aborted && waited < 2_000; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(providerSignal.aborted, true, "disconnecting aborts the in-flight provider call");
  });
  providerDelayMs = 150;
});
