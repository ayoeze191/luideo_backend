import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.ts";
import * as emails from "../../emails/templates.ts";
import type { EmailTokenPurpose, User } from "../../generated/prisma/client.ts";
import { HttpError, badRequest, conflict, unauthorized } from "../../lib/http-error.ts";
import { sendMailInBackground } from "../../lib/mailer.ts";
import { prisma } from "../../lib/prisma.ts";
import { hashToken, randomToken } from "../../lib/tokens.ts";

const BCRYPT_ROUNDS = 12;
/** Compared against when the email doesn't exist, so response time doesn't reveal it. */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

const TOKEN_TTL: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 60 * 60 * 1000,
  RESET_PASSWORD: 60 * 60 * 1000,
};

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/* ----------------------------------------------------------- Password */

export async function register(input: { name: string; email: string; password: string; phone?: string }) {
  const email = normaliseEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw conflict(
      existing.passwordHash
        ? "An account with this email already exists. Try signing in."
        : "This email is registered with Google. Use “Continue with Google”.",
      "EMAIL_TAKEN",
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    },
  });
  await sendVerificationEmail(user);
  return user;
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(input.email) } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (user && !user.passwordHash && user.googleId) {
    throw new HttpError(400, "This account uses Google sign-in. Use “Continue with Google”.", "USE_GOOGLE");
  }
  if (!user || !ok) throw unauthorized("That email and password don't match.");
  return user;
}

export async function changePassword(user: User, currentPassword: string | undefined, newPassword: string) {
  if (user.passwordHash) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw badRequest("Your current password isn't right.", "WRONG_PASSWORD");
    }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
  });
}

/* ----------------------------------------------------------- Google */

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

/**
 * Takes the ID token ("credential") that Google Identity Services hands the
 * browser, verifies it with Google, and finds or creates the matching user.
 */
export async function loginWithGoogle(credential: string) {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) {
    throw new HttpError(503, "Google sign-in isn't configured yet.", "GOOGLE_DISABLED");
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized("Google sign-in failed. Please try again.");
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw unauthorized("Your Google account needs a verified email address.");
  }

  const email = normaliseEmail(payload.email);
  const profile = { avatarUrl: payload.picture ?? null };

  const byGoogle = await prisma.user.findUnique({ where: { googleId: payload.sub } });
  if (byGoogle) {
    return prisma.user.update({ where: { id: byGoogle.id }, data: profile });
  }

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    // Google has just proven this person owns the email. If the existing
    // account never verified it, someone else may have registered it first —
    // drop that password and its sessions rather than hand them the account.
    const unverified = !byEmail.emailVerifiedAt;
    if (unverified) await prisma.session.deleteMany({ where: { userId: byEmail.id } });
    const user = await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        ...profile,
        googleId: payload.sub,
        emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
        ...(unverified ? { passwordHash: null } : {}),
      },
    });
    await linkGuestHistory(user);
    return user;
  }

  const user = await prisma.user.create({
    data: {
      ...profile,
      email,
      name: payload.name ?? email.split("@")[0]!,
      googleId: payload.sub,
      emailVerifiedAt: new Date(),
    },
  });
  await linkGuestHistory(user);
  return user;
}

/* ----------------------------------------------------------- Email tokens */

async function issueEmailToken(userId: string, purpose: EmailTokenPurpose) {
  // One live token per purpose — requesting a new link kills the old one.
  await prisma.emailToken.deleteMany({ where: { userId, purpose, usedAt: null } });
  const token = randomToken();
  await prisma.emailToken.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL[purpose]) },
  });
  return token;
}

async function consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
    throw badRequest("This link has expired or already been used. Request a new one.", "INVALID_TOKEN");
  }
  await prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.user;
}

export async function sendVerificationEmail(user: User) {
  if (user.emailVerifiedAt) return;
  const token = await issueEmailToken(user.id, "VERIFY_EMAIL");
  sendMailInBackground(emails.verifyEmail(user.email, user.name, token));
}

export async function verifyEmail(token: string) {
  const user = await consumeEmailToken(token, "VERIFY_EMAIL");
  const verified = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  await linkGuestHistory(verified);
  return verified;
}

export async function requestPasswordReset(emailInput: string) {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(emailInput) } });
  // Always succeed from the caller's point of view — don't reveal who has an account.
  if (!user) return;
  const token = await issueEmailToken(user.id, "RESET_PASSWORD");
  sendMailInBackground(emails.resetPassword(user.email, user.name, token));
}

export async function resetPassword(token: string, password: string) {
  const user = await consumeEmailToken(token, "RESET_PASSWORD");
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      // Clicking the emailed link proves ownership of the address too.
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
}

/* ----------------------------------------------------------- Guest history */

/**
 * Once we know someone really owns an email, attach anything they did as a
 * guest under it: past orders and their new-piece alert subscription.
 * Only ever called for verified emails, so nobody can claim another person's orders.
 */
export async function linkGuestHistory(user: User) {
  if (!user.emailVerifiedAt) return;
  await prisma.order.updateMany({ where: { email: user.email, userId: null }, data: { userId: user.id } });
  await prisma.alertSubscription.updateMany({ where: { email: user.email, userId: null }, data: { userId: user.id } });
}
