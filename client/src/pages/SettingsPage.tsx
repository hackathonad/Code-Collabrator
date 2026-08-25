import { Link } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useTheme } from "../context/ThemeContext";

export const SettingsPage = () => {
  const { themeId } = useTheme();

  return (
    <main className="theme-page-home min-h-screen px-4 py-8">
      <div className="mx-auto grid max-w-3xl gap-5">
        <nav className="theme-panel-solid flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 shadow-panel">
          <div className="flex items-center gap-3">
            <AppLogo size={34} />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Workspace preferences</p>
              <h1 className="font-display text-2xl">Settings</h1>
            </div>
          </div>
          <div className="flex gap-2"><ThemeToggle /><Link className="theme-button-neutral rounded-lg border px-3 py-2 text-sm" to="/">Home</Link></div>
        </nav>

        <section className="theme-panel rounded-2xl border p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Appearance</p>
          <h2 className="mt-2 font-display text-xl theme-text-primary">Local theme</h2>
          <p className="mt-1 text-sm theme-text-muted">Current theme: {themeId}. Theme choices stay in this browser and never require an account.</p>
          <div className="mt-4"><ThemeToggle /></div>
        </section>

        <section className="theme-panel rounded-2xl border p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Guest sessions</p>
          <h2 className="mt-2 font-display text-xl theme-text-primary">Room identity stays local</h2>
          <p className="mt-2 text-sm leading-6 theme-text-muted">Your display name, room session, and Quick Rejoin entries are stored locally in this browser. Rooms do not require registration.</p>
        </section>

        <section className="theme-panel rounded-2xl border p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] theme-text-faint">Calls and integrations</p>
          <h2 className="mt-2 font-display text-xl theme-text-primary">Optional room services</h2>
          <p className="mt-2 text-sm leading-6 theme-text-muted">Microphone, camera, screen sharing, AI, and repository status are configured from inside a room when the server supports them.</p>
        </section>
      </div>
    </main>
  );
};
