import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles: Array<[RegExp, string]> = [
  [/^\/$/, "Code Collaborator — Realtime collaborative coding"],
  [/^\/home$/, "Code Collaborator — Realtime collaborative coding"],
  [/^\/app$/, "Code Collaborator — Workspace home"],
  [/^\/settings$/, "Settings — Code Collaborator"],
  [/^\/(room|guest\/room)\//, "Workspace — Code Collaborator"],
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
    const privateRoute = /^\/(app|room|settings)/.test(pathname);
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
