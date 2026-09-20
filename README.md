# Lui'Deo — backend

Express 5 + Prisma 7 + PostgreSQL API for the storefront in `../frontend`.

- **Shopping never needs an account.** Guests can browse, check out and open their order confirmation.
- **Optional accounts:** email + password, or Google. Logout (this device or all devices), email verification, password reset.
- **New-piece alerts:** customers can opt in to hear when something similar to what they bought is added (same category or collection), or follow categories/collections outright. They get an email and, if they have an account, an in-app notification.
- **Payments:** Paystack for both ₦ and $ (card, bank transfer, USSD), plus pay on delivery in Lagos. Payments are confirmed by webhook, and also by asking Paystack directly when the customer comes back.
- **Instagram & Facebook:** connect a Facebook Page and its linked Instagram account once, then post new pieces to the feed or stories, now or on a schedule.
- **Admin:** products (with photo upload), categories, orders, customers, dashboard stats, social posts, contact inbox.

## Getting started

```bash
cd backend
npm install
cp .env.example .env        # then set SESSION_SECRET: openssl rand -hex 32
npm run db:up               # Postgres 17 in Docker on port 5433
npm run db:migrate          # create tables
npm run db:seed             # the 18 products + 7 categories, and an admin if ADMIN_EMAIL/ADMIN_PASSWORD are set
npm run dev                 # http://localhost:4000/api/health
```

Only `DATABASE_URL` and `SESSION_SECRET` are needed to boot. Each integration switches on once its keys are in `.env`. Until SMTP is set up, **emails are printed to the terminal**, so you can click verification and reset links while developing.

| Script | What it does |
| --- | --- |
| `npm run dev` | Watch mode |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run db:migrate` | Create a migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:studio` | Browse the database |

## What you need to set up

### Google sign-in
1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Under **APIs & Services → OAuth consent screen**, choose External, fill in the app name, support email, and the logo and privacy policy URL, then publish it.
3. Under **APIs & Services → Credentials → Create credentials → OAuth client ID**, choose **Web application**.
   - **Authorised JavaScript origins:** `http://localhost:3000` and `https://your-domain.com`.
   - No redirect URI is needed, because the frontend uses Google Identity Services, which returns an ID token directly.
4. Put the client ID in `GOOGLE_CLIENT_ID` (backend) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend). **No client secret is needed.**

On the frontend, render the Google button and send the credential it returns to `POST /api/auth/google { credential }`. The backend verifies it with Google.

If someone signs up with a password and later uses Google with the same email, the two are merged into one account. If the password account never verified its email, that password is removed, so nobody can pre-register someone else's address.

### Email (needed in production)
Use any SMTP provider (Resend, Postmark, Brevo, Mailgun, or Zoho Mail): set `SMTP_HOST/PORT/USER/PASS` and `MAIL_FROM`. Verify your sending domain (SPF/DKIM) with the provider, or alert emails will end up in spam.

