import { env } from "../config/env.ts";
import type { Mail } from "../lib/mailer.ts";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* ------------------------------------------------------------------ *
 * The look shared by every email: logo, a white card on cream, gold
 * button, and a footer with the studio's links. Table-based with inline
 * styles, because that's what Gmail, Outlook and Apple Mail all render.
 * Images load from the live site (FRONTEND_URL).
 * ------------------------------------------------------------------ */

const C = { cream: "#f6f1ea", card: "#fffdfb", line: "#eadfd6", ink: "#1c1917", soft: "#4a403c", stone: "#8a7b76", gold: "#a9762b" };
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

const STUDIO = {
  instagram: "https://www.instagram.com/_luideo_",
  threads: "https://www.threads.com/@_luideo_",
  whatsapp: "https://wa.me/2348180472584",
};

const asset = (path: string) => `${env.FRONTEND_URL}${path}`;

/**
 * A product photo as a full web address an email app can load: Cloudinary
 * uploads come back small and pre-cropped; brand photos load from the site.
 */
function itemPhoto(photo: string | null | undefined) {
  if (!photo) return null;
  if (/^https?:\/\//.test(photo)) {
    return photo.includes("res.cloudinary.com") && photo.includes("/image/upload/")
      ? photo.replace("/image/upload/", "/image/upload/c_fill,w_160,h_200,f_jpg,q_auto/")
      : photo;
  }
  return asset(photo.startsWith("/") ? photo : `/brand/${photo}.jpg`);
}

/** One item row: thumbnail, name and details, and an optional amount on the right. */
function itemRow(l: { name: string; detail: string; quantity: number; photo?: string | null }, right = "", sub = "") {
  const src = itemPhoto(l.photo);
  const cell = `padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:middle`;
  return `<tr>
<td width="64" style="${cell};padding-right:14px">${
    src
      ? `<img src="${src}" width="56" height="70" alt="${escape(l.name)}" style="display:block;width:56px;height:70px;object-fit:cover;border-radius:6px;border:0;background:${C.line}">`
      : `<div style="width:56px;height:70px;border-radius:6px;background:${C.line}"></div>`
  }</td>
<td style="${cell};font-family:${SANS};font-size:15px;line-height:1.45;color:${C.ink}">${escape(l.name)} <span style="color:${C.stone}">× ${l.quantity}</span><br><span style="font-size:13px;color:${C.stone}">${escape(l.detail)}${sub}</span></td>
${right ? `<td style="${cell};text-align:right;white-space:nowrap;font-family:${SANS};font-size:15px;color:${C.ink}">${right}</td>` : ""}
</tr>`;
}

function layout(body: string, footer = "", options: { preheader?: string; hero?: { src: string; alt: string } } = {}) {
  const link = (href: string, label: string) => `<a href="${href}" style="color:${C.stone};text-decoration:underline">${label}</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Lui'Deo</title></head>
<body style="margin:0;padding:0;background:${C.cream};-webkit-text-size-adjust:100%">
${options.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.cream}">${escape(options.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream}">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td align="center" style="padding:0 0 24px">
      <a href="${env.FRONTEND_URL}" style="text-decoration:none">
        <img src="${asset("/logo/wordmark-black.png")}" width="132" alt="Lui'Deo Jewelry" style="display:block;border:0;width:132px;height:auto;font-family:${SERIF};font-size:22px;color:${C.ink}">
      </a>
    </td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;overflow:hidden">
      ${options.hero ? `<img src="${options.hero.src}" width="560" alt="${escape(options.hero.alt)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:14px 14px 0 0">` : ""}
      <div style="padding:36px 36px 32px;font-family:${SANS};font-size:16px;line-height:1.65;color:${C.soft}">
        ${body}
      </div>
    </td></tr>
    <tr><td align="center" style="padding:28px 12px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.stone}">
      <p style="margin:0 0 8px;font-family:${SERIF};font-size:15px;color:${C.ink}">Handmade coral &amp; pearl jewellery · Lagos</p>
      <p style="margin:0 0 8px">${link(`${env.FRONTEND_URL}/shop`, "Shop")} &nbsp;·&nbsp; ${link(STUDIO.instagram, "Instagram")} &nbsp;·&nbsp; ${link(STUDIO.threads, "Threads")} &nbsp;·&nbsp; ${link(STUDIO.whatsapp, "WhatsApp")}</p>
      <p style="margin:0">Questions? Just reply to this email.${footer}</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** A button that holds its shape in every email app (Outlook included). */
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0"><tr><td style="background:${C.gold};border-radius:6px">
<a href="${href}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;text-decoration:none">${label}</a>
</td></tr></table>`;

const p = (text: string) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.65;color:${C.soft}">${text}</p>`;
const heading = (text: string) => `<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:normal;color:${C.ink}">${text}</h1>`;
const small = (text: string) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.stone}">${text}</p>`;
const divider = `<div style="height:1px;background:${C.line};margin:28px 0"></div>`;
const firstName = (name: string) => escape(name.trim().split(/\s+/)[0] || name);

