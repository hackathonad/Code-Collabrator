import { Link } from "react-router-dom";

export const PublicFooter = () => <footer className="theme-page-home border-t border-[var(--border)] px-4 py-6 text-center text-xs theme-text-muted"><nav aria-label="Legal" className="flex justify-center gap-4"><Link className="hover:text-[var(--text-primary)]" to="/privacy">Privacy</Link><Link className="hover:text-[var(--text-primary)]" to="/terms">Terms & acceptable use</Link></nav></footer>;
