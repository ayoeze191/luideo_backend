import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.ts";
import * as alerts from "./alerts.service.ts";

/** Public — reached from the unsubscribe link in alert emails. */
export const alertsRouter = Router();

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Georgia,serif;background:#f6f1ea;color:#1c1917;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:420px;text-align:center"><p style="font-size:26px">${title}</p><p style="line-height:1.6">${body}</p>
<p><a href="${env.FRONTEND_URL}" style="color:#1c1917">Back to Lui'Deo</a></p></div></body></html>`;

alertsRouter.get("/unsubscribe", async (req, res) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.query);
  const ok = await alerts.unsubscribe(token);
  res
    .status(ok ? 200 : 404)
    .type("html")
    .send(
      ok
        ? page("You're unsubscribed", "We won't email you about new pieces any more. You can turn alerts back on from your account at any time.")
        : page("Link not recognised", "This unsubscribe link isn't valid. If you're still getting emails, reply to one and we'll sort it."),
    );
});

/** RFC 8058 one-click unsubscribe, sent by mail providers on the user's behalf. */
alertsRouter.post("/unsubscribe", async (req, res) => {
  const token = z.string().min(1).parse(req.query.token ?? req.body?.token);
  await alerts.unsubscribe(token);
  res.status(204).end();
});
