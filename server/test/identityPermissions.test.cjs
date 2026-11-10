process.env.GITHUB_TOKEN = "";
process.env.API_RATE_LIMIT = "2000";
process.env.AI_IP_RATE_LIMIT = "1000";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { env } = require("../dist/config/env");
const {
  GUEST_TOKEN_TTL_MS,
  LEGACY_AUTH_SUNSET_MS,
  createGuestSessionToken,
  guestTokenFromRequest,
  inspectGuestSessionToken,
  verifyGuestSessionToken
} = require("../dist/middleware/guestSession");
const { ROLE_PERMISSIONS, ROOM_ROLES, can, canApprovePatch } = require("../dist/modules/rooms/roomPermissions");
const { registerAgentProposal } = require("../dist/modules/agent/agentEvents");
const { patchIdFor } = require("../dist/modules/agent/agentSecurity");
// Mirrors the tool registry: the ID hashes JSON arrays of the files in the patch.
const singleFilePatchId = (roomId, fileId, expected, replacement) => patchIdFor(roomId, fileId, JSON.stringify([expected]), JSON.stringify([replacement]));
const { startAgentTask } = require("../dist/modules/agent/agentTaskHistory");
const { roomStore } = require("../dist/modules/rooms/roomStore");
const { resetAIBudget } = require("../dist/services/aiBudget");
const { resetRoomRouteLimiters } = require("../dist/routes/roomRoutes");
const { sanitizeRoomId } = require("../dist/utils/validation");

const ROOM = "abcdef0123456789".slice(0, 12);
const USER = crypto.randomUUID();
const legacyToken = (roomId, userId) => `${userId}.${crypto.createHmac("sha256", env.guestSessionSecret).update(`${roomId}:${userId}`).digest("base64url")}`;

const withServer = async (work) => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, token, headers = {} } = {}) => {
    const response = await fetch(baseUrl + path, {
      signal: AbortSignal.timeout(8_000),
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { "X-Guest-Token": token } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) };
  };
  try { await work({ baseUrl, call }); } finally { await new Promise((resolve) => server.close(resolve)); }
};

test("session tokens are room-bound, expire, and reject tampering", () => {
  const now = Date.now();
  const token = createGuestSessionToken(ROOM, USER, now);
  assert.match(token, /^v2\.[0-9a-f-]{36}\.\d+\.[\w-]+$/);
  assert.equal(verifyGuestSessionToken(ROOM, token, now), USER);

  const inspected = inspectGuestSessionToken(ROOM, token, now);
  assert.equal(inspected.legacy, false);
  assert.ok(Math.abs(inspected.expiresAt - (now + GUEST_TOKEN_TTL_MS)) < 1_000);

  assert.equal(verifyGuestSessionToken("ffffffffffff", token, now), "", "a token for one room is useless in another");
  assert.equal(verifyGuestSessionToken(ROOM, token, now + GUEST_TOKEN_TTL_MS + 5_000), "", "an expired token is rejected");

  const [version, userId, exp, signature] = token.split(".");
  assert.equal(verifyGuestSessionToken(ROOM, [version, userId, String(Number(exp) + 86_400), signature].join("."), now), "", "extending the expiry invalidates the signature");
  assert.equal(verifyGuestSessionToken(ROOM, [version, crypto.randomUUID(), exp, signature].join("."), now), "", "swapping the user invalidates the signature");
  assert.equal(verifyGuestSessionToken(ROOM, `${token}x`, now), "");
  assert.equal(verifyGuestSessionToken(ROOM, "", now), "");
  assert.equal(verifyGuestSessionToken(ROOM, "v2.not-a-uuid.1.sig", now), "");
});

test("pre-expiry tokens are accepted only until the sunset and are flagged for upgrade", () => {
  const legacy = legacyToken(ROOM, USER);
  const before = LEGACY_AUTH_SUNSET_MS - 86_400_000;
  assert.deepEqual(inspectGuestSessionToken(ROOM, legacy, before), { userId: USER, legacy: true, expiresAt: null });
  assert.equal(inspectGuestSessionToken(ROOM, legacy, LEGACY_AUTH_SUNSET_MS + 1), null);
  assert.equal(inspectGuestSessionToken("ffffffffffff", legacy, before), null, "legacy tokens stay room-bound");

  const afterSunset = LEGACY_AUTH_SUNSET_MS + 86_400_000;
  const fresh = createGuestSessionToken(ROOM, USER, afterSunset);
  assert.equal(verifyGuestSessionToken(ROOM, fresh, afterSunset), USER, "v2 tokens are unaffected by the legacy sunset");
});

