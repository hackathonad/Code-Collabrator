import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { authErrorMessage, inspectSupabaseClientConfig } from "./authUtils";

const browserEnv = import.meta.env as Record<string, string | undefined>;
const clientConfig = inspectSupabaseClientConfig(
  browserEnv.VITE_SUPABASE_URL ?? browserEnv.NEXT_PUBLIC_SUPABASE_URL,
  browserEnv.VITE_SUPABASE_ANON_KEY ?? browserEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? browserEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export interface SupabaseAuthUser { id: string; email: string | null; displayName: string; avatarUrl: string | null; }
export interface SignUpResult { user: SupabaseAuthUser | null; requiresEmailConfirmation: boolean; }

let client: SupabaseClient | null = null;
let configurationError = clientConfig.status === "missing" ? "Authentication is not configured for this environment." : clientConfig.status === "malformed" ? "Authentication configuration is invalid for this environment." : "";
if (clientConfig.status === "configured") {
  try {
    client = createClient(clientConfig.url, clientConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "code-sphere-auth" }
    });
  } catch { configurationError = "Authentication configuration is invalid for this environment."; }
}

export const supabase = client;
export const isSupabaseReady = Boolean(supabase);
export const supabaseConfigurationMessage = configurationError;
export { authErrorMessage };

const toAuthUser = (user: User): SupabaseAuthUser => ({
  id: user.id,
  email: user.email ?? null,
  displayName: (typeof user.user_metadata?.name === "string" && user.user_metadata.name) || (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) || user.email?.split("@")[0] || "Member",
  avatarUrl: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null
});

const requireSupabase = () => {
  if (!supabase) throw new Error(configurationError.includes("invalid") ? "AUTH_CONFIGURATION_INVALID" : "AUTH_NOT_CONFIGURED");
  return supabase;
};
const callbackUrl = (mode?: "recovery") => `${window.location.origin}/auth/callback${mode ? `?mode=${mode}` : ""}`;

export const getSupabaseSession = async (): Promise<Session | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data.session;
};
export const getAccessToken = async () => (await getSupabaseSession())?.access_token ?? "";
export const getSupabaseAuthUser = async (): Promise<SupabaseAuthUser | null> => {
  const session = await getSupabaseSession();
  return session?.user ? toAuthUser(session.user) : null;
};

export const signInWithSupabase = async (email: string, password: string) => {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session?.user) throw new Error("AUTH_SESSION_MISSING");
  return toAuthUser(data.session.user);
};

export const signUpWithSupabase = async (email: string, password: string, displayName?: string): Promise<SignUpResult> => {
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    options: { ...(displayName ? { data: { name: displayName } } : {}), emailRedirectTo: callbackUrl() }
  });
  if (error) throw error;
  if (!data.user) throw new Error("AUTH_SESSION_MISSING");
  return { user: data.session?.user ? toAuthUser(data.session.user) : null, requiresEmailConfirmation: !data.session };
};

export const signInWithGoogle = async () => {
  const { error } = await requireSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) throw error;
};
export const resetPassword = async (email: string) => {
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("recovery") });
  if (error) throw error;
};
export const signOutOfSupabase = async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};
export const updateSupabasePassword = async (password: string) => {
  const { error } = await requireSupabase().auth.updateUser({ password });
  if (error) throw error;
};
export const subscribeToSupabaseAuth = (callback: (user: SupabaseAuthUser | null) => void) => {
  if (!supabase) return () => undefined;
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ? toAuthUser(session.user) : null));
  return () => subscription.unsubscribe();
};