/** Sent the moment someone creates an account. Email sign-ups also get the confirm button. */
export function welcome(to: string, name: string, verifyToken?: string): Mail {
  const verifyLink = verifyToken ? `${env.FRONTEND_URL}/account/verify?token=${encodeURIComponent(verifyToken)}` : null;
  const perk = (title: string, text: string) =>
    `<tr><td valign="top" style="padding:0 12px 14px 0;font-family:${SERIF};font-size:18px;color:${C.gold}">&#9670;</td>
<td style="padding:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.soft}"><strong style="color:${C.ink}">${title}</strong><br>${text}</td></tr>`;
  const body =
    heading(`Welcome, ${firstName(name)}`) +
    p("Thank you for joining Lui'Deo. Every piece we make — coral beads, pearls, bridal sets — is strung by hand in Lagos, and very often made just for the person wearing it.") +
    (verifyLink
      ? p("One quick thing: please confirm your email so we can send your receipts and order updates.") +
        button(verifyLink, "Confirm my email") +
        small("The link works for 24 hours. If you didn't create this account, you can ignore this email.")
      : "") +
    divider +
    `<p style="margin:0 0 16px;font-family:${SERIF};font-size:20px;color:${C.ink}">With your account you can</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
${perk("Track every order", "See where each piece is, from the bench to your door.")}
${perk("Save pieces you love", "Keep a wishlist and come back to it on any device.")}
${perk("Hear about new pieces first", `Turn on <a href="${env.FRONTEND_URL}/account/alerts" style="color:${C.gold}">new-piece alerts</a> for the kinds of jewellery you like.`)}
</table>` +
    divider +
    p(`Want something made for your day — matched to your aso-oke, gele or gown? <a href="${STUDIO.whatsapp}" style="color:${C.gold}">Message us on WhatsApp</a> and we'll design it with you.`) +
    (verifyLink ? "" : button(`${env.FRONTEND_URL}/shop`, "Browse the collection")) +
    `<p style="margin:24px 0 0;font-family:${SERIF};font-size:17px;font-style:italic;color:${C.ink}">With love,<br>Lui'Deo</p>`;
  return {
    to,
    subject: `Welcome to Lui'Deo, ${name.trim().split(/\s+/)[0] || name}`,
    html: layout(body, "", {
      preheader: verifyLink ? "Confirm your email and see what your account can do." : "Your account is ready — here's what you can do with it.",
      hero: { src: asset("/brand/email-welcome.jpg"), alt: "A red coral bead necklace and bracelet from Lui'Deo" },
    }),
    text: [
      `Welcome, ${name}!`,
      "",
      "Thank you for joining Lui'Deo. Every piece we make is strung by hand in Lagos.",
      ...(verifyLink ? ["", `Please confirm your email (link works for 24 hours): ${verifyLink}`] : []),
      "",
      "With your account you can track every order, keep a wishlist, and turn on new-piece alerts.",
      `Want something made just for you? WhatsApp us: ${STUDIO.whatsapp}`,
      "",
      `Shop: ${env.FRONTEND_URL}/shop`,
      "",
      "With love,",
      "Lui'Deo",
    ].join("\n"),
  };
}

