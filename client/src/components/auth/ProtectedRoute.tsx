import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="theme-page-loading flex min-h-screen items-center justify-center px-4">
        <div className="theme-panel-solid rounded-xl border px-5 py-4 text-sm theme-text-muted">Restoring session...</div>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
};
