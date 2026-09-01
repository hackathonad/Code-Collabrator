const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { createApp } = require("../dist/app");
const { projectService } = require("../dist/modules/git/projectService");
const { createWorkspace, createWorkspaceFromProjectFiles, updateWorkspaceFileContent, applyWorkspaceOperation } = require("../dist/modules/rooms/workspaceService");

test("Git diff keeps before/after evidence and records changed files in history", () => {
  projectService.clear();
  const workspace = createWorkspace("batch3-owner", "batch3-workspace", "javascript", "", "Batch 3");
  projectService.importProject({
    roomId: "batch3-room",
    workspaceId: workspace.id,
    name: "Batch 3",
    description: null,
    owner: "octocat",
    repository: "demo",
    repositoryUrl: "https://github.com/octocat/demo",
    defaultBranch: "main",
    branch: "main",
    head: "base-sha",
    files: [{ path: "main.js", content: "console.log('before');" }, { path: "src/helper.js", content: "export const helper = true;" }]
  });
  const imported = createWorkspaceFromProjectFiles(workspace, [{ path: "main.js", content: "console.log('before');" }, { path: "src/helper.js", content: "export const helper = true;" }], "batch3-owner", "Batch 3");
  const main = Object.values(imported.files).find((file) => file.name === "main.js");
  assert.ok(main);
  updateWorkspaceFileContent(imported, main.id, "console.log('after');", "batch3-owner");
  const added = applyWorkspaceOperation(imported, { type: "create-file", parentId: imported.rootFolderId, name: "new.js" }, "batch3-owner");
  updateWorkspaceFileContent(imported, added.id, "export const added = true;", "batch3-owner");

  const diff = projectService.getDiff("batch3-room", imported);
  const mainDiff = diff.find((entry) => entry.path === "main.js");
  const addedDiff = diff.find((entry) => entry.path === "new.js");
  assert.deepEqual({ before: mainDiff.before, after: mainDiff.after, status: mainDiff.status }, { before: "console.log('before');", after: "console.log('after');", status: "modified" });
  assert.equal(addedDiff.status, "untracked");

  projectService.stage("batch3-room", imported, "main.js", true);
  projectService.stage("batch3-room", imported, "new.js", true);
  assert.deepEqual(projectService.planCommit("batch3-room", imported, "feat: add example output").files.map((file) => file.path), ["main.js", "new.js"]);
  projectService.markPushed("batch3-room", imported, "next-sha", "feat: add example output", "octocat");
  const summary = projectService.getSummary(imported);
  assert.equal(summary.status.state, "clean");
  assert.deepEqual(summary.history[0].changedFiles, ["main.js", "new.js"]);
});

test("project memory API is guest-authorized, bounded, redacted, and removable", async () => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${baseUrl}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "Batch 3 owner" }) }).then((response) => response.json());
    const roomId = created.room.roomId;
    const guestToken = created.participant.guestToken;
    const added = await fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent/memory`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestToken, summary: "Use React; token=should-not-leak" }) }).then(async (response) => ({ status: response.status, body: await response.json() }));
    assert.equal(added.status, 200);
    assert.equal(added.body.memory.projectFacts.length, 1);
    assert.equal(added.body.memory.projectFacts[0].summary.includes("should-not-leak"), false);
    const listed = await fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent/memory?guestToken=${encodeURIComponent(guestToken)}`).then((response) => response.json());
    assert.equal(listed.memory.projectFacts.length, 1);
    const entryId = listed.memory.projectFacts[0].id;
    const removed = await fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent/memory/${encodeURIComponent(entryId)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestToken }) }).then((response) => response.json());
    assert.deepEqual(removed.memory.projectFacts, []);
    const forbidden = await fetch(`${baseUrl}/api/ai/rooms/${roomId}/agent/memory`).then((response) => response.status);
    assert.equal(forbidden, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