test("a token is read from the header first, then the body, and from the query string only before the sunset", () => {
  const request = (overrides) => ({ headers: {}, body: undefined, query: {}, ...overrides });
  const before = LEGACY_AUTH_SUNSET_MS - 1_000;
  const after = LEGACY_AUTH_SUNSET_MS + 1_000;
  assert.equal(guestTokenFromRequest(request({ headers: { "x-guest-token": "header" }, body: { guestToken: "body" }, query: { guestToken: "query" } }), before), "header");
  assert.equal(guestTokenFromRequest(request({ body: { guestToken: "body" }, query: { guestToken: "query" } }), before), "body");
  assert.equal(guestTokenFromRequest(request({ query: { guestToken: "query" } }), before), "query");
  assert.equal(guestTokenFromRequest(request({ query: { guestToken: "query" } }), after), "", "URL-borne tokens leak into logs and stop working at the sunset");
  assert.equal(guestTokenFromRequest(request({ headers: { "x-guest-token": "header" } }), after), "header");
});

test("room IDs: new rooms are 12 hex characters, legacy 8-character IDs still validate", () => {
  const created = roomStore.createRoom("Owner", "javascript");
  assert.match(created.room.roomId, /^[a-f0-9]{12}$/);
  assert.equal(sanitizeRoomId("A1B2C3D4"), "a1b2c3d4");
  assert.equal(sanitizeRoomId("a1b2c3d4e5f6"), "a1b2c3d4e5f6");
  for (const invalid of ["a1b2c3d", "a1b2c3d4e", "a1b2c3d4e5f", "a1b2c3d4e5f67", "g1b2c3d4", "", "../etc/passwd"]) assert.equal(sanitizeRoomId(invalid), "", invalid);
});

test("the permission matrix is explicit: viewers are read-only and approval rights are narrow", () => {
  assert.deepEqual([...ROOM_ROLES].sort(), ["guest", "member", "moderator", "owner", "viewer"]);
  assert.deepEqual(ROLE_PERMISSIONS.viewer, ["chat"]);
  for (const action of ["edit", "manage-content", "use-ai", "run-checks", "git-local"]) {
    assert.equal(can("guest", action), true, `guest can ${action}`);
    assert.equal(can("viewer", action), false, `viewer cannot ${action}`);
  }
  assert.equal(can("guest", "git-remote"), false);
  assert.equal(can("guest", "github-connect"), false);
  assert.equal(can("member", "git-remote"), true);
  assert.equal(can("member", "github-connect"), false);
  assert.equal(can("moderator", "github-connect"), true);
  assert.equal(can(undefined, "chat"), false);

  assert.equal(canApprovePatch("guest", "u1", "u1"), true, "the requester can approve their own task's patch");
  assert.equal(canApprovePatch("guest", "u2", "u1"), false, "another guest cannot approve it");
  assert.equal(canApprovePatch("member", "u2", "u1"), true);
  assert.equal(canApprovePatch("viewer", "u1", "u1"), false, "a viewer can never approve, even as the nominal requester");
  assert.equal(canApprovePatch("guest", "u1", undefined), false);
});

test("a viewer cannot edit or change files but can still chat", () => {
  const created = roomStore.createRoom("Owner", "javascript");
  const roomId = created.room.roomId;
  const viewer = roomStore.joinRoom(roomId, "Viewer").participant;
  roomStore.updateRole(roomId, created.room.ownerId, viewer.userId, "viewer");
  assert.throws(() => roomStore.updateCode(roomId, viewer.userId, "hacked"), /Permission denied/);
  const workspace = roomStore.getRoomSnapshot(roomId).workspace;
  assert.throws(() => roomStore.applyWorkspaceOperation(roomId, viewer.userId, { id: crypto.randomUUID(), type: "create-file", name: "x.js", parentId: workspace.rootFolderId }), /Permission denied/);
  assert.throws(() => roomStore.updateLanguage(roomId, viewer.userId, "python", true), /Permission denied/);
  assert.equal(roomStore.addChatMessage(roomId, viewer.userId, "can I follow along?").message, "can I follow along?");
  assert.notEqual(roomStore.getRoomSnapshot(roomId).code, "hacked");
});

