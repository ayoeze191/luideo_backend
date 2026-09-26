import { env } from "../config/env.ts";
import type { Mail } from "../lib/mailer.ts";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(body: string, footer = "") {
  return `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:Georgia,serif;color:#1c1917">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<p style="font-size:22px;letter-spacing:.04em;margin:0 0 28px">Lui'Deo</p>
${body}
<p style="margin-top:40px;font-size:12px;color:#78716c">Lui'Deo · Coral and pearl, made in Lagos.${footer}</p>
</div></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:28px 0"><a href="${href}" style="background:#1c1917;color:#f6f1ea;padding:12px 22px;text-decoration:none;font-family:Arial,sans-serif;font-size:14px">${label}</a></p>`;

const p = (text: string) => `<p style="line-height:1.6;font-size:16px">${text}</p>`;

export function verifyEmail(to: string, name: string, token: string): Mail {
  const link = `${env.FRONTEND_URL}/account/verify?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Confirm your email — Lui'Deo",
    html: layout(p(`Hello ${escape(name)},`) + p("Please confirm this is your email address.") + button(link, "Confirm email") + p("This link expires in 24 hours.")),
    text: `Hello ${name},\n\nConfirm your email address: ${link}\n\nThis link expires in 24 hours.`,
  };
}

export function resetPassword(to: string, name: string, token: string): Mail {
  const link = `${env.FRONTEND_URL}/account/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your password — Lui'Deo",
    html: layout(p(`Hello ${escape(name)},`) + p("Someone asked to reset the password on your account. If that was you:") + button(link, "Choose a new password") + p("The link expires in one hour. If you didn't ask for this, you can ignore this email.")),
    text: `Hello ${name},\n\nReset your password: ${link}\n\nThe link expires in one hour. If you didn't ask for this, ignore this email.`,
  };
}

/** Guests have no account to sign in to, so every order email links here. */
export const trackLink = (reference: string) => `${env.FRONTEND_URL}/track?ref=${encodeURIComponent(reference)}`;

export function orderReceipt(order: {
  reference: string;
  name: string;
  email: string;
  totalLabel: string;
  etaDays: number;
  lines: { name: string; detail: string; quantity: number }[];
}): Mail {
  const link = trackLink(order.reference);
  const opening = `We've received payment for order <b>${order.reference}</b> (${escape(order.totalLabel)}). Your pieces go to the bench now and should be ready in about ${order.etaDays} days.`;
  const openingText = `We've received payment for order ${order.reference} (${order.totalLabel}). Ready in about ${order.etaDays} days.`;
  const keep = `To track it, use your order number <b>${order.reference}</b> and this email address.`;
  const rows = order.lines
    .map((l) => `<li style="margin:6px 0">${escape(l.name)} × ${l.quantity}<br><span style="color:#78716c;font-size:14px">${escape(l.detail)}</span></li>`)
    .join("");
  return {
    to: order.email,
    subject: `Order ${order.reference} confirmed — Lui'Deo`,
    html: layout(
      p(`Thank you, ${escape(order.name)}.`) +
        p(opening) +
        `<ul style="padding-left:18px;font-size:16px">${rows}</ul>` +
        p(keep) +
        button(link, "Track your order"),
    ),
    text: `Thank you, ${order.name}.\n\n${openingText}\n\n${order.lines.map((l) => `- ${l.name} × ${l.quantity} (${l.detail})`).join("\n")}\n\nTrack it with your order number ${order.reference} and this email address:\n${link}`,
  };
}

export function orderStatusUpdate(to: string, name: string, reference: string, status: string): Mail {
  return {
    to,
    subject: `Order ${reference}: ${status} — Lui'Deo`,
    html: layout(p(`Hello ${escape(name)},`) + p(`Your order <b>${reference}</b> is now <b>${escape(status.toLowerCase())}</b>.`) + button(trackLink(reference), "Track your order")),
    text: `Hello ${name},\n\nYour order ${reference} is now ${status.toLowerCase()}.\n\nTrack it: ${trackLink(reference)}`,
  };
}

