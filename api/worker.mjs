import { Queue, Worker } from "bullmq";
import { deliverNotifications } from "./app.mjs";
import { openDatabase } from "./db.mjs";

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error(
    "The notification worker requires DATABASE_URL and REDIS_URL.",
  );
}
const redis = new URL(process.env.REDIS_URL);
if (!["redis:", "rediss:"].includes(redis.protocol)) {
  throw new Error("Unsupported Redis protocol.");
}

const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: decodeURIComponent(redis.username) || undefined,
  password: decodeURIComponent(redis.password) || undefined,
  db: Number(redis.pathname.slice(1) || 0),
  tls: redis.protocol === "rediss:" ? {} : undefined,
};
const queueName = "medicore-notifications";
const db = await openDatabase({ url: process.env.DATABASE_URL });
const queue = new Queue(queueName, {
  connection: { ...connection, maxRetriesPerRequest: 1 },
});
const report = (event, jobId) =>
  console.error(JSON.stringify({ event, jobId }));
queue.on("error", () => report("notifications.queue_error"));

await queue.upsertJobScheduler(
  "outbox",
  { every: 5000 },
  {
    name: "deliver-pending-notifications",
    opts: {
      attempts: 4,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  },
);

const worker = new Worker(queueName, () => deliverNotifications(db), {
  connection: { ...connection, maxRetriesPerRequest: null },
});
worker.on("error", () => report("notifications.worker_error"));
worker.on("failed", (job) => report("notifications.delivery_failed", job?.id));

async function shutdown() {
  await worker.close();
  await queue.close();
  await db.close();
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdown().catch(() => {
      report("notifications.shutdown_failed");
      process.exitCode = 1;
    });
  });
}
