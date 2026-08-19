import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles: Array<[RegExp, string]> = [
  [/^\/$/, "Code Collaborator — Realtime collaborative coding"],
  [/^\/login$/, "Sign in — Code Collaborator"],
  [/^\/register$/, "Sign up — Code Collaborator"],
  [/^\/forgot-password$/, "Reset password — Code Collaborator"],
  [/^\/dashboard$/, "Dashboard — Code Collaborator"],
  [/^\/profile$/, "Profile — Code Collaborator"],
  [/^\/settings$/, "Settings — Code Collaborator"],
  [/^\/room\//, "Workspace — Code Collaborator"],
  [/^\/privacy$/, "Privacy — Code Collaborator"],
  [/^\/terms$/, "Terms — Code Collaborator"]
];

const upsertMeta = (selector: string, name: string, content: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) { element = document.createElement("meta"); element.setAttribute(name.startsWith("og:") ? "property" : "name", name); document.head.appendChild(element); }
  element.content = content;
};

export const RouteMetadata = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titles.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Page not found — Code Collaborator";
    const privateRoute = /^\/(room|dashboard|profile|settings|auth\/callback)/.test(pathname);
    upsertMeta('meta[name="robots"]', "robots", privateRoute ? "noindex, nofollow" : "index, follow");
    const base = (import.meta.env as Record<string, string | undefined>).VITE_PUBLIC_SITE_URL?.replace(/\/+$/, "");
    if (base) {
      const canonical = `${base}${pathname === "/" ? "/" : pathname}`;
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
      link.href = canonical;
      upsertMeta('meta[property="og:url"]', "og:url", canonical);
    }
  }, [pathname]);
  return null;
};
