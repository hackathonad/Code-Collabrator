import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

const supabaseUrl = env.supabaseUrl;
const supabaseServiceRoleKey = env.supabaseServiceRoleKey;

export const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

export const supabase = supabaseAdmin;
export const isSupabaseConfigured = Boolean(supabaseAdmin);

export const verifySupabaseAccessToken = async (token: string) => {
  if (!supabaseAdmin || !token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  return data.user;
};
