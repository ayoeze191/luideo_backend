import type { NextFunction, Request, Response } from "express";
import type { User } from "../generated/prisma/client.ts";
import { forbidden, unauthorized } from "./http-error.ts";

/* ------------------------------------------------------------------ *
 * Which parts of the admin an ADMIN can use. A super admin picks them
 * on the invite link, and can change them later from the Team page.
 * SUPER_ADMIN always has every area (and the Team page on top).
 * ------------------------------------------------------------------ */

export const ADMIN_AREAS = ["dashboard", "orders", "products", "customers", "social", "messages", "gallery", "payments"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

export function hasAccess(user: Pick<User, "role" | "adminAccess"> | undefined, area: AdminArea) {
  if (user?.role === "SUPER_ADMIN") return true;
  return user?.role === "ADMIN" && user.adminAccess.includes(area);
}

/** The areas a user can actually use, for the frontend to show. */
export function accessOf(user: Pick<User, "role" | "adminAccess">): AdminArea[] {
  return ADMIN_AREAS.filter((a) => hasAccess(user, a));
}

/** Lets the request through if the admin has any one of `areas`. */
export function requireAccess(...areas: AdminArea[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!areas.some((a) => hasAccess(req.user, a))) throw forbidden("You don't have access to this part of the admin.");
    next();
  };
}
