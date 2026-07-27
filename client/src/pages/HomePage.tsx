import { ArrowRight, Clock3 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppLogo } from "../components/ui/AppLogo";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { storage } from "../lib/storage";
import type { RecentRoom, SupportedLanguage } from "../types/collaboration";

export const HomePage = () => {
  const navigate = useNavigate();
  const createCardRef = useRef<HTMLFormElement | null>(null);
  const joinCardRef = useRef<HTMLFormElement | null>(null);
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>("javascript");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [recentRooms] = useState<RecentRoom[]>(() => storage.getRecentRooms());

  const createRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim()) {
      setError("Add your display name before creating a room.");
      return;
    }

    setLoading("create");
    setError(null);

    try {
      const { session } = await api.createRoom(username.trim(), language);
      storage.saveSession(session);
      navigate(`/room/${session.roomId}`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to create room");
    } finally {
      setLoading(null);
    }
  };

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim()) {
      setError("Add your display name before joining a room.");
      return;
    }

    if (!roomId.trim()) {
      setError("Enter a room ID to join.");
      return;
    }

    setLoading("join");
    setError(null);

    try {
      const existingSession = storage.getSession(roomId.trim());
      const { session } = await api.joinRoom(roomId.trim(), username.trim(), existingSession?.userId);
      storage.saveSession(session);
      navigate(`/room/${session.roomId}`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to join room");
    } finally {
      setLoading(null);
    }
  };

  const rejoinRecentRoom = async (recentRoom: RecentRoom) => {
    setLoading(`recent-${recentRoom.roomId}`);
    setError(null);

    try {
      const existingSession = storage.getSession(recentRoom.roomId);
      if (existingSession) {
        storage.saveSession(existingSession);
        navigate(`/room/${recentRoom.roomId}`);
        return;
      }

      const { session } = await api.joinRoom(recentRoom.roomId, recentRoom.username);
      storage.saveSession(session);
      navigate(`/room/${session.roomId}`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to rejoin room");
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="theme-page-home min-h-screen px-4 py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <nav className="theme-panel-solid motion-reveal motion-surface flex flex-col gap-4 rounded-2xl border px-5 py-4 shadow-[var(--shadow-soft)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AppLogo size={36} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--text-faint)]">Code Sphere</p>
              <h1 className="mt-1 font-display text-2xl font-semibold text-[var(--text-primary)]">Real-time coding rooms</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => createCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="theme-button-neutral rounded-full border px-4 py-2 transition"
            >
              Create Room
            </button>
            <button
              type="button"
              onClick={() => joinCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="theme-button-neutral rounded-full border px-4 py-2 transition"
            >
              Join Room
            </button>
          </div>
        </nav>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <div className="theme-panel motion-reveal motion-surface rounded-[32px] border p-6 shadow-panel backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.32em] text-sky-300/80">Identity</p>
              <h2 className="mt-3 font-display text-4xl theme-text-primary">Start with your name</h2>
              <p className="mt-2 text-sm theme-text-muted">Create or join a room, then start collaborating right away.</p>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Your display name"
                className="theme-input mt-5 w-full rounded-2xl border px-4 py-3 outline-none transition"
              />
            </div>

            <form ref={createCardRef} onSubmit={createRoom} className="theme-panel motion-reveal motion-surface rounded-[32px] border p-6 shadow-panel backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.32em] text-sky-300/80">Create Room</p>
              <h3 className="mt-3 font-display text-3xl theme-text-primary">Launch a fresh workspace</h3>
              <p className="mt-2 text-sm theme-text-muted">Pick a starter language and open a room instantly.</p>

              <div className="mt-5 grid gap-4">
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
                  className="theme-input rounded-2xl border px-4 py-3 outline-none transition"
                >
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="cpp">C++</option>
                </select>
                <button
                  type="submit"
                  disabled={loading !== null}
                  className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "create" ? "Creating..." : "Create Room"}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </button>
              </div>
            </form>

            <form ref={joinCardRef} onSubmit={joinRoom} className="theme-panel motion-reveal motion-surface rounded-[32px] border p-6 shadow-panel backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">Join Room</p>
              <h3 className="mt-3 font-display text-3xl theme-text-primary">Return to an active session</h3>
              <p className="mt-2 text-sm theme-text-muted">Paste a room ID and jump back into the editor.</p>

              <div className="mt-5 grid gap-4">
                <input
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  placeholder="Paste room ID"
                  className="theme-input rounded-2xl border px-4 py-3 outline-none transition"
                />
                <button
                  type="submit"
                  disabled={loading !== null}
                  className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "join" ? "Joining..." : "Join Room"}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </button>
              </div>
            </form>

            {error ? <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
          </div>

          <div className="theme-panel motion-reveal motion-surface rounded-[32px] border p-6 shadow-panel backdrop-blur-xl">
            <p className="text-xs uppercase tracking-[0.32em] text-sky-300/80">Why this app</p>
            <h2 className="mt-3 font-display text-4xl theme-text-primary">Simple, live, and room-first</h2>
            <div className="mt-5 grid gap-3">
              <div className="theme-surface rounded-2xl border p-4">
                <p className="font-semibold theme-text-primary">Join instantly</p>
                <p className="mt-1 text-sm theme-text-muted">Re-enter a room with your saved session or recent history.</p>
              </div>
              <div className="theme-surface rounded-2xl border p-4">
                <p className="font-semibold theme-text-primary">See teammates live</p>
                <p className="mt-1 text-sm theme-text-muted">Presence, cursor labels, line highlights, and typing awareness stay visible while you code.</p>
              </div>
              <div className="theme-surface rounded-2xl border p-4">
                <p className="font-semibold theme-text-primary">Stay focused</p>
                <p className="mt-1 text-sm theme-text-muted">One editor, one run action, and one fast chat rail.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="theme-panel motion-reveal motion-surface rounded-[32px] border p-6 shadow-panel backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-sky-300/80">Recent Rooms</p>
              <h3 className="mt-2 font-display text-3xl theme-text-primary">Quick rejoin</h3>
              <p className="mt-2 text-sm theme-text-muted">Rooms you opened recently are kept locally for one-click access.</p>
            </div>
            <Clock3 className="h-5 w-5 text-sky-300" />
          </div>

          <div className="mt-6 grid gap-4">
            {recentRooms.length ? (
              recentRooms.map((recentRoom) => (
                <article key={recentRoom.roomId} className="theme-surface motion-card flex flex-col gap-4 rounded-3xl border p-5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium theme-text-primary">{recentRoom.label}</p>
                    <p className="mt-1 font-mono text-sm theme-text-secondary">{recentRoom.roomId}</p>
                    <p className="mt-2 text-sm theme-text-muted">
                      Last active {formatRelativeTime(recentRoom.lastVisitedAt)} as {recentRoom.username}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void rejoinRecentRoom(recentRoom)}
                    disabled={loading !== null}
                    className="theme-button-neutral group inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading === `recent-${recentRoom.roomId}` ? "Joining..." : "Rejoin Room"}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </button>
                </article>
              ))
            ) : (
              <div className="theme-surface-muted rounded-3xl border border-dashed p-6 text-sm theme-text-muted">
                No recent rooms yet. Create a room or join one to keep it here for quick access.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};
