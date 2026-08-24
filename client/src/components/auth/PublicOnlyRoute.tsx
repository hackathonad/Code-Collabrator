import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export const PublicOnlyRoute = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="theme-page-loading flex min-h-screen items-center justify-center px-4">
        <div className="theme-panel-solid rounded-xl border px-5 py-4 text-sm theme-text-muted">Restoring session...</div>
      </main>
    );
  }

  return user ? <Navigate to="/dashboard" replace /> : children;
};
