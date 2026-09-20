import nodemailer from "nodemailer";
import { env } from "../config/env.ts";

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/** Sends through SMTP, or prints to the console when SMTP isn't configured. */
export async function sendMail(mail: Mail) {
  if (!transport) {
    console.log(`\n✉️  [dev email] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
}

/** Fire-and-forget: a failed email should never fail the request that caused it. */
export function sendMailInBackground(mail: Mail) {
  sendMail(mail).catch((err) => console.error(`Email to ${mail.to} failed:`, err));
}
