import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { supabaseAdmin } from "../lib/supabase";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const GITHUB_API = "https://api.github.com";

export interface GitHubConnection { connected: boolean; login?: string; avatarUrl?: string | null; connectedAt?: string; }
export interface GitHubRepository { id: string; name: string; fullName: string; owner: string; private: boolean; description: string | null; defaultBranch: string; language: string | null; updatedAt: string; }

interface PendingState { userId: string; value: string; expiresAt: number; returnPath: string; }
interface StoredConnection { github_login: string; avatar_url: string | null; connected_at: string; access_token_ciphertext: string; }

const pendingStates = new Map<string, PendingState>();
const safeReturnPath = (value: unknown) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/settings";
const encryptionKey = () => {
  const raw = env.githubTokenEncryptionKey;
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
};
const encrypt = (value: string) => {
  const key = encryptionKey(); if (!key) throw new Error("GitHub connection is not configured on this server.");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
};
const decrypt = (value: string) => {
  const key = encryptionKey(); if (!key) throw new Error("GitHub connection is not configured on this server.");
  const [ivText, tagText, bodyText] = value.split("."); if (!ivText || !tagText || !bodyText) throw new Error("Stored GitHub credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url")); decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
};

const configured = () => Boolean(env.githubClientId && env.githubClientSecret && env.githubRedirectUri && encryptionKey() && supabaseAdmin);
const providerError = async (response: Response) => {
  const text = await response.text().catch(() => "");
  if (response.status === 401) throw new Error("Your GitHub connection expired. Reconnect GitHub and try again.");
  if (response.status === 403 && text.toLowerCase().includes("rate limit")) throw new Error("GitHub rate limit reached. Please try again later.");
  throw new Error("GitHub could not complete this request.");
};

export const githubService = {
  isConfigured: configured,
  async getConnection(userId: string): Promise<GitHubConnection> {
    if (!supabaseAdmin) return { connected: false };
    const { data } = await supabaseAdmin.from("github_connections").select("github_login, avatar_url, connected_at").eq("user_id", userId).maybeSingle();
    return data ? { connected: true, login: data.github_login, avatarUrl: data.avatar_url, connectedAt: data.connected_at } : { connected: false };
  },
  createAuthorizeUrl(userId: string, returnPath: unknown) {
    if (!configured()) throw new Error("GitHub connection is not configured on this server.");
    const state = randomBytes(32).toString("base64url"); pendingStates.set(state, { userId, value: state, expiresAt: Date.now() + OAUTH_STATE_TTL_MS, returnPath: safeReturnPath(returnPath) });
    const params = new URLSearchParams({ client_id: env.githubClientId, redirect_uri: env.githubRedirectUri, state, scope: "repo read:user" });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  },
  async completeAuthorization(code: string, state: string) {
    const pending = pendingStates.get(state); pendingStates.delete(state);
    if (!pending || pending.expiresAt < Date.now() || !code || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.value))) throw new Error("GitHub connection request expired. Try connecting again.");
    if (!configured() || !supabaseAdmin) throw new Error("GitHub connection is not configured on this server.");
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.githubClientId, client_secret: env.githubClientSecret, code, redirect_uri: env.githubRedirectUri }) });
    if (!tokenResponse.ok) await providerError(tokenResponse);
    const tokenPayload = await tokenResponse.json() as { access_token?: string }; if (!tokenPayload.access_token) throw new Error("GitHub did not return an access token.");
    const profileResponse = await fetch(`${GITHUB_API}/user`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${tokenPayload.access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!profileResponse.ok) await providerError(profileResponse);
    const profile = await profileResponse.json() as { login?: string; avatar_url?: string | null; id?: number };
    if (!profile.login || !profile.id) throw new Error("GitHub account details were incomplete.");
    const { error } = await supabaseAdmin.from("github_connections").upsert({ user_id: pending.userId, github_id: String(profile.id), github_login: profile.login, avatar_url: profile.avatar_url ?? null, access_token_ciphertext: encrypt(tokenPayload.access_token), connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("Unable to securely store the GitHub connection.");
    return { returnPath: pending.returnPath };
  },
  async disconnect(userId: string) { if (!supabaseAdmin) return; await supabaseAdmin.from("github_connections").delete().eq("user_id", userId); },
  async listRepositories(userId: string, query = ""): Promise<GitHubRepository[]> {
    if (!supabaseAdmin) throw new Error("GitHub connection is unavailable.");
    const { data } = await supabaseAdmin.from("github_connections").select("github_login, avatar_url, connected_at, access_token_ciphertext").eq("user_id", userId).maybeSingle() as { data: StoredConnection | null };
    if (!data) throw new Error("Connect GitHub before browsing repositories.");
    const response = await fetch(`${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${decrypt(data.access_token_ciphertext)}`, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) await providerError(response);
    const repositories = await response.json() as Array<{ id: number; name: string; full_name: string; private: boolean; description: string | null; default_branch: string; language: string | null; updated_at: string; owner?: { login?: string } }>;
    const needle = query.trim().toLowerCase();
    return repositories.filter((repository) => !needle || repository.name.toLowerCase().includes(needle) || repository.full_name.toLowerCase().includes(needle)).map((repository) => ({ id: String(repository.id), name: repository.name, fullName: repository.full_name, owner: repository.owner?.login ?? repository.full_name.split("/")[0], private: repository.private, description: repository.description, defaultBranch: repository.default_branch || "main", language: repository.language, updatedAt: repository.updated_at }));
  }
};
