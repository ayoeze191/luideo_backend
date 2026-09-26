import { z } from "zod";

/** Empty strings in .env mean "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_URL: z.url().default("http://localhost:4000"),
  FRONTEND_URL: z.url().default("http://localhost:3000"),
  CORS_ORIGINS: optional,

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: optional,

  GOOGLE_CLIENT_ID: optional,

  /** Resend (resend.com). When set, email goes through Resend's API instead of SMTP. */
  RESEND_API_KEY: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: z.string().default("Lui'Deo <hello@luideo.com>"),
  STUDIO_EMAIL: optional,

  PAYSTACK_SECRET_KEY: optional,
  /** Remove USD until Paystack has enabled it on the account. */
  PAYSTACK_CURRENCIES: z.string().default("NGN,USD"),

  META_APP_ID: optional,
  META_APP_SECRET: optional,
  /** Facebook Login for Business configuration ID. When set, it replaces the scope list. */
  META_CONFIG_ID: optional,
  META_GRAPH_VERSION: z.string().default("v23.0"),

  CLOUDINARY_URL: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

/** Every browser origin allowed to call the API with credentials. */
export const allowedOrigins = [
  new URL(env.FRONTEND_URL).origin,
  ...(env.CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
];