export function verifyEmail(to: string, name: string, token: string): Mail {
  const link = `${env.FRONTEND_URL}/account/verify?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Confirm your email — Lui'Deo",
    html: layout(heading("Confirm your email") + p(`Hello ${firstName(name)}, please confirm this is your email address so we can send your receipts and order updates.`) + button(link, "Confirm my email") + small("The link works for 24 hours."), "", { preheader: "One click to confirm your email." }),
    text: `Hello ${name},\n\nConfirm your email address: ${link}\n\nThis link expires in 24 hours.`,
  };
}

export function resetPassword(to: string, name: string, token: string): Mail {
  const link = `${env.FRONTEND_URL}/account/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your password — Lui'Deo",
    html: layout(heading("Reset your password") + p(`Hello ${firstName(name)}, someone asked to reset the password on your Lui'Deo account. If that was you:`) + button(link, "Choose a new password") + small("The link works for one hour. If you didn't ask for this, you can ignore this email — your password won't change."), "", { preheader: "A link to choose a new password." }),
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
  lines: { name: string; detail: string; quantity: number; photo?: string | null }[];
}): Mail {
  const link = trackLink(order.reference);
  const opening = `We've received payment for order <b>${order.reference}</b> (${escape(order.totalLabel)}). Your pieces go to the bench now and should be ready in about ${order.etaDays} days.`;
  const openingText = `We've received payment for order ${order.reference} (${order.totalLabel}). Ready in about ${order.etaDays} days.`;
  const keep = `To track it, use your order number <b>${order.reference}</b> and this email address.`;
  const rows = order.lines.map((l) => itemRow(l)).join("");
  return {
    to: order.email,
    subject: `Order ${order.reference} confirmed — Lui'Deo`,
    html: layout(
      heading(`Thank you, ${firstName(order.name)}`) +
        p(opening) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px">${rows}</table>` +
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
    html: layout(
      heading(`Your order is ${escape(status.toLowerCase())}`) +
        p(`Hello ${firstName(name)}, a quick update: order <b style="color:${C.ink}">${reference}</b> is now <b style="color:${C.ink}">${escape(status.toLowerCase())}</b>.`) +
        button(trackLink(reference), "Track your order"),
      "",
      { preheader: `Order ${reference} is now ${status.toLowerCase()}.` },
    ),
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
    lines: { name: string; detail: string; quantity: number; unitLabel: string; lineLabel: string; photo?: string | null }[];
    subtotalLabel: string;
    shippingLabel: string;
    totalLabel: string;
    note?: string | null;
    /** Signed read-only page for this order — no sign-in needed. */
    viewUrl: string;
  },
): Mail {
  const link = `${env.FRONTEND_URL}/admin/orders/${encodeURIComponent(order.reference)}`;
  const rows = order.lines.map((l) => itemRow(l, escape(l.lineLabel), ` · ${escape(l.unitLabel)} each`)).join("");
  const sum = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0${bold ? ";font-weight:bold" : ""}">${label}</td><td style="padding:4px 0;text-align:right${bold ? ";font-weight:bold" : ""}">${escape(value)}</td></tr>`;
  const c = order.customer;
  return {
    to,
    subject: `Paid: order ${order.reference} — ${order.totalLabel} from ${order.customer.name}`,
    html: layout(
      heading(`New paid order — ${escape(order.totalLabel)}`) +
        p(`<b style="color:${C.ink}">${escape(c.name)}</b> has paid <b style="color:${C.ink}">${escape(order.totalLabel)}</b> for order <b style="color:${C.ink}">${order.reference}</b>.`) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">${rows}</table>` +
        `<table style="width:100%;border-collapse:collapse;font-size:15px">${sum("Subtotal", order.subtotalLabel)}${sum(`Delivery (${escape(order.shippingMethod)})`, order.shippingLabel)}${sum("Total paid", order.totalLabel, true)}</table>` +
        divider +
        p(`<b>Customer</b><br>${escape(c.name)}<br><a href="mailto:${escape(c.email)}">${escape(c.email)}</a><br>${escape(c.phone)}`) +
        p(`<b>Deliver to</b><br>${escape(order.address)}`) +
        (order.note ? p(`<b>Note</b><br>${escape(order.note).replace(/\n/g, "<br>")}`) : "") +
        button(order.viewUrl, "View this order") +
        small(`Everything about this order on one page — no sign-in needed. To change its status, <a href="${link}" style="color:${C.gold}">open it in the admin</a>.`),
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
      `View this order: ${order.viewUrl}`,
    ].join("\n"),
  };
}

/** Sent when a Zelle / Cash App / Apple Cash / wire order is placed, so the customer can come back to pay and upload a receipt. */
export function manualPaymentPending(order: { reference: string; name: string; email: string; totalLabel: string; orderUrl: string }): Mail {
  return {
    to: order.email,
    subject: `Order ${order.reference}: send ${order.totalLabel} to complete it — Lui'Deo`,
    html: layout(
      heading(`Thank you, ${firstName(order.name)}`) +
        p(`Your order <b style="color:${C.ink}">${order.reference}</b> is reserved. To complete it, send <b style="color:${C.ink}">${escape(order.totalLabel)}</b> by Zelle, Cash App, Apple Cash or U.S. wire, then upload a screenshot of the receipt.`) +
        p(`The payment details are on your order page. Put <b style="color:${C.ink}">${order.reference}</b> in the payment note.`) +
        button(order.orderUrl, "Pay and upload receipt") +
        small("We start making your piece once the studio has confirmed your payment."),
      "",
      { preheader: `Send ${order.totalLabel} and upload your receipt to complete order ${order.reference}.` },
    ),
    text: `Thank you, ${order.name}.\n\nYour order ${order.reference} is reserved. Send ${order.totalLabel} by Zelle, Cash App, Apple Cash or U.S. wire, then upload the receipt. Put ${order.reference} in the payment note.\n\nPayment details and receipt upload: ${order.orderUrl}`,
  };
}

/** Tells the studio a customer has uploaded a payment receipt to check. */
export function receiptForStudio(to: string, order: { reference: string; name: string; email: string; totalLabel: string }): Mail {
  const link = `${env.FRONTEND_URL}/admin/orders/${encodeURIComponent(order.reference)}`;
  return {
    to,
    subject: `Receipt to check: order ${order.reference} — ${order.totalLabel} from ${order.name}`,
    html: layout(
      heading("A payment receipt to check") +
        p(`<b style="color:${C.ink}">${escape(order.name)}</b> (${escape(order.email)}) has uploaded a receipt for <b style="color:${C.ink}">${escape(order.totalLabel)}</b> on order <b style="color:${C.ink}">${order.reference}</b>.`) +
        p("Check the money has arrived in your Zelle, Cash App, Apple Cash or bank account, then confirm the payment in the admin.") +
        button(link, "Open the order"),
      "",
      { preheader: `${order.name} uploaded a receipt for ${order.totalLabel}.` },
    ),
    text: `${order.name} (${order.email}) uploaded a receipt for ${order.totalLabel} on order ${order.reference}.\n\nCheck the money has arrived, then confirm the payment in the admin: ${link}`,
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
      `<p style="margin:0 0 6px;font-family:${SANS};font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${C.gold}">${escape(input.reason)}</p>` +
        heading(escape(input.productName)) +
        p(`${escape(input.tagline)} — ${escape(input.priceLabel)}`) +
        button(productLink, "See the piece"),
      ` <br><a href="${manage}" style="color:#78716c">Manage alerts</a> · <a href="${unsubscribe}" style="color:#78716c">Unsubscribe</a>`,
    ),
    text: `${input.reason}\n\n${input.productName} — ${input.tagline} (${input.priceLabel})\n${productLink}\n\nManage alerts: ${manage}\nUnsubscribe: ${unsubscribe}`,
  };
}

