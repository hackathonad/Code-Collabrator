export type SupabaseClientConfigStatus = "configured" | "missing" | "malformed";

export const inspectSupabaseClientConfig = (url: string | undefined, anonKey: string | undefined) => {
  const normalizedUrl = url?.trim() ?? "";
  const normalizedAnonKey = anonKey?.trim() ?? "";
  if (!normalizedUrl || !normalizedAnonKey) return { status: "missing" as const, url: normalizedUrl, anonKey: normalizedAnonKey };
  try {
    const parsed = new URL(normalizedUrl);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || normalizedAnonKey.length < 20) throw new Error("Invalid Supabase configuration");
    return { status: "configured" as const, url: normalizedUrl, anonKey: normalizedAnonKey };
  } catch { return { status: "malformed" as const, url: normalizedUrl, anonKey: normalizedAnonKey }; }
};

export const normalizeAuthEmail = (value: string) => value.trim().toLowerCase();

export const validatePassword = (password: string, confirmation?: string) => {
  if (password.length < 6) return "Use a password with at least 6 characters.";
  if (confirmation !== undefined && password !== confirmation) return "Passwords do not match.";
  return "";
};

export const authErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("auth_not_configured")) return "Authentication is not configured for this environment.";
  if (message.includes("auth_configuration_invalid")) return "Authentication configuration is invalid for this environment.";
  if (message.includes("invalid login") || message.includes("invalid credentials")) return "Incorrect email or password.";
  if (message.includes("already registered") || message.includes("already been registered")) return "An account already exists for this email.";
  if (message.includes("email not confirmed") || message.includes("auth_session_missing")) return "Please check your email to confirm your account before signing in.";
  if (message.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
  if (message.includes("network") || message.includes("fetch")) return "Unable to reach Supabase. Please try again.";
  return "Authentication could not be completed. Please try again.";
};
