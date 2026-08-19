import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { useAuth } from "../context/AuthContext";
import { authErrorMessage } from "../lib/supabase";
import { normalizeAuthEmail, validatePassword } from "../lib/authUtils";

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { signUp, configured } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const passwordError = validatePassword(password, confirmPassword);
      if (passwordError) { setMessage(passwordError); return; }
      const result = await signUp(normalizeAuthEmail(email), password, displayName.trim());
      if (result.requiresEmailConfirmation) {
        navigate("/login", { replace: true, state: { notice: "Check your email to verify your account, then sign in." } });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (error) {
      setMessage(error instanceof Error && error.message.includes("match") ? error.message : authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="theme-page-home flex min-h-screen items-center justify-center px-4 py-8">
      <form onSubmit={submit} className="theme-panel w-full max-w-md rounded-2xl border p-6 shadow-panel">
        <div className="mb-6 flex items-center gap-3"><AppLogo size={34} /><h1 className="font-display text-2xl theme-text-primary">Create account</h1></div>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm theme-text-muted">Display name<input required maxLength={24} className="theme-input rounded-xl border px-4 py-3" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="grid gap-1 text-sm theme-text-muted">Email<input required autoComplete="email" className="theme-input rounded-xl border px-4 py-3" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="grid gap-1 text-sm theme-text-muted">Password<input required minLength={6} autoComplete="new-password" className="theme-input rounded-xl border px-4 py-3" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="grid gap-1 text-sm theme-text-muted">Confirm password<input required minLength={6} autoComplete="new-password" className="theme-input rounded-xl border px-4 py-3" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <button className="theme-button-primary rounded-xl px-4 py-3 font-semibold disabled:opacity-50" disabled={loading || !configured}>{loading ? "Creating..." : "Create account"}</button>
        </div>
        {message ? <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{message}</p> : null}
        {!configured ? <p role="status" className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm theme-text-muted">Authentication is not configured for this environment. Add the browser Supabase variables and restart Vite.</p> : null}
        <p className="mt-5 text-sm theme-text-muted">Already registered? <Link className="text-sky-300" to="/login">Sign in</Link>.</p>
      </form>
    </main>
  );
};