/** Contact-form subjects that are a request for a made-to-order piece. */
export const isCustomRequest = (subject: string) => /custom/i.test(subject);

export function contactToStudio(to: string, m: { name: string; email: string; subject: string; message: string }): Mail {
  return {
    to,
    subject: `${isCustomRequest(m.subject) ? "[Custom order request]" : "[Contact]"} ${m.subject} — ${m.name}`,
    headers: { "Reply-To": m.email },
    html: layout(p(`<b>${escape(m.name)}</b> &lt;${escape(m.email)}&gt; — ${escape(m.subject)}`) + p(escape(m.message).replace(/\n/g, "<br>"))),
    text: `${m.name} <${m.email}> — ${m.subject}\n\n${m.message}`,
  };
}

/** Auto-reply to the customer, so they know their message (or custom request) arrived. */
export function contactReceived(m: { name: string; email: string; subject: string; message: string }): Mail {
  const custom = isCustomRequest(m.subject);
  const opening = custom
    ? "Thank you for your custom order request. We'll look at what you'd like and come back to you within one working day with ideas, a price and how long it will take."
    : "Thank you for your message. Someone from the studio will reply within one working day.";
  return {
    to: m.email,
    subject: custom ? "We've received your custom order request — Lui'Deo" : "We've received your message — Lui'Deo",
    html: layout(
      heading(custom ? "We've got your request" : "We've got your message") +
        p(`Hello ${firstName(m.name)}, ${opening.charAt(0).toLowerCase()}${opening.slice(1)}`) +
        p(`<span style="color:#78716c;font-size:14px">What you sent us (${escape(m.subject)}):</span><br>${escape(m.message).replace(/\n/g, "<br>")}`) +
        p("If you need to add anything, just reply to this email."),
    ),
    text: `Hello ${m.name},\n\n${opening}\n\nWhat you sent us (${m.subject}):\n${m.message}\n\nIf you need to add anything, just reply to this email.`,
  };
}

/** Sent when someone signs up in the footer to hear about new pieces. */
export function newsletterWelcome(to: string, unsubscribeToken: string): Mail {
  const unsubscribe = `${env.API_URL}/api/alerts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  return {
    to,
    subject: "You're on the list — Lui'Deo",
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    html: layout(
      heading("You're on the list") +
        p("Thank you for signing up.") +
        p("We'll email you whenever a new piece is added to the shop — coral, pearl, bridal sets, earrings and more.") +
        button(`${env.FRONTEND_URL}/shop`, "See what's in the shop now"),
      ` <br><a href="${unsubscribe}" style="color:#78716c">Unsubscribe</a>`,
    ),
    text: `Thank you for signing up.\n\nWe'll email you whenever a new piece is added to the shop.\n\nShop now: ${env.FRONTEND_URL}/shop\n\nUnsubscribe: ${unsubscribe}`,
  };
}
