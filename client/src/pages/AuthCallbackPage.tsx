import { Link } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { useAuth } from "../context/AuthContext";

export const AuthCallbackPage = () => {
  const { configured, loading, user } = useAuth();
  const recovery = new URLSearchParams(window.location.search).get("mode") === "recovery";
  return <main className="theme-page-home flex min-h-screen items-center justify-center px-4 py-8"><section className="theme-panel w-full max-w-md rounded-2xl border p-6 text-center shadow-panel"><AppLogo size={38} /><h1 className="mt-4 font-display text-2xl theme-text-primary">{recovery ? "Password recovery" : "Email confirmation"}</h1>{loading ? <p role="status" className="mt-3 text-sm theme-text-muted">Confirming your secure link…</p> : !configured ? <p role="alert" className="mt-3 text-sm theme-text-muted">Authentication is not configured for this environment.</p> : user ? <><p className="mt-3 text-sm theme-text-muted">{recovery ? "Your recovery link is valid. Choose a new password to finish." : "Your email is confirmed and you are signed in."}</p><Link to={recovery ? "/forgot-password" : "/dashboard"} className="theme-button-primary mt-5 inline-block rounded-xl px-4 py-3 font-semibold">{recovery ? "Choose a new password" : "Continue to dashboard"}</Link></> : <><p className="mt-3 text-sm theme-text-muted">This link may be expired, already used, or still processing. Try signing in, or request a new link.</p><Link to={recovery ? "/forgot-password" : "/login"} className="theme-button-neutral mt-5 inline-block rounded-xl border px-4 py-3 font-semibold">{recovery ? "Request another reset link" : "Go to sign in"}</Link></>}</section></main>;
};
