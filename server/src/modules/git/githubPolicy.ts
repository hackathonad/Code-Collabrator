/**
 * Which repositories a room may touch through the deployment's shared GitHub
 * token. Guests have no GitHub identity of their own, so without a policy every
 * guest would inherit the token owner's access to every repository.
 *
 * - With an allowlist: only listed repositories, for reads and writes.
 * - Without one: reads of public repositories only, and no writes at all.
 */
export type RepoAccessMode = "read" | "write";

const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/(?:[A-Za-z0-9][A-Za-z0-9_.-]{0,99}|\*)$/;
export const MAX_ALLOWLIST_ENTRIES = 100;

/** Parses `owner/repo,owner/*` into normalized lowercase entries; malformed entries are dropped. */
export const parseRepoAllowlist = (value: string | undefined): string[] => {
  const entries = String(value ?? "").split(",").map((entry) => entry.trim()).filter((entry) => ENTRY_PATTERN.test(entry)).map((entry) => entry.toLowerCase());
  return [...new Set(entries)].slice(0, MAX_ALLOWLIST_ENTRIES);
};

export const matchesAllowlist = (owner: string, repository: string, allowlist: readonly string[]) => {
  const fullName = `${owner}/${repository}`.toLowerCase();
  return allowlist.includes(fullName) || allowlist.includes(`${owner.toLowerCase()}/*`);
};

export type RepoAccessDecision = { allowed: true } | { allowed: false; message: string };

export const evaluateRepoAccess = (input: { owner: string; repository: string; mode: RepoAccessMode; allowlist: readonly string[]; isPrivate?: boolean }): RepoAccessDecision => {
  if (input.allowlist.length > 0) {
    return matchesAllowlist(input.owner, input.repository, input.allowlist)
      ? { allowed: true }
      : { allowed: false, message: "This repository is not on the deployment's GitHub allowlist." };
  }
  if (input.mode === "write") {
    return { allowed: false, message: "Writing to GitHub is disabled until the deployment sets GITHUB_ALLOWED_REPOS." };
  }
  // Without an allowlist only repositories known to be public are readable. Unknown privacy is treated as private.
  return input.isPrivate === false
    ? { allowed: true }
    : { allowed: false, message: "Private repositories are only available when the deployment lists them in GITHUB_ALLOWED_REPOS." };
};
