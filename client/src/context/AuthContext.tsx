import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getSupabaseAuthUser,
  isSupabaseReady,
  resetPassword,
  signInWithGoogle,
  signInWithSupabase,
  signOutOfSupabase,
  signUpWithSupabase,
  subscribeToSupabaseAuth,
  updateSupabasePassword,
  type SignUpResult,
  type SupabaseAuthUser
} from "../lib/supabase";

interface AuthContextValue {
  user: SupabaseAuthUser | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<SignUpResult>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<SupabaseAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void getSupabaseAuthUser()
      .then((currentUser) => { if (mounted) setUser(currentUser); })
      .catch(() => undefined)
      .finally(() => { if (mounted) setLoading(false); });

    const unsubscribe = subscribeToSupabaseAuth((nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured: isSupabaseReady,
      signIn: async (email, password) => {
        const nextUser = await signInWithSupabase(email, password);
        setUser(nextUser);
      },
      signUp: async (email, password, displayName) => {
        const result = await signUpWithSupabase(email, password, displayName);
        setUser(result.user);
        return result;
      },
      signInGoogle: signInWithGoogle,
      signOut: async () => {
        await signOutOfSupabase();
        setUser(null);
      },
      sendPasswordReset: resetPassword,
      updatePassword: updateSupabasePassword
    }),
    [loading, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};
