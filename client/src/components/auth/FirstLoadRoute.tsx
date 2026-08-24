import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { HomePage } from "../../pages/HomePage";

/** The public entry point: authenticate first, while retaining explicit guest rooms. */
export const FirstLoadRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="theme-page-loading flex min-h-screen items-center justify-center px-4">
        <div className="theme-panel-solid rounded-xl border px-5 py-4 text-sm theme-text-muted">Restoring session...</div>
      </main>
    );
  }

  return user ? <HomePage /> : <Navigate to="/login" replace />;
};