### Payments: Paystack
1. Sign up at [paystack.com](https://paystack.com) as a Nigerian business and complete compliance (CAC documents, ID and a settlement bank account). You can use test mode before approval.
2. Go to **Settings → API Keys & Webhooks**:
   - Copy the secret key into `PAYSTACK_SECRET_KEY`. Use `sk_test_…` first and `sk_live_…` once approved.
   - Set the webhook URL to `https://api.your-domain.com/api/webhooks/paystack`.
3. **Dollars:** ask Paystack to enable USD for your business. This needs a USD (domiciliary) settlement account. Until it's enabled, set `PAYSTACK_CURRENCIES=NGN`. The checkout then offers card payment in naira only, and USD shoppers are asked to switch currency or message the studio.

Test cards are listed at <https://paystack.com/docs/payments/test-payments>.

### Instagram & Facebook posting
You need:
- A **Facebook Page** for Lui'Deo.
- An **Instagram Business or Creator account** linked to that Page (in Instagram: Settings → Account type; then in the Page settings: Linked accounts → Instagram).
- A **Meta developer app**:
  1. At [developers.facebook.com](https://developers.facebook.com), create an app of type **Business**, and add the **Facebook Login for Business** and **Instagram Graph API** products.
  2. In Facebook Login settings, add `https://api.your-domain.com/api/admin/social/callback` (and `http://localhost:4000/api/admin/social/callback` for development) as a valid OAuth redirect URI.
  3. Copy the App ID and App Secret into `META_APP_ID` and `META_APP_SECRET`.
  4. While the app is in development mode, only people with a role on the app can connect. To use it with the studio's own Page that's enough; you don't have to publish the app. If you do go live, Meta's **App Review** must approve `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_content_publish` and `business_management`, and requires **Business Verification**.
- **Public image URLs.** Meta downloads the photo itself, so it won't work from `localhost`. Deploy first, or use a tunnel such as ngrok for testing. Instagram only accepts JPEGs with an aspect ratio between 4:5 and 1.91:1.

Then open **Admin → Instagram & Facebook → Connect with Facebook**. The Page token is stored encrypted (derived from `SESSION_SECRET`, so changing that secret means reconnecting).

Scheduling runs inside the API process: it checks every minute and publishes whatever is due. Instagram's API doesn't allow link stickers on stories.

### Photo uploads
Set `CLOUDINARY_URL` (from your free Cloudinary account's dashboard) so uploads survive redeploys and PNGs can be converted to JPEG for Instagram. Without it, files are saved to `backend/uploads/`. That works locally, but most hosts wipe the disk on each deploy.

## How the pieces fit

### Sessions
Signing in sets an httpOnly cookie called `luideo_session`. The database stores only a hash of it, so logging out deletes the row and takes effect immediately. Browser `fetch` calls must use `credentials: "include"`.

Deploy the API on a subdomain of the shop (`api.luideo.com` + `luideo.com`) and set `COOKIE_SAMESITE=lax` and `COOKIE_DOMAIN=.luideo.com`. Any request that changes something and carries the cookie must come from `FRONTEND_URL` or `CORS_ORIGINS` (this is the CSRF protection).

### Guest checkout
`POST /api/orders` returns `{ order, guestToken, paymentUrl }`:
1. Redirect the customer to `paymentUrl` (Paystack's hosted page). For pay on delivery it is `null`, so go straight to the confirmation page. If Paystack couldn't be reached, the response includes `paymentError`; the order is kept, and `POST /api/orders/:ref/pay { token }` starts a new payment attempt.
2. Paystack sends them back to `/checkout/success?ref=…&token=…`, or to `/checkout?cancelled=1&…` if they cancelled.
3. The confirmation page calls `GET /api/orders/:ref?token=…`. If the webhook hasn't arrived yet, the API checks with Paystack and marks the order paid.

Prices, stock, shipping and ETA are always recomputed on the server. When a guest later creates an account with the same email and verifies it, their past orders are attached to the account.

### New-piece alerts
- **At checkout:** send `notifySimilar: true` (e.g. from a "Tell me when similar pieces arrive" checkbox).
- **From the account page:** `GET/PUT /api/me/alerts` with `{ enabled, similarToPurchases, categories[], collections[] }`. This needs a verified email.
- **When a product is published** (created as published, or a draft switched to published), matching subscribers get an email and an in-app notification (`GET /api/me/notifications`). Later edits don't send it again.
- Matching uses **paid** orders only. Every email has a one-click unsubscribe link.
- Seeded products are marked as already announced, so seeding doesn't email anyone.

## API

All routes are under `/api`. Errors look like `{ error: { message, code, fields? } }`.

**Public:** `GET /health`, `GET /meta` (categories, collections, materials, shipping methods, and the payment methods currently available per currency), `GET /categories`, `GET /products?category&collection&material&q&ids&sort&page&pageSize`, `GET /products/:slug`, `POST /orders`, `GET /orders/:reference?token`, `POST /orders/:reference/pay`, `POST /contact`, `GET|POST /alerts/unsubscribe?token`

**Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me` (returns `{ user: null }` for guests), `GET /auth/config`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`

**Signed in (`/me`):** `PATCH /me`, `GET /me/orders`, `GET /me/orders/:reference`, `GET /me/wishlist`, `PUT|DELETE /me/wishlist/:productId`, `POST /me/wishlist/merge`, `GET|PUT /me/alerts`, `GET /me/notifications`, `POST /me/notifications/read`

**Admin (`/admin`):** `POST /uploads` (raw image body), `GET /social/status`, `GET /social/connect`, `GET|POST /social/pages`, `POST /social/disconnect`, `GET|POST /social/posts`, `POST /social/posts/:id/retry`, `DELETE /social/posts/:id`, `GET /stats`, `GET|POST /products`, `GET|PATCH|DELETE /products/:id` (delete archives), `POST /categories`, `PATCH /categories/:slug`, `GET /orders?status&payment&q`, `GET|PATCH /orders/:id` (`{ status, note, markPaid, notifyCustomer }`), `GET /customers`, `GET /messages`

Responses use the same shapes as `frontend/src/lib/types.ts` (`Product`, `Money` as `{ ngn, usd }`, order status labels like `"In the studio"`), so the mock data in the frontend can be swapped for these calls.

## Deploying
Any Node host with Postgres works (Railway, Render, Fly.io, or a VPS with Neon or Supabase for the database):

```bash
npm ci && npm run build && npm run db:deploy && npm start
```

Set `NODE_ENV=production`, `API_URL`, `FRONTEND_URL`, and the keys above. On first deploy, run `npm run db:seed` once with `ADMIN_EMAIL`/`ADMIN_PASSWORD` set, then remove the password from the environment.
