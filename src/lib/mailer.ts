import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "../config/env.ts";

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

/** Resend when its key is set, otherwise SMTP when a host is set, otherwise the console. */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const transport =
  !resend && env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      })
    : null;

export async function sendMail(mail: Mail) {
  if (resend) {
    // Resend takes Reply-To as its own field rather than a raw header.
    const { "Reply-To": replyTo, ...headers } = mail.headers ?? {};
    const { error } = await resend.emails.send({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(replyTo && { replyTo }),
      ...(Object.keys(headers).length > 0 && { headers }),
    });
    // The SDK reports failures in the result instead of throwing; throw so callers log them.
    if (error) throw new Error(`Resend: ${error.name} — ${error.message}`);
    return;
  }
  if (transport) {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    return;
  }
  console.log(`\n✉️  [dev email] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
}

/** Fire-and-forget: a failed email should never fail the request that caused it. */
export function sendMailInBackground(mail: Mail) {
  sendMail(mail).catch((err) => console.error(`Email to ${mail.to} failed:`, err));
}
