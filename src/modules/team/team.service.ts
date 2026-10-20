import bcrypt from "bcryptjs";
import { env } from "../../config/env.ts";
import type { User } from "../../generated/prisma/client.ts";
import { badRequest, forbidden, notFound } from "../../lib/http-error.ts";
import { prisma } from "../../lib/prisma.ts";
import { hashToken, randomToken } from "../../lib/tokens.ts";
import { normaliseEmail } from "../auth/auth.service.ts";

/* ------------------------------------------------------------------ *
 * The studio team: who can use the admin, and how new people join.
 * A super admin makes a one-time invite link; whoever opens it sets up
 * an admin account (or turns their existing account into one). The link
 * works once and expires after INVITE_DAYS.
 * ------------------------------------------------------------------ */

const INVITE_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export const isAdmin = (u?: Pick<User, "role"> | null) => u?.role === "ADMIN" || u?.role === "SUPER_ADMIN";

export async function listTeam() {
  const people = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  const invites = await prisma.adminInvite.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, expiresAt: true, createdAt: true },
  });
  return { people, invites };
}

export async function createInvite(by: User) {
  const token = randomToken();
  const invite = await prisma.adminInvite.create({
    data: { tokenHash: hashToken(token), createdById: by.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000) },
  });
  return { url: `${env.FRONTEND_URL}/admin-invite?code=${encodeURIComponent(token)}`, expiresAt: invite.expiresAt };
}

export async function cancelInvite(id: string) {
  await prisma.adminInvite.deleteMany({ where: { id, usedAt: null } });
}

/** Takes admin access away (the account stays, as a customer). */
export async function removeAdmin(by: User, userId: string) {
  if (userId === by.id) throw badRequest("You can't remove yourself.", "SELF");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || !isAdmin(target)) throw notFound("No admin with that id.");
  if (target.role === "SUPER_ADMIN") throw forbidden("Super admins can't be removed here.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { role: "CUSTOMER" } }),
    // Signs them out everywhere, so the admin closes for them straight away.
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

async function liveInvite(token: string) {
  const invite = await prisma.adminInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

export async function checkInvite(token: string) {
  const invite = await liveInvite(token);
  return invite ? { valid: true as const, expiresAt: invite.expiresAt } : { valid: false as const };
}

/**
 * Uses the invite. A new email gets a new admin account; an email that already
 * has an account must give that account's password, and is then made an admin.
 */
export async function acceptInvite(token: string, input: { name: string; email: string; password: string }) {
  const invite = await liveInvite(token);
  if (!invite) throw badRequest("This invite link has expired or has already been used. Ask for a new one.", "INVITE_INVALID");

  const email = normaliseEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash && !(await bcrypt.compare(input.password, existing.passwordHash))) {
    throw badRequest("This email already has an account. Enter that account's password to make it an admin.", "WRONG_PASSWORD");
  }

  // Claim the invite first, so two tabs can't both use it.
  const { count } = await prisma.adminInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!count) throw badRequest("This invite link has already been used.", "INVITE_INVALID");

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: existing.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : invite.role,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          // A Google-only account gets a password too, so it can also sign in with email.
          ...(existing.passwordHash ? {} : { passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) }),
        },
      })
    : await prisma.user.create({
        data: {
          email,
          name: input.name.trim(),
          role: invite.role,
          // The invite came from the studio, so the address is taken as confirmed.
          emailVerifiedAt: new Date(),
          passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
        },
      });
  await prisma.adminInvite.update({ where: { id: invite.id }, data: { usedById: user.id } });
  return user;
}
