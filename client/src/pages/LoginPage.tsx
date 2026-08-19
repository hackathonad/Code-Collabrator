import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { authErrorMessage } from "../lib/supabase";
import { normalizeAuthEmail } from "../lib/authUtils";

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      await signIn(normalizeAuthEmail(email), password);
      const destination = typeof (location.state as { from?: string } | null)?.from === "string" ? (location.state as { from: string }).from : "/dashboard";
      navigate(destination.startsWith("/") && !destination.startsWith("//") ? destination : "/dashboard", { replace: true });
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="theme-page-home flex min-h-screen items-center justify-center px-4 py-8">
      <form onSubmit={submit} className="theme-panel w-full max-w-md rounded-2xl border p-6 shadow-panel">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3"><AppLogo size={34} /><h1 className="font-display text-2xl theme-text-primary">Sign in</h1></div>
          <ThemeToggle />
        </div>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm theme-text-muted">Email<input required autoComplete="email" className="theme-input rounded-xl border px-4 py-3" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="grid gap-1 text-sm theme-text-muted">Password<input required autoComplete="current-password" className="theme-input rounded-xl border px-4 py-3" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="theme-button-primary rounded-xl px-4 py-3 font-semibold disabled:opacity-50" disabled={loading || !configured}>{loading ? "Signing in..." : "Sign in"}</button>
          <Link className="text-sm text-sky-300" to="/forgot-password">Forgot password?</Link>
        </div>
        {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{notice}</p> : null}
        {message ? <p role="alert" className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{message}</p> : null}
        {!configured ? <p className="mt-4 text-sm theme-text-muted">Supabase client environment variables are not configured.</p> : null}
        <p className="mt-5 text-sm theme-text-muted">Need an account? <Link className="text-sky-300" to="/register">Create one</Link>. Guest rooms still work from <Link className="text-sky-300" to="/">home</Link>.</p>
      </form>
    </main>
  );
};