test("header transport works over HTTP and CORS allows the header", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ call }) => {
    const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
    const { roomId } = created.body.room;
    const { guestToken } = created.body.participant;
    assert.match(guestToken, /^v2\./);

    assert.equal((await call("GET", `/api/rooms/${roomId}`, { token: guestToken })).status, 200, "header token is accepted");
    assert.equal((await call("GET", `/api/rooms/${roomId}`)).status, 403, "no token, no access");
    assert.equal((await call("GET", `/api/rooms/${roomId}`, { token: "v2.garbage" })).status, 403);
  });

  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/rooms`, {
      method: "OPTIONS",
      headers: { Origin: env.clientOrigins[0], "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-guest-token" }
    });
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /x-guest-token/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("session refresh upgrades old tokens, and refuses strangers and other rooms' tokens", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ call }) => {
    const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
    const { roomId } = created.body.room;
    const owner = created.body.participant;

    const upgraded = await call("POST", `/api/rooms/${roomId}/session/refresh`, { token: legacyToken(roomId, owner.userId) });
    assert.equal(upgraded.status, 200);
    assert.match(upgraded.body.guestToken, /^v2\./);
    assert.equal(verifyGuestSessionToken(roomId, upgraded.body.guestToken), owner.userId, "the refreshed token keeps the same identity");
    assert.ok(upgraded.body.expiresAt > Date.now());

    assert.equal((await call("POST", `/api/rooms/${roomId}/session/refresh`, { token: owner.guestToken })).status, 200);
    assert.equal((await call("POST", `/api/rooms/${roomId}/session/refresh`, { token: "nonsense" })).status, 401);
    assert.equal((await call("POST", `/api/rooms/${roomId}/session/refresh`)).status, 401);

    const other = await call("POST", "/api/rooms", { body: { username: "Other" } });
    assert.equal((await call("POST", `/api/rooms/${roomId}/session/refresh`, { token: other.body.participant.guestToken })).status, 401, "another room's token cannot be exchanged");

    const stranger = createGuestSessionToken(roomId, crypto.randomUUID());
    assert.equal((await call("POST", `/api/rooms/${roomId}/session/refresh`, { token: stranger })).status, 403, "a valid signature alone is not membership");

    const rejoin = await call("POST", `/api/rooms/${roomId}/join`, { body: { username: "Owner", guestToken: legacyToken(roomId, owner.userId) } });
    assert.equal(rejoin.status, 200);
    assert.match(rejoin.body.participant.guestToken, /^v2\./, "joining with an old token also upgrades it");
    assert.equal(rejoin.body.participant.userId, owner.userId);
  });
});

test("role enforcement over HTTP: viewers cannot use AI or run checks; guests cannot connect GitHub or write remotely", async () => {
  resetRoomRouteLimiters();
  resetAIBudget();
  await withServer(async ({ call }) => {
    const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
    const { roomId, ownerId } = created.body.room;
    const owner = created.body.participant;
    const viewer = (await call("POST", `/api/rooms/${roomId}/join`, { body: { username: "Viewer" } })).body.participant;
    const guest = (await call("POST", `/api/rooms/${roomId}/join`, { body: { username: "Guest" } })).body.participant;
    roomStore.updateRole(roomId, ownerId, viewer.userId, "viewer");

    const aiBody = { prompt: "hello", settings: { provider: "custom", model: "none" } };
    const viewerAI = await call("POST", `/api/ai/rooms/${roomId}/complete`, { token: viewer.guestToken, body: aiBody });
    assert.equal(viewerAI.status, 403);
    assert.equal(viewerAI.body.code, "FORBIDDEN_ROLE");
    const guestAI = await call("POST", `/api/ai/rooms/${roomId}/complete`, { token: guest.guestToken, body: aiBody });
    assert.equal(guestAI.status, 503, "a guest passes the role check and reaches the (unconfigured) provider");

    const viewerAgent = await call("POST", `/api/ai/rooms/${roomId}/agent`, { token: viewer.guestToken, body: { ...aiBody, mode: "ASK" } });
    assert.equal(viewerAgent.status, 403);
    assert.equal(viewerAgent.body.code, "FORBIDDEN_ROLE");
    assert.equal((await call("POST", `/api/ai/rooms/${roomId}/agent/validate`, { token: viewer.guestToken, body: { category: "lint" } })).status, 403);
    assert.equal((await call("POST", `/api/ai/rooms/${roomId}/agent/memory`, { token: viewer.guestToken, body: { summary: "poison" } })).status, 403);

    const viewerRun = await call("POST", `/api/rooms/${roomId}/execution`, { token: viewer.guestToken, body: { action: "run" } });
    assert.equal(viewerRun.status, 403);
    assert.equal(viewerRun.body.code, "FORBIDDEN_ROLE");

    // Viewers can still read.
    assert.equal((await call("GET", `/api/ai/rooms/${roomId}/agent/history`, { token: viewer.guestToken })).status, 200);
    assert.equal((await call("GET", `/api/rooms/${roomId}`, { token: viewer.guestToken })).status, 200);

    const guestConnect = await call("POST", `/api/rooms/${roomId}/github/connect`, { token: guest.guestToken });
    assert.equal(guestConnect.status, 403);
    assert.match(guestConnect.body.message, /owner or a moderator/);
    const ownerConnect = await call("POST", `/api/rooms/${roomId}/github/connect`, { token: owner.guestToken });
    assert.equal(ownerConnect.status, 503, "the owner passes the role check; GitHub itself is not configured in this test");

    for (const [path, body] of [["git/push", {}], ["git/pull", {}], ["git/branch", { branch: "x" }], ["git/switch", { branch: "x" }], ["project/import", { owner: "a", repository: "b" }], ["pull-requests", { title: "t" }]]) {
      const response = await call("POST", `/api/rooms/${roomId}/${path}`, { token: guest.guestToken, body });
      assert.equal(response.status, 403, `${path} needs the member role`);
    }
    assert.equal((await call("POST", `/api/rooms/${roomId}/git/stage`, { token: viewer.guestToken, body: { path: "main.js", staged: true } })).status, 403, "viewers cannot stage");
  });
  resetAIBudget();
});

test("AI patch approval: the requester or a trusted role may approve; other guests and viewers may not", async () => {
  resetRoomRouteLimiters();
  await withServer(async ({ call }) => {
    const created = await call("POST", "/api/rooms", { body: { username: "Owner" } });
    const { roomId, ownerId } = created.body.room;
    const owner = created.body.participant;
    const requester = (await call("POST", `/api/rooms/${roomId}/join`, { body: { username: "Requester" } })).body.participant;
    const bystander = (await call("POST", `/api/rooms/${roomId}/join`, { body: { username: "Bystander" } })).body.participant;
    const viewer = (await call("POST", `/api/rooms/${roomId}/join`, { body: { username: "Viewer" } })).body.participant;
    roomStore.updateRole(roomId, ownerId, viewer.userId, "viewer");

    const room = roomStore.getRoomSnapshot(roomId);
    const file = room.workspace.files[room.workspace.activeFileId];
    const task = startAgentTask({
      roomId, userId: requester.userId, workspaceId: room.workspace.id, currentFileId: file.id, userInstruction: "change the starter", conversation: [], mode: "EDIT", language: room.language,
      settings: { provider: "custom", model: "test-model", temperature: 0, maxTokens: 128, streaming: false, workspaceContextSize: "minimal" }, contextBudget: 8_000
    });
    assert.ok(task);

    const makePatch = (suffix) => ({
      patchId: singleFilePatchId(roomId, file.id, file.content, `// ${suffix}\n${file.content}`), taskId: task.taskId, roomId, workspaceId: room.workspace.id, fileId: file.id, path: file.name,
      baseVersion: room.version, expectedContent: file.content, replacement: `// ${suffix}\n${file.content}`, additions: 1, deletions: 0, preview: "", applied: false, status: "pending"
    });
    const approve = (token, patch) => call("POST", `/api/ai/rooms/${roomId}/agent/patch`, { token, body: { patch } });

    const forBystander = makePatch("bystander");
    registerAgentProposal(forBystander, requester.userId);
    const refusedBystander = await approve(bystander.guestToken, forBystander);
    assert.equal(refusedBystander.status, 403);
    assert.equal(refusedBystander.body.code, "FORBIDDEN_ROLE");
    assert.equal((await approve(viewer.guestToken, forBystander)).status, 403);
    assert.equal((await call("POST", `/api/ai/rooms/${roomId}/agent/proposal`, { token: bystander.guestToken, body: { action: "reject", patchId: forBystander.patchId } })).status, 403, "rejecting is gated the same way");

    const applied = await approve(requester.guestToken, forBystander);
    assert.equal(applied.status, 200, `the requester can approve their own task's patch: ${JSON.stringify(applied.body)}`);
    assert.match(roomStore.getRoomSnapshot(roomId).code, /\/\/ bystander/);

    const freshRoom = roomStore.getRoomSnapshot(roomId);
    const freshFile = freshRoom.workspace.files[freshRoom.workspace.activeFileId];
    const secondReplacement = `// owner\n${freshFile.content}`;
    const second = { ...makePatch("owner"), patchId: singleFilePatchId(roomId, freshFile.id, freshFile.content, secondReplacement), baseVersion: freshRoom.version, expectedContent: freshFile.content, replacement: secondReplacement };
    registerAgentProposal(second, requester.userId);
    assert.equal((await approve(owner.guestToken, second)).status, 200, "the owner can approve someone else's patch");
  });
});
