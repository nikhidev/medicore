import { readFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, hash) {
  const [salt] = hash.split(":");
  return timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hashPassword(password, salt)),
  );
}

export async function openDatabase({ url, dataDir, seed = false } = {}) {
  const engine = url
    ? new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2500 })
    : new PGlite(dataDir);
  if (url)
    engine.on("error", () =>
      console.error(JSON.stringify({ event: "database_connection_lost" })),
    );
  const db = {
    query: (...args) => engine.query(...args),
    close: () => (url ? engine.end() : engine.close()),
    transaction: async (work) => {
      if (!url) return engine.transaction(work);
      const client = await engine.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(934221)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS migrations(version integer PRIMARY KEY)",
    );
    const applied = await tx.query(
      "SELECT version FROM migrations WHERE version=1",
    );
    if (applied.rows.length) return;
    if (url) await tx.query(sql);
    else await tx.exec(sql);
    await tx.query("INSERT INTO migrations VALUES (1)");
  });
  if (seed) await seedDemo(db);
  return db;
}

const demoUsers = [
  ["admin", "admin", "Maya Chen", null],
  ["reception", "receptionist", "Avery Brooks", null],
  ["doctor", "doctor", "Dr. Priya Mehta", "cardiology"],
  ["doctor2", "doctor", "Dr. Daniel Foster", "general"],
  ["doctor3", "doctor", "Dr. Imani Okafor", "neurology"],
  ["nurse", "nurse", "Sana Patel", "cardiology"],
  ["lab", "lab", "Jordan Reed", null],
  ["billing", "billing", "Morgan Lee", null],
  ["patient", "patient", "Olivia Bennett", null],
  ["patient2", "patient", "Ethan Morgan", null],
];

export async function seedDemo(db) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(934222)");
    if ((await tx.query("SELECT id FROM users WHERE id='admin'")).rows.length)
      return;
    await tx.query(
      "INSERT INTO departments VALUES ('cardiology','Cardiology'),('general','General Medicine'),('neurology','Neurology')",
    );
    for (const [id, role, name, department] of demoUsers) {
      await tx.query("INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6)", [
        id,
        id + "@medicore.test",
        name,
        hashPassword("MediCoreDemo!"),
        role,
        department,
      ]);
    }
    const names = [
      "Olivia Bennett",
      "Ethan Morgan",
      "Mia Thompson",
      "Noah Williams",
      "Amelia Davis",
      "Lucas Wilson",
      "Sophia Martin",
      "James Taylor",
    ];
    for (const [index, name] of names.entries()) {
      const id = "p" + (index + 1);
      await tx.query(
        "INSERT INTO patients(id,user_id,name,birth_date) VALUES ($1,$2,$3,$4)",
        [
          id,
          ["patient", "patient2"][index] ?? null,
          name,
          1982 + index * 3 + "-04-15",
        ],
      );
      await tx.query(
        "INSERT INTO consents(patient_id,clinical,exchange) VALUES ($1,true,$2)",
        [id, index !== 1],
      );
    }
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    for (const [index, provider] of [
      "doctor",
      "doctor2",
      "doctor",
      "doctor3",
      "doctor2",
      "doctor3",
      "doctor",
      "doctor2",
    ].entries()) {
      const hours = [
        "09:00",
        "09:30",
        "10:00",
        "10:30",
        "11:00",
        "11:30",
        "13:00",
        "14:00",
      ];
      const start = new Date(today + "T" + hours[index] + ":00+05:30");
      await tx.query(
        "INSERT INTO appointments(id,patient_id,provider_id,starts_at,ends_at,reason,status,checked_in_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          "a" + (index + 1),
          "p" + (index + 1),
          provider,
          start,
          new Date(+start + 1800000),
          [
            "Follow-up",
            "New consultation",
            "Routine checkup",
            "Follow-up",
            "New consultation",
            "Review visit",
            "Routine checkup",
            "Follow-up",
          ][index],
          [
            "completed",
            "checked_in",
            "scheduled",
            "scheduled",
            "cancelled",
            "scheduled",
            "scheduled",
            "scheduled",
          ][index],
          index < 2 ? new Date(+start - 300000) : null,
        ],
      );
    }
    for (const provider of ["doctor", "doctor2", "doctor3"]) {
      for (let day = 0; day < 14; day++) {
        const start = new Date(
          +new Date(today + "T08:00:00+05:30") + day * 86400000,
        );
        await tx.query("INSERT INTO schedules VALUES ($1,$2,$3,$4)", [
          "s-" + provider + "-" + day,
          provider,
          start,
          new Date(+start + 10 * 3600000),
        ]);
      }
    }
    await tx.query(
      "INSERT INTO encounters(id,appointment_id,status,notes) VALUES ('e1','a1','closed','Synthetic follow-up recorded.'),('e2','a2','open','')",
    );
    await tx.query(
      "INSERT INTO labs(id,encounter_id,test,status) VALUES ('l1','e1','Hemoglobin','resulted'),('l2','e2','Glucose','ordered')",
    );
    await tx.query("INSERT INTO results VALUES ('l1',13.4,'g/dL',12,16,now())");
    await tx.query(
      "INSERT INTO invoices(id,appointment_id,description,amount_cents,status) VALUES ('i1','a1','Follow-up consultation',12500,'paid'),('i2','a2','Initial consultation',17500,'unpaid')",
    );
    await tx.query(
      "INSERT INTO audit(actor_id,action,target,outcome,request_id) VALUES ('admin','demo.seed','workspace','allowed','seed')",
    );
  });
}
