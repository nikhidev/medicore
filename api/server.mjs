import { mkdir } from "node:fs/promises";
import { createApp, deliverNotifications } from "./app.mjs";
import { openDatabase } from "./db.mjs";

const url = process.env.DATABASE_URL;
const dataDir = process.env.DATA_DIR ?? "./.data/pg";
const secure = process.env.COOKIE_SECURE === "true";
const seed = process.env.DEMO_SEED === "true";
if (secure && (!url || seed))
  throw new Error(
    "Secure mode requires a PostgreSQL server and demo seeding disabled.",
  );
if (!url) await mkdir(dataDir, { recursive: true });
const db = await openDatabase({ url, dataDir, seed });
const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";
const origins = process.env.APP_ORIGINS?.split(",");
const server = createApp(db, {
  secure,
  origins,
  logging: true,
  analyticsUrl: process.env.ANALYTICS_URL,
  analyticsKey: process.env.ANALYTICS_KEY,
}).listen(port, host, () =>
  console.log("MediCore API listening on " + host + ":" + port),
);
const worker =
  process.env.NOTIFICATION_MODE === "external"
    ? undefined
    : setInterval(
        () =>
          deliverNotifications(db).catch(() =>
            console.error(JSON.stringify({ event: "notifications.retry" })),
          ),
        5000,
      );
worker?.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    clearInterval(worker);
    server.close(async () => {
      await db.close();
      process.exit();
    });
  });
