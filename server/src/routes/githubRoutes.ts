import { Router } from "express";
import { env } from "../config/env";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { githubService } from "../services/githubService";

const router = Router();
const identityFor = (request: AuthenticatedRequest) => request.identity.kind === "member" ? request.identity : null;
const sendError = (response: import("express").Response, status: number, issue: unknown) => response.status(status).json({ ok: false, message: issue instanceof Error ? issue.message : "GitHub request could not be completed." });
const clientRedirect = (path: string, status: "connected" | "failed") => {
  const base = env.clientUrl.replace(/\/+$/, "");
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/settings";
  return `${base || ""}${safePath}${safePath.includes("?") ? "&" : "?"}github=${status}`;
};

router.get("/github/status", requireAuth, async (request, response) => {
  const identity = identityFor(request as AuthenticatedRequest); if (!identity) return sendError(response, 401, new Error("Sign in to continue."));
  response.json({ ok: true, configured: githubService.isConfigured(), connection: await githubService.getConnection(identity.userId) });
});
router.post("/github/connect", requireAuth, (request, response) => {
  const identity = identityFor(request as AuthenticatedRequest); if (!identity) return sendError(response, 401, new Error("Sign in to continue."));
  try { response.json({ ok: true, authorizeUrl: githubService.createAuthorizeUrl(identity.userId, request.body?.returnPath) }); } catch (issue) { sendError(response, 503, issue); }
});
router.get("/github/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : ""; const state = typeof request.query.state === "string" ? request.query.state : "";
  try { const result = await githubService.completeAuthorization(code, state); response.redirect(303, clientRedirect(result.returnPath, "connected")); } catch { response.redirect(303, clientRedirect("/settings", "failed")); }
});
router.delete("/github/connection", requireAuth, async (request, response) => {
  const identity = identityFor(request as AuthenticatedRequest); if (!identity) return sendError(response, 401, new Error("Sign in to continue."));
  await githubService.disconnect(identity.userId); response.status(204).send();
});
router.get("/github/repositories", requireAuth, async (request, response) => {
  const identity = identityFor(request as AuthenticatedRequest); if (!identity) return sendError(response, 401, new Error("Sign in to continue."));
  try { response.json({ ok: true, repositories: await githubService.listRepositories(identity.userId, typeof request.query.q === "string" ? request.query.q.slice(0, 100) : "") }); } catch (issue) { sendError(response, 403, issue); }
});

export default router;
