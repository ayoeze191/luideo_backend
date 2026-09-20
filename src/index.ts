import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./lib/prisma.ts";
import { startSocialScheduler } from "./modules/social/social.service.ts";

startSocialScheduler();

const server = createApp().listen(env.PORT, () => {
  console.log(`Lui'Deo API listening on ${env.API_URL} (port ${env.PORT})`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