export function newOrderForStudio(
  to: string,
  order: {
    reference: string;
    customer: { name: string; email: string; phone: string };
    address: string;
    shippingMethod: string;
    lines: { name: string; detail: string; quantity: number; unitLabel: string; lineLabel: string }[];
    subtotalLabel: string;
    shippingLabel: string;
    totalLabel: string;
    note?: string | null;
  },
): Mail {
  const link = `${env.FRONTEND_URL}/admin/orders/${encodeURIComponent(order.reference)}`;
  const cell = "padding:8px 0;border-bottom:1px solid #e7e5e4;vertical-align:top";
  const rows = order.lines
    .map(
      (l) =>
        `<tr><td style="${cell}">${escape(l.name)} × ${l.quantity}<br><span style="color:#78716c;font-size:13px">${escape(l.detail)} · ${escape(l.unitLabel)} each</span></td>` +
        `<td style="${cell};text-align:right;white-space:nowrap">${escape(l.lineLabel)}</td></tr>`,
    )
    .join("");
  const sum = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0${bold ? ";font-weight:bold" : ""}">${label}</td><td style="padding:4px 0;text-align:right${bold ? ";font-weight:bold" : ""}">${escape(value)}</td></tr>`;
  const c = order.customer;
  return {
    to,
    subject: `Paid: order ${order.reference} — ${order.totalLabel} from ${order.customer.name}`,
    html: layout(
      p(`<b>${escape(c.name)}</b> has paid <b>${escape(order.totalLabel)}</b> for order <b>${order.reference}</b>.`) +
        `<table style="width:100%;border-collapse:collapse;font-size:15px;margin:16px 0">${rows}</table>` +
        `<table style="width:100%;border-collapse:collapse;font-size:15px">${sum("Subtotal", order.subtotalLabel)}${sum(`Delivery (${escape(order.shippingMethod)})`, order.shippingLabel)}${sum("Total paid", order.totalLabel, true)}</table>` +
        p(`<b>Customer</b><br>${escape(c.name)}<br><a href="mailto:${escape(c.email)}">${escape(c.email)}</a><br>${escape(c.phone)}`) +
        p(`<b>Deliver to</b><br>${escape(order.address)}`) +
        (order.note ? p(`<b>Note</b><br>${escape(order.note).replace(/\n/g, "<br>")}`) : "") +
        button(link, "Open the order"),
    ),
    text: [
      `${c.name} has paid ${order.totalLabel} for order ${order.reference}.`,
      "",
      ...order.lines.map((l) => `- ${l.name} × ${l.quantity} (${l.detail}) — ${l.unitLabel} each, ${l.lineLabel}`),
      "",
      `Subtotal: ${order.subtotalLabel}`,
      `Delivery (${order.shippingMethod}): ${order.shippingLabel}`,
      `Total paid: ${order.totalLabel}`,
      "",
      `Customer: ${c.name}, ${c.email}, ${c.phone}`,
      `Deliver to: ${order.address}`,
      ...(order.note ? ["", `Note: ${order.note}`] : []),
      "",
      `Open the order: ${link}`,
    ].join("\n"),
  };
}

export function similarProductAlert(input: {
  to: string;
  productName: string;
  tagline: string;
  slug: string;
  priceLabel: string;
  reason: string;
  unsubscribeToken: string;
}): Mail {
  const productLink = `${env.FRONTEND_URL}/product/${input.slug}`;
  const unsubscribe = `${env.API_URL}/api/alerts/unsubscribe?token=${encodeURIComponent(input.unsubscribeToken)}`;
  const manage = `${env.FRONTEND_URL}/account/alerts`;
  return {
    to: input.to,
    subject: `New at Lui'Deo: ${input.productName}`,
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    html: layout(
      `<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#78716c">${escape(input.reason)}</p>` +
        `<p style="font-size:26px;margin:8px 0">${escape(input.productName)}</p>` +
        p(`${escape(input.tagline)} — ${escape(input.priceLabel)}`) +
        button(productLink, "See the piece"),
      ` <br><a href="${manage}" style="color:#78716c">Manage alerts</a> · <a href="${unsubscribe}" style="color:#78716c">Unsubscribe</a>`,
    ),
    text: `${input.reason}\n\n${input.productName} — ${input.tagline} (${input.priceLabel})\n${productLink}\n\nManage alerts: ${manage}\nUnsubscribe: ${unsubscribe}`,
  };
}

export function contactToStudio(to: string, m: { name: string; email: string; subject: string; message: string }): Mail {
  return {
    to,
    subject: `[Contact] ${m.subject} — ${m.name}`,
    headers: { "Reply-To": m.email },
    html: layout(p(`<b>${escape(m.name)}</b> &lt;${escape(m.email)}&gt; — ${escape(m.subject)}`) + p(escape(m.message).replace(/\n/g, "<br>"))),
    text: `${m.name} <${m.email}> — ${m.subject}\n\n${m.message}`,
  };
}
