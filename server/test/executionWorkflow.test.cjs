const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const { ExecutionService } = require("../dist/modules/execution/executionService");
const { createApp } = require("../dist/app");

const waitFor = async (check, timeout = 500) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for execution");
};

const fakeChild = (behavior = "complete", output = "ok") => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    if (behavior === "hang") process.nextTick(() => child.emit("close", 143));
    return true;
  };
  if (behavior === "complete") process.nextTick(() => { child.stdout.emit("data", Buffer.from(output)); child.emit("close", 0); });
  return child;
};

test("execution capabilities expose only fixed safe actions", () => {
  const service = new ExecutionService({ maxConcurrent: 1 });
  const capabilities = service.capabilities();
  assert.equal(capabilities.scope, "server-project");
  assert.equal(capabilities.actions.find((entry) => entry.action === "run").available, false);
  assert.equal(capabilities.actions.some((entry) => entry.action === "tests" && entry.available), true);
});

test("execution is room/workspace scoped, deduplicated, bounded, and uses shell false", async () => {
  let spawnOptions;
  const service = new ExecutionService({ outputLimit: 24, spawnProcess: (command, args, options) => { spawnOptions = { command, args, options }; return fakeChild("complete", "123456789012345678901234567890"); } });
  const first = service.start({ roomId: "room-a", workspaceId: "workspace-a", ownerId: "user-a", action: "tests", requestId: "request-1" });
  const duplicate = service.start({ roomId: "room-a", workspaceId: "workspace-a", ownerId: "user-a", action: "tests", requestId: "request-1" });
  assert.equal(duplicate.executionId, first.executionId);
  const result = await waitFor(() => service.list("room-a", "workspace-a")[0].status === "completed" && service.list("room-a", "workspace-a")[0]);
  assert.equal(result.output.includes("[…output truncated…]"), true);
  assert.equal(spawnOptions.options.shell, false);
  assert.equal(spawnOptions.options.cwd, process.cwd());
  assert.equal(spawnOptions.args.includes("test"), true);
  assert.equal(service.get(first.executionId, "room-b", "workspace-a"), null);
});

test("targeted execution rejects traversal and arbitrary command-shaped input", () => {
  const service = new ExecutionService();
  assert.throws(() => service.start({ roomId: "room-a", workspaceId: "workspace-a", ownerId: "user-a", action: "targeted-tests", target: "server/test/../src/index.ts" }), (error) => error.code === "EXECUTION_NOT_ALLOWED");
  assert.throws(() => service.start({ roomId: "room-a", workspaceId: "workspace-a", ownerId: "user-a", action: "targeted-tests", target: "server/test/good.test.cjs && whoami" }), (error) => error.code === "EXECUTION_NOT_ALLOWED");
});

test("targeted execution starts an existing test through the fixed node executable", async () => {
  let spawned;
  const service = new ExecutionService({ spawnProcess: (command, args) => { spawned = { command, args }; return fakeChild("complete", "targeted"); } });
  const record = service.start({ roomId: "room-target", workspaceId: "workspace-target", ownerId: "user-target", action: "targeted-tests", target: "server/test/productionSmoke.test.cjs" });
  const result = await waitFor(() => service.get(record.executionId, "room-target", "workspace-target")?.status === "completed" && service.get(record.executionId, "room-target", "workspace-target"));
  assert.equal(result.status, "completed");
  assert.equal(spawned.command, "node");
  assert.deepEqual(spawned.args.slice(0, 2), ["--test", spawned.args[1]]);
});

test("execution cancellation and timeout become terminal states", async () => {
  const cancelledService = new ExecutionService({ spawnProcess: () => fakeChild("hang") });
  const cancelled = cancelledService.start({ roomId: "room-c", workspaceId: "workspace-c", ownerId: "user-c", action: "tests" });
  await waitFor(() => cancelledService.get(cancelled.executionId, "room-c", "workspace-c")?.status === "running");
  cancelledService.cancel(cancelled.executionId, "room-c", "workspace-c");
  assert.equal((await waitFor(() => cancelledService.get(cancelled.executionId, "room-c", "workspace-c")?.status === "cancelled" && cancelledService.get(cancelled.executionId, "room-c", "workspace-c"))).status, "cancelled");

  const timedOutService = new ExecutionService({ timeoutMs: 5, spawnProcess: () => fakeChild("hang") });
  const timedOut = timedOutService.start({ roomId: "room-t", workspaceId: "workspace-t", ownerId: "user-t", action: "lint" });
  assert.equal((await waitFor(() => timedOutService.get(timedOut.executionId, "room-t", "workspace-t")?.status === "timed_out" && timedOutService.get(timedOut.executionId, "room-t", "workspace-t"))).status, "timed_out");
});

test("execution routes retain guest authorization and return unavailable run state honestly", async () => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${baseUrl}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "Runner" }) }).then((response) => response.json());
    const roomId = created.room.roomId;
    const guestToken = created.participant.guestToken;
    const invalid = await fetch(`${baseUrl}/api/rooms/${roomId}/execution`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestToken, action: "rm" }) }).then(async (response) => ({ status: response.status, body: await response.json() }));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "EXECUTION_NOT_ALLOWED");
    const unavailable = await fetch(`${baseUrl}/api/rooms/${roomId}/execution`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestToken, action: "run" }) }).then(async (response) => ({ status: response.status, body: await response.json() }));
    assert.equal(unavailable.status, 202);
    assert.equal(unavailable.body.execution.status, "unavailable");
    assert.equal(JSON.stringify(unavailable.body).includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
