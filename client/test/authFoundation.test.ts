import assert from "node:assert/strict";
import test from "node:test";
import { authErrorMessage, inspectSupabaseClientConfig, normalizeAuthEmail, validatePassword } from "../src/lib/authUtils";

test("auth configuration distinguishes missing, malformed, and usable browser values", () => {
  assert.equal(inspectSupabaseClientConfig(undefined, undefined).status, "missing");
  assert.equal(inspectSupabaseClientConfig("not-a-url", "a".repeat(40)).status, "malformed");
  assert.equal(inspectSupabaseClientConfig("https://project.supabase.co", "a".repeat(40)).status, "configured");
});

test("auth validation and errors remain safe and actionable", () => {
  assert.equal(normalizeAuthEmail("  Member@Example.com "), "member@example.com");
  assert.equal(validatePassword("123"), "Use a password with at least 6 characters.");
  assert.equal(validatePassword("123456", "654321"), "Passwords do not match.");
  assert.equal(validatePassword("123456", "123456"), "");
  assert.equal(authErrorMessage(new Error("AUTH_NOT_CONFIGURED")), "Authentication is not configured for this environment.");
  assert.equal(authErrorMessage(new Error("Invalid login credentials")), "Incorrect email or password.");
  assert.equal(authErrorMessage(new Error("Email not confirmed")), "Please check your email to confirm your account before signing in.");
});
