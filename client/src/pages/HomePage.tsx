import { ArrowRight, Code2, MessageSquareText, Rocket, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import type { SupportedLanguage } from "../types/collaboration";

export const HomePage = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>("javascript");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"create" | "join" | null>(null);

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
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

  const joinRoom = async (event: React.FormEvent) => {
    event.preventDefault();
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.22),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.16),_transparent_18%),linear-gradient(180deg,_#020817_0%,_#07111f_40%,_#020617_100%)] px-4 py-8 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-10 top-16 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl animate-float" />
        <div className="absolute bottom-10 right-16 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl animate-float" />
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-8 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[36px] border border-white/10 bg-surface-800/75 p-8 shadow-panel backdrop-blur-xl">
          <span className="inline-flex rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-sky-200">
            Real-Time Coding Platform
          </span>
          <h1 className="mt-6 max-w-3xl font-display text-5xl leading-tight text-white md:text-6xl">
            Code together in a room that feels built for developers, not docs.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Code Sphere pairs a live Monaco editor, multiplayer presence, chat, execution, and AI-assisted reasoning in one collaborative workspace.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {[
              { icon: Users, title: "Live Rooms", body: "Create rooms, invite teammates, and keep ownership + permissions inside the session." },
              { icon: Code2, title: "Monaco Editing", body: "See synced code, remote cursors, and active lines while everyone works together." },
              { icon: MessageSquareText, title: "Integrated Chat", body: "Stay in context with room chat and timestamps without leaving the editor." },
              { icon: Rocket, title: "Run + Reason", body: "Execute JavaScript, Python, or C++ and use AI actions to predict or explain code." }
            ].map((item) => (
              <article key={item.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <item.icon className="h-8 w-8 text-sky-300" />
                <h2 className="mt-4 font-display text-2xl text-white">{item.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[36px] border border-white/10 bg-surface-800/80 p-6 shadow-panel backdrop-blur-xl">
          <div className="grid gap-6">
            <form onSubmit={createRoom} className="rounded-3xl border border-white/10 bg-surface-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">New Room</p>
              <h2 className="mt-3 font-display text-3xl text-white">Create a session</h2>

              <div className="mt-6 grid gap-4">
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Your display name"
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-sky-400/40"
                />
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-sky-400/40"
                >
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="cpp">C++</option>
                </select>
                <button
                  type="submit"
                  disabled={!username.trim() || loading !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "create" ? "Creating..." : "Create Room"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>

            <form onSubmit={joinRoom} className="rounded-3xl border border-white/10 bg-surface-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-emerald-300/80">Join Room</p>
              <h2 className="mt-3 font-display text-3xl text-white">Enter an existing session</h2>

              <div className="mt-6 grid gap-4">
                <input
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  placeholder="Paste room ID"
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-emerald-400/40"
                />
                <button
                  type="submit"
                  disabled={!username.trim() || !roomId.trim() || loading !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "join" ? "Joining..." : "Join Room"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>

            {error ? <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
};
