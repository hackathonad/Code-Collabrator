import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_TOKEN_REFRESH_WINDOW_MS, guestTokenExpiry, isGuestTokenExpired, moveGuestTokenToHeader, shouldRefreshGuestToken, usableGuestToken } from "../src/lib/guestToken";
import { ROLE_PERMISSIONS as clientPermissions, can } from "../src/lib/permissions";
import * as serverModule from "../../server/src/modules/rooms/roomPermissions";

// The server package is CommonJS, so its exports surface either directly or under `default` depending on the loader.
type PermissionTable = Record<string, readonly string[]>;
const serverPermissions = ((serverModule as unknown as { ROLE_PERMISSIONS?: PermissionTable; default?: { ROLE_PERMISSIONS: PermissionTable } }).ROLE_PERMISSIONS
  ?? (serverModule as unknown as { default: { ROLE_PERMISSIONS: PermissionTable } }).default.ROLE_PERMISSIONS);

const UUID = "11111111-2222-4333-8444-555555555555";
const tokenExpiringIn = (ms: number, now = Date.now()) => `v2.${UUID}.${Math.floor((now + ms) / 1000)}.signature`;

test("guest token expiry is read from v2 tokens and absent for the old format", () => {
  const now = 1_800_000_000_000;
  assert.equal(guestTokenExpiry(tokenExpiringIn(60_000, now)), Math.floor((now + 60_000) / 1000) * 1000);
  assert.equal(guestTokenExpiry(`${UUID}.legacysignature`), null);
  assert.equal(guestTokenExpiry("v2.too.few"), null);
  assert.equal(guestTokenExpiry("v2.id.notanumber.sig"), null);
  assert.equal(guestTokenExpiry(undefined), null);
});

test("tokens are refreshed when old-format or inside the refresh window, never when plentiful", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldRefreshGuestToken(tokenExpiringIn(GUEST_TOKEN_REFRESH_WINDOW_MS * 2, now), now), false);
  assert.equal(shouldRefreshGuestToken(tokenExpiringIn(GUEST_TOKEN_REFRESH_WINDOW_MS - 60_000, now), now), true);
  assert.equal(shouldRefreshGuestToken(`${UUID}.legacysignature`, now), true, "the pre-expiry format is upgraded");
  assert.equal(shouldRefreshGuestToken(undefined, now), false, "nothing to refresh without a token");
});

test("an expired token is dropped before joining, a live one is kept", () => {
  const now = 1_800_000_000_000;
  const expired = tokenExpiringIn(-60_000, now);
  const live = tokenExpiringIn(60_000, now);
  assert.equal(isGuestTokenExpired(expired, now), true);
  assert.equal(usableGuestToken(expired, now), undefined);
  assert.equal(usableGuestToken(live, now), live);
  assert.equal(usableGuestToken(`${UUID}.legacysignature`, now), `${UUID}.legacysignature`, "old-format tokens are left for the server to judge");
  assert.equal(usableGuestToken(undefined, now), undefined);
});

test("a token in the URL is moved into the X-Guest-Token header, other parameters are kept", () => {
  const absolute = moveGuestTokenToHeader("https://api.example.test/api/rooms/abc/github/repositories?guestToken=secret.value&search=react&page=2", { method: "GET" });
  assert.equal(absolute.input, "https://api.example.test/api/rooms/abc/github/repositories?search=react&page=2");
  assert.equal(new Headers(absolute.init?.headers).get("X-Guest-Token"), "secret.value");
  assert.equal(absolute.init?.method, "GET", "other request options are preserved");

  const relative = moveGuestTokenToHeader("/api/rooms/abc?guestToken=t0ken");
  assert.equal(relative.input, "/api/rooms/abc");
  assert.equal(new Headers(relative.init?.headers).get("X-Guest-Token"), "t0ken");

  const merged = moveGuestTokenToHeader("/api/x?guestToken=t0ken", { headers: { "Content-Type": "application/json" } });
  assert.equal(new Headers(merged.init?.headers).get("Content-Type"), "application/json", "existing headers survive");

  const untouched = moveGuestTokenToHeader("/api/rooms/abc?search=x", { method: "POST" });
  assert.equal(untouched.input, "/api/rooms/abc?search=x");
  assert.equal(untouched.init?.method, "POST");
  assert.equal(new Headers(untouched.init?.headers).has("X-Guest-Token"), false);
});

test("the browser's permission table is identical to the server's", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(clientPermissions).map(([role, actions]) => [role, [...actions].sort()])),
    Object.fromEntries(Object.entries(serverPermissions).map(([role, actions]) => [role, [...actions].sort()]))
  );
  assert.equal(can("viewer", "edit"), false);
  assert.equal(can("guest", "edit"), true);
  assert.equal(can(undefined, "chat"), false);
});
