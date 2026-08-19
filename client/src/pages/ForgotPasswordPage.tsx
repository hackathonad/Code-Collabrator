import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { useAuth } from "../context/AuthContext";
import { authErrorMessage } from "../lib/supabase";
import { normalizeAuthEmail, validatePassword } from "../lib/authUtils";

export const ForgotPasswordPage = () => {
  const { configured, user, sendPasswordReset, updatePassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendReset = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null); setMessage(null);
    try { await sendPasswordReset(normalizeAuthEmail(email)); setMessage("If an account exists for that address, a reset link has been sent."); }
    catch (issue) { setError(authErrorMessage(issue)); }
    finally { setLoading(false); }
  };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    const passwordError = validatePassword(password, confirmPassword);
    if (passwordError) { setError(passwordError); return; }
    setLoading(true); setError(null); setMessage(null);
    try { await updatePassword(password); setMessage("Your password has been updated."); setPassword(""); setConfirmPassword(""); }
    catch (issue) { setError(authErrorMessage(issue)); }
    finally { setLoading(false); }
  };

  return <main className="theme-page-home flex min-h-screen items-center justify-center px-4 py-8"><section className="theme-panel w-full max-w-md rounded-2xl border p-6 shadow-panel"><div className="flex items-center gap-3"><AppLogo size={34} /><div><p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Account recovery</p><h1 className="font-display text-2xl theme-text-primary">{user ? "Choose a new password" : "Reset your password"}</h1></div></div>{user ? <form className="mt-6 grid gap-3" onSubmit={savePassword}><label className="grid gap-1 text-sm theme-text-muted">New password<input required minLength={6} className="theme-input rounded-xl border px-4 py-3" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="grid gap-1 text-sm theme-text-muted">Confirm password<input required minLength={6} className="theme-input rounded-xl border px-4 py-3" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button disabled={loading || !configured} className="theme-button-primary rounded-xl px-4 py-3 font-semibold disabled:opacity-50">{loading ? "Updating…" : "Update password"}</button></form> : <form className="mt-6 grid gap-3" onSubmit={sendReset}><label className="grid gap-1 text-sm theme-text-muted">Email<input required className="theme-input rounded-xl border px-4 py-3" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button disabled={loading || !configured} className="theme-button-primary rounded-xl px-4 py-3 font-semibold disabled:opacity-50">{loading ? "Sending…" : "Send reset link"}</button></form>}{message ? <p className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</p> : null}{error ? <p role="alert" className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}<p className="mt-5 text-sm theme-text-muted"><Link className="text-sky-300" to="/login">Return to sign in</Link></p></section></main>;
};
