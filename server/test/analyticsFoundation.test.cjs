const assert = require("node:assert/strict");
const test = require("node:test");
const {
  aggregateAnalyticsRows,
  createEmptyAnalyticsDashboard,
  sanitizeAnalyticsMetadata
} = require("../dist/services/analyticsService");

test("analytics metadata uses a strict allow-list and bounds values", () => {
  const payload = sanitizeAnalyticsMetadata({
    language: "javascript",
    provider: " ollama ",
    model: "llama3",
    action: "explain",
    success: true,
    durationMs: 99_999_999,
    streaming: true,
    prompt: "private request",
    sourceCode: "private source"
  });
  assert.deepEqual(payload, { language: "javascript", provider: "ollama", model: "llama3", action: "explain", success: true, duration_ms: 3_600_000, streaming: true });
  assert.equal("prompt" in payload, false);
  assert.equal("sourceCode" in payload, false);
});

test("analytics aggregation produces real empty and metadata-only summaries", () => {
  assert.deepEqual(createEmptyAnalyticsDashboard("7d").recentActivity, []);
  const dashboard = aggregateAnalyticsRows([
    { event_type: "room_created", room_id: "room-a", workspace_id: "workspace-a", metadata: { language: "python" }, created_at: "2026-08-18T08:00:00.000Z" },
    { event_type: "ai_request_completed", room_id: "room-a", workspace_id: "workspace-a", metadata: { provider: "ollama", action: "fix" }, created_at: "2026-08-18T08:03:00.000Z" },
    { event_type: "execution_failed", room_id: "room-a", workspace_id: "workspace-a", metadata: { language: "python" }, created_at: "2026-08-18T08:05:00.000Z" }
  ], "30d");
  assert.equal(dashboard.overview.roomsCreated, 1);
  assert.equal(dashboard.overview.aiRequests, 1);
  assert.equal(dashboard.execution.failed, 1);
  assert.equal(dashboard.execution.successRate, 0);
  assert.deepEqual(dashboard.languages, [{ name: "python", count: 2 }]);
  assert.deepEqual(dashboard.ai.actions, [{ name: "fix", count: 1 }]);
});
