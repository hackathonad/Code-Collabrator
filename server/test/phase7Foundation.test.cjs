const assert = require("node:assert/strict");
const test = require("node:test");
const { sanitizeAccountUsername } = require("../dist/utils/validation");
const { githubService } = require("../dist/services/githubService");

test("account usernames are normalized and reject unsafe values", () => {
  assert.equal(sanitizeAccountUsername("  Ada_Lovelace "), "ada_lovelace");
  assert.equal(sanitizeAccountUsername("ab"), "");
  assert.equal(sanitizeAccountUsername("ada lovelace"), "");
  assert.equal(sanitizeAccountUsername("ada@example"), "");
});

test("GitHub integration stays unavailable without server-only OAuth configuration", () => {
  assert.equal(githubService.isConfigured(), false);
  assert.throws(() => githubService.createAuthorizeUrl("00000000-0000-4000-8000-000000000000", "/settings"), /not configured/);
});
