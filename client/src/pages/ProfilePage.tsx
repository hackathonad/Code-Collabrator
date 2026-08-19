import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

interface ProfilePayload { username?: string; display_name?: string; avatar_url?: string | null; bio?: string | null; created_at?: string; }

export const ProfilePage = () => {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.getProfile().then((payload) => {
      if (!active) return;
      const next = payload.profile as ProfilePayload | null;
      if (!next) { setError("Your account is signed in, but its profile is not available yet."); return; }
      setProfile(next); setUsername(next.username ?? ""); setDisplayName(next.display_name ?? user?.displayName ?? ""); setBio(next.bio ?? "");
    }).catch(() => { if (active) setError("Your profile could not be loaded. You can still try saving changes."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.displayName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const result = await api.updateProfile({ username, displayName, bio });
      const next = result.profile as ProfilePayload | null;
      if (!next) throw new Error("Unable to create your profile.");
      setProfile(next); setUsername(next.username ?? username); setDisplayName(next.display_name ?? displayName); setBio(next.bio ?? bio); setMessage("Profile saved.");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Unable to save profile."); } finally { setSaving(false); }
  };
  const initials = (displayName || user?.displayName || "M").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <main className="theme-page-home min-h-screen px-4 py-8"><div className="mx-auto grid max-w-3xl gap-5"><nav className="theme-panel-solid flex items-center justify-between rounded-2xl border p-4 shadow-panel"><div className="flex items-center gap-3"><AppLogo size={34} /><div><p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Account</p><h1 className="font-display text-2xl">Profile</h1></div></div><div className="flex gap-2"><ThemeToggle /><Link className="theme-button-neutral rounded-lg border px-3 py-2 text-sm" to="/dashboard">Dashboard</Link><Link className="theme-button-neutral rounded-lg border px-3 py-2 text-sm" to="/settings">Settings</Link></div></nav><form onSubmit={submit} className="theme-panel rounded-2xl border p-6 shadow-panel"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] font-display text-xl">{profile?.avatar_url ? <img src={profile.avatar_url} alt="Profile avatar" className="h-full w-full object-cover" /> : initials}</div><div><p className="font-semibold">{displayName || "Your profile"}</p><p className="text-sm theme-text-muted">{user?.email}</p>{profile?.created_at ? <p className="mt-1 text-xs theme-text-faint">Member since {new Date(profile.created_at).toLocaleDateString()}</p> : null}</div></div>{loading ? <p className="mt-6 text-sm theme-text-muted">Loading profile…</p> : <div className="mt-6 grid gap-4"><label className="grid gap-1 text-sm theme-text-muted">Username <span className="text-xs theme-text-faint">3–24 letters, numbers, hyphens, or underscores.</span><input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" className="theme-input rounded-xl border px-4 py-3" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="grid gap-1 text-sm theme-text-muted">Display name<input required maxLength={24} className="theme-input rounded-xl border px-4 py-3" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label className="grid gap-1 text-sm theme-text-muted">Bio <span className="text-xs theme-text-faint">Optional · {bio.length}/280</span><textarea maxLength={280} rows={4} className="theme-input rounded-xl border px-4 py-3" value={bio} onChange={(event) => setBio(event.target.value)} /></label><button disabled={saving} className="theme-button-primary rounded-xl px-4 py-3 font-semibold disabled:opacity-50">{saving ? "Saving…" : "Save profile"}</button></div>}{message ? <p className="mt-4 text-sm text-emerald-300">{message}</p> : null}{error ? <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p> : null}<button type="button" className="mt-6 text-sm theme-text-muted underline" onClick={() => void signOut()}>Log out</button></form></div></main>;
};
