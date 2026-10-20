import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ADMIN_AREAS } from "../../lib/admin-access.ts";
import { forbidden } from "../../lib/http-error.ts";
import { serializeUser } from "../../lib/serialize.ts";
import { currentUser, startSession } from "../../middleware/auth.ts";
import * as team from "./team.service.ts";

/** Mounted under /api/admin/team — super admins only. */
export const teamRouter = Router();

const superOnly = (req: Request) => {
  if (currentUser(req).role !== "SUPER_ADMIN") throw forbidden("Only a super admin can manage the team.");
};

teamRouter.get("/", async (req, res) => {
  superOnly(req);
  res.json({ ...(await team.listTeam()), canManage: true });
});

const accessBody = z.object({ adminAccess: z.array(z.enum(ADMIN_AREAS)).max(ADMIN_AREAS.length) });

teamRouter.post("/invites", async (req, res) => {
  superOnly(req);
  const { adminAccess } = accessBody.parse(req.body);
  res.status(201).json(await team.createInvite(currentUser(req), adminAccess));
});

teamRouter.delete("/invites/:id", async (req, res) => {
  superOnly(req);
  await team.cancelInvite(req.params.id);
  res.status(204).end();
});

teamRouter.patch("/:userId", async (req, res) => {
  superOnly(req);
  const { adminAccess } = accessBody.parse(req.body);
  await team.setAccess(req.params.userId, adminAccess);
  res.status(204).end();
});

teamRouter.delete("/:userId", async (req, res) => {
  superOnly(req);
  await team.removeAdmin(currentUser(req), req.params.userId);
  res.status(204).end();
});

/**
 * The invite link itself: /api/admin-invites/:code. Public — the code is the
 * only way in — and rate-limited so codes can't be guessed.
 */
export const inviteRouter = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many tries. Please wait a few minutes.", code: "RATE_LIMITED" } },
});

inviteRouter.get("/:code", limiter, async (req, res) => {
  res.json(await team.checkInvite(String(req.params.code)));
});

inviteRouter.post("/:code/accept", limiter, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z.email().max(254),
      password: z.string().min(8, "Use at least 8 characters.").max(128),
    })
    .parse(req.body);
  const user = await team.acceptInvite(String(req.params.code), body);
  await startSession(req, res, user.id);
  res.status(201).json({ user: serializeUser(user) });
});
