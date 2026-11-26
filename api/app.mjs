import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import {
  authRoutes,
  audit,
  roles,
  fail,
  id,
  identifier,
  label,
  one,
  read,
} from "./security.mjs";
import {
  registerScheduling,
  appointment,
  appointmentScope,
  joins,
  offset,
} from "./scheduling.mjs";

export function createApp(
  db,
  {
    secure = false,
    logging = false,
    origins = ["http://localhost:3000", "http://127.0.0.1:3000"],
    analyticsUrl,
    analyticsKey,
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet(), express.json({ limit: "32kb" }), cookieParser());
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set({ "X-Request-ID": req.requestId, "Cache-Control": "no-store" });
    if (logging)
      res.on("finish", () =>
        console.log(
          JSON.stringify({
            requestId: req.requestId,
            method: req.method,
            status: res.statusCode,
          }),
        ),
      );
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") && !origins.includes(req.get("origin"))))
    )
      return next(fail(403, "Request origin is not allowed."));
    next();
  });
  app.get("/health", (_, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ready" });
  });
  app.get("/v1/openapi.json", (_, res) =>
    res.sendFile(
      fileURLToPath(new URL("../docs/openapi.json", import.meta.url)),
    ),
  );
  const api = express.Router();
  api.use(
    "/login",
    rateLimit({
      windowMs: 60000,
      limit: 30,
      handler: (_, __, next) =>
        next(fail(429, "Try signing in again in a minute.")),
    }),
  );
  api.use(authRoutes(db, secure));
  registerScheduling(api, db);

  const clinical = ["doctor", "nurse", "patient"];
  const text = z.string().trim().max(4000);
  const labUnits = {
    Hemoglobin: "g/dL",
    Glucose: "mg/dL",
    Creatinine: "mg/dL",
  };
  const encounter = async (tx, req, key, open = false) => {
    const row = await one(
      tx,
      "SELECT * FROM encounters WHERE id=$1 FOR UPDATE",
      [key],
    );
    if (!row) throw fail(404, "Encounter unavailable.");
    await appointment(tx, req, row.appointment_id, true);
    if (open && row.status !== "open") throw fail(409, "Encounter is closed.");
    return row;
  };
  const insert = (path, role, schema, action, work) => {
    api.post(path, async (req, res) => {
      roles(req, ...role);
      const input = schema.parse(req.body);
      const data = await db.transaction(async (tx) => {
        const row = await work(tx, req, input);
        await audit(tx, req, action, row.id ?? row.lab_id);
        return row;
      });
      res.status(201).json({ data });
    });
  };
  const collection = (path, allowed, sql, action, clinicalScope = false) => {
    api.get(path, async (req, res) => {
      roles(req, ...allowed);
      const scope = appointmentScope(req.user, clinicalScope);
      const data = await db.transaction(async (tx) => {
        const rows = await read(
          tx,
          sql(req) +
            " WHERE " +
            scope.sql +
            " ORDER BY 1 LIMIT 25 OFFSET $" +
            (scope.params.length + 1),
          [...scope.params, offset(req)],
        );
        for (const row of rows) await audit(tx, req, action, row.id);
        return rows;
      });
      res.json({ data });
    });
  };
  collection(
    "/encounters",
    clinical,
    (req) =>
      "SELECT e.id,e.appointment_id,e.notes,e.status,p.name AS patient FROM encounters e JOIN appointments a ON a.id=e.appointment_id " +
      joins +
      (req.user.role === "patient" ? " AND e.status='closed'" : ""),
    "encounter.read",
    true,
  );
  api.get("/encounters/:id", async (req, res) => {
    roles(req, ...clinical);
    const key = identifier.parse(req.params.id);
    const data = await db.transaction(async (tx) => {
      const row = await encounter(tx, req, key);
      const patient = req.user.role === "patient";
      if (patient && row.status !== "closed")
        throw fail(404, "Encounter unavailable.");
      await audit(tx, req, "encounter.read", key);
      return {
        ...row,
        diagnoses: await read(
          tx,
          "SELECT * FROM diagnoses WHERE encounter_id=$1",
          [key],
        ),
        prescriptions: await read(
          tx,
          "SELECT * FROM prescriptions WHERE encounter_id=$1 AND ($2 OR status='issued')",
          [key, !patient],
        ),
        labs: await read(
          tx,
          "SELECT l.*,r.value,r.unit FROM labs l LEFT JOIN results r ON r.lab_id=l.id WHERE encounter_id=$1 AND ($2 OR l.status='resulted')",
          [key, !patient],
        ),
      };
    });
    res.json({ data });
  });
  insert(
    "/encounters",
    ["doctor"],
    z.object({ appointmentId: identifier, notes: text }),
    "encounter.open",
    async (tx, req, input) => {
      const row = await appointment(tx, req, input.appointmentId, true);
      if (row.status !== "checked_in")
        throw fail(409, "Check the patient in first.");
      const created = await one(
        tx,
        "INSERT INTO encounters(id,appointment_id,notes) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *",
        [id(), input.appointmentId, input.notes],
      );
      if (!created)
        throw fail(409, "This appointment already has an encounter.");
      return created;
    },
  );
  api.patch("/encounters/:id", async (req, res) => {
    roles(req, "doctor");
    const key = identifier.parse(req.params.id);
    const { notes, status } = z
      .object({ notes: text, status: z.enum(["open", "closed"]) })
      .parse(req.body);
    const data = await db.transaction(async (tx) => {
      const row = await encounter(tx, req, key, true);
      if (status === "closed") {
        if (
          await one(
            tx,
            "SELECT id FROM prescriptions WHERE encounter_id=$1 AND status='draft'",
            [key],
          )
        )
          throw fail(409, "Resolve draft prescriptions before closing.");
        await tx.query(
          "UPDATE appointments SET status='completed' WHERE id=$1",
          [row.appointment_id],
        );
      }
      await audit(tx, req, "encounter." + status, key);
      return one(
        tx,
        "UPDATE encounters SET status=$2,notes=$3 WHERE id=$1 RETURNING *",
        [key, status, notes],
      );
    });
    res.json({ data });
  });
  const childResources = {
    diagnoses: {
      fields: { code: label, description: label },
      sql: "INSERT INTO diagnoses(id,encounter_id,code,description) VALUES ($1,$2,$3,$4) RETURNING *",
    },
    prescriptions: {
      fields: { medication: label, dose: label, instructions: label },
      sql: "INSERT INTO prescriptions(id,encounter_id,medication,dose,instructions) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    },
    labs: {
      fields: { test: z.enum(["Hemoglobin", "Glucose", "Creatinine"]) },
      sql: "INSERT INTO labs(id,encounter_id,test) VALUES ($1,$2,$3) RETURNING *",
    },
  };
  for (const [kind, { fields, sql }] of Object.entries(childResources)) {
    insert(
      "/encounters/:id/" + kind,
      ["doctor"],
      z.object(fields),
      kind + ".create",
      async (tx, req, input) => {
        const key = identifier.parse(req.params.id);
        await encounter(tx, req, key, true);
        return one(tx, sql, [
          id(),
          key,
          ...Object.keys(fields).map((field) => input[field]),
        ]);
      },
    );
  }
  api.patch("/prescriptions/:id", async (req, res) => {
    roles(req, "doctor");
    const key = identifier.parse(req.params.id);
    const status = z.enum(["issued", "cancelled"]).parse(req.body?.status);
    const data = await db.transaction(async (tx) => {
      const row = await one(
        tx,
        "SELECT encounter_id FROM prescriptions WHERE id=$1",
        [key],
      );
      if (!row) throw fail(404, "Prescription unavailable.");
      await encounter(tx, req, row.encounter_id, true);
      const updated = await one(
        tx,
        "UPDATE prescriptions SET status=$2 WHERE id=$1 AND status='draft' RETURNING *",
        [key, status],
      );
      if (!updated) throw fail(409, "Only drafts can make this transition.");
      await audit(tx, req, "prescription." + status, key);
      return updated;
    });
    res.json({ data });
  });
  collection(
    "/labs",
    [...clinical, "lab"],
    (req) =>
      "SELECT l.id,l.test,l.status,p.name AS patient,r.value,r.unit FROM labs l JOIN encounters e ON e.id=l.encounter_id JOIN appointments a ON a.id=e.appointment_id " +
      joins +
      " LEFT JOIN results r ON r.lab_id=l.id " +
      (req.user.role === "patient"
        ? " JOIN labs published ON published.id=l.id AND l.status='resulted' AND e.status='closed'"
        : ""),
    "lab.read",
    true,
  );
  const loadLab = async (tx, req) => {
    const key = identifier.parse(req.params.id);
    const row = await one(
      tx,
      "SELECT l.*,e.appointment_id FROM labs l JOIN encounters e ON e.id=l.encounter_id WHERE l.id=$1 FOR UPDATE OF l",
      [key],
    );
    if (!row) throw fail(404, "Lab order unavailable.");
    await appointment(tx, req, row.appointment_id, true);
    return row;
  };
  api.patch("/labs/:id", async (req, res) => {
    roles(req, "lab", "nurse");
    z.object({ status: z.literal("collected") }).parse(req.body);
    const data = await db.transaction(async (tx) => {
      const row = await loadLab(tx, req);
      if (row.status !== "ordered")
        throw fail(409, "This sample cannot be collected.");
      await audit(tx, req, "lab.collect", row.id);
      return one(
        tx,
        "UPDATE labs SET status='collected' WHERE id=$1 RETURNING *",
        [row.id],
      );
    });
    res.json({ data });
  });
  const measurement = z.number().finite().nonnegative();
  insert(
    "/labs/:id/result",
    ["lab"],
    z
      .object({
        value: measurement,
        unit: label,
        low: measurement,
        high: measurement,
      })
      .refine((x) => x.high >= x.low, "Invalid reference range."),
    "lab.result",
    async (tx, req, input) => {
      const row = await loadLab(tx, req);
      if (row.status !== "collected")
        throw fail(409, "Collect the sample first.");
      if (input.unit !== labUnits[row.test])
        throw fail(422, "Unit does not match the test.");
      const result = await one(
        tx,
        "INSERT INTO results(lab_id,value,unit,reference_low,reference_high) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [row.id, input.value, input.unit, input.low, input.high],
      );
      await tx.query("UPDATE labs SET status='resulted' WHERE id=$1", [row.id]);
      return result;
    },
  );
  collection(
    "/invoices",
    ["admin", "billing", "patient"],
    () =>
      "SELECT i.*,p.name AS patient FROM invoices i JOIN appointments a ON a.id=i.appointment_id " +
      joins,
    "invoice.read",
  );
  insert(
    "/invoices",
    ["billing"],
    z.object({
      appointmentId: identifier,
      description: label,
      cents: z.number().int().positive().max(100000000),
    }),
    "invoice.create",
    async (tx, req, input) => {
      await appointment(tx, req, input.appointmentId);
      const row = await one(
        tx,
        "INSERT INTO invoices(id,appointment_id,description,amount_cents) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *",
        [id(), input.appointmentId, input.description, input.cents],
      );
      if (!row)
        throw fail(409, "An invoice already exists for this appointment.");
      return row;
    },
  );
  api.patch("/invoices/:id", async (req, res) => {
    roles(req, "billing");
    const key = identifier.parse(req.params.id);
    const status = z.enum(["paid", "void"]).parse(req.body?.status);
    const data = await db.transaction(async (tx) => {
      const row = await one(
        tx,
        "UPDATE invoices SET status=$2 WHERE id=$1 AND status='unpaid' RETURNING *",
        [key, status],
      );
      if (!row) throw fail(409, "An unpaid invoice is required.");
      await audit(tx, req, "invoice." + status, key);
      return row;
    });
    res.json({ data });
  });
  api.get("/audit", async (req, res) => {
    roles(req, "admin");
    res.json({
      data: await read(
        db,
        "SELECT a.id::text,a.action,a.target,a.outcome,a.request_id,a.created_at,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 25 OFFSET $1",
        [offset(req)],
      ),
    });
  });
  api.get("/notifications", async (req, res) => {
    roles(req, "admin");
    res.json({
      data: await read(
        db,
        "SELECT id,appointment_id,event,status,created_at FROM outbox ORDER BY created_at DESC LIMIT 25 OFFSET $1",
        [offset(req)],
      ),
    });
  });
  api.get("/reports", async (req, res) => {
    roles(req, "admin");
    if (!analyticsUrl)
      throw fail(503, "Start the FastAPI service to generate reports.");
    const appointments = await read(
      db,
      "SELECT status,CASE WHEN checked_in_at IS NOT NULL THEN greatest(0,extract(epoch FROM checked_in_at-starts_at)/60)::float8 END AS wait FROM appointments LIMIT 10000",
    );
    const labs = await read(
      db,
      "SELECT l.test,r.value::float8,r.unit,r.reference_low::float8 AS low,r.reference_high::float8 AS high,greatest(0,extract(epoch FROM r.created_at-l.created_at)/60)::float8 AS turnaround FROM labs l JOIN results r ON r.lab_id=l.id LIMIT 10000",
    );
    const population = await read(
      db,
      "SELECT CASE WHEN age(birth_date)<interval '18 years' THEN '0–17' WHEN age(birth_date)<interval '65 years' THEN '18–64' ELSE '65+' END AS band,count(*)::int AS count FROM patients GROUP BY 1",
    );
    const windowTotals = await one(
      db,
      `SELECT
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM LEAST(ends_at,now())-GREATEST(starts_at,now()-interval '30 days')))
        FROM schedules WHERE starts_at<now() AND ends_at>now()-interval '30 days'),0)::float8 AS available,
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM LEAST(ends_at,now())-GREATEST(starts_at,now()-interval '30 days')))
        FROM appointments WHERE status<>'cancelled' AND starts_at<now() AND ends_at>now()-interval '30 days'),0)::float8 AS booked`,
    );
    const response = await fetch(new URL("/report", analyticsUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": analyticsKey,
      },
      body: JSON.stringify({ appointments, labs, population, ...windowTotals }),
      signal: AbortSignal.timeout(3500),
    }).catch(() => null);
    if (!response?.ok) throw fail(503, "Analytics service is unavailable.");
    await audit(db, req, "report.generate", "operations");
    res.json({ data: await response.json() });
  });
  api.get("/fhir/:kind/:id", async (req, res) => {
    roles(req, "doctor", "patient");
    const kind = z
      .enum(["Patient", "Appointment", "Encounter", "Observation"])
      .parse(req.params.kind);
    const key = identifier.parse(req.params.id);
    const scopes = appointmentScope(req.user, true);
    const columns = {
      Patient: "p.id",
      Appointment: "a.id",
      Encounter: "e.id",
      Observation: "l.id",
    };
    const allowed =
      req.user.role === "patient" && ["Encounter", "Observation"].includes(kind)
        ? " AND e.status='closed'"
        : "";
    const data = await db.transaction(async (tx) => {
      const row = await one(
        tx,
        "SELECT a.*,p.name,p.birth_date,e.status AS encounter_status,e.created_at AS encounter_date,l.test,r.value,r.unit,r.created_at AS result_date FROM appointments a " +
          joins +
          " LEFT JOIN encounters e ON e.appointment_id=a.id LEFT JOIN labs l ON l.encounter_id=e.id LEFT JOIN results r ON r.lab_id=l.id WHERE " +
          scopes.sql +
          " AND c.exchange AND " +
          columns[kind] +
          "=$" +
          (scopes.params.length + 1) +
          allowed +
          (kind === "Observation" ? " AND r.lab_id IS NOT NULL" : "") +
          " LIMIT 1",
        [...scopes.params, key],
      );
      if (!row)
        throw fail(
          404,
          "Resource unavailable or exchange consent is restricted.",
        );
      const subject = { reference: "Patient/" + row.patient_id };
      const map = {
        Patient: () => ({
          name: [{ text: row.name }],
          birthDate: new Date(row.birth_date).toISOString().slice(0, 10),
        }),
        Appointment: () => ({
          status: {
            scheduled: "booked",
            checked_in: "checked-in",
            completed: "fulfilled",
            cancelled: "cancelled",
          }[row.status],
          start: row.starts_at,
          end: row.ends_at,
          participant: [
            { actor: subject, status: "accepted" },
            {
              actor: { reference: "Practitioner/" + row.provider_id },
              status: "accepted",
            },
          ],
        }),
        Encounter: () => ({
          status: row.encounter_status === "open" ? "in-progress" : "finished",
          class: {
            system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            code: "AMB",
          },
          subject,
          appointment: [{ reference: "Appointment/" + row.id }],
        }),
        Observation: () => ({
          status: "final",
          code: { text: row.test },
          subject,
          effectiveDateTime: row.result_date,
          valueQuantity: { value: Number(row.value), unit: row.unit },
        }),
      };
      await audit(tx, req, "fhir.export", kind + "/" + key);
      return { resourceType: kind, id: key, ...map[kind]() };
    });
    res.type("application/fhir+json").json(data);
  });
  app.use("/v1", api);
  app.use((_, __, next) => next(fail(404, "Endpoint not found.")));
  app.use(async (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error instanceof ZodError
        ? 422
        : (error.status ??
          (["ECONNREFUSED", "57P01", "08006"].includes(error.code)
            ? 503
            : 500));
    if ([401, 403, 404, 409].includes(status))
      await audit(
        db,
        req,
        req.method + " " + (req.route?.path ?? "/v1"),
        "request",
        "denied",
      ).catch(() => {});
    if (status >= 500 && logging)
      console.error(
        JSON.stringify({
          requestId: req.requestId,
          code: error.code ?? error.name,
          status,
        }),
      );
    const message =
      error instanceof ZodError
        ? error.issues
            .map((issue) => [...issue.path, issue.message].join(" "))
            .join(". ")
        : status === 500
          ? "Unexpected server error."
          : error.type === "entity.parse.failed"
            ? "Invalid JSON body."
            : status === 503 && !error.status
              ? "A required service is unavailable."
              : error.message;
    res.status(status).json({ error: { message, requestId: req.requestId } });
  });
  return app;
}

export async function deliverNotifications(db) {
  return db.transaction(async (tx) => {
    const jobs = await read(
      tx,
      "SELECT id FROM outbox WHERE status='pending' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED",
    );
    for (const { id } of jobs) {
      await tx.query(
        "INSERT INTO notification_deliveries(job_id,channel) VALUES($1,'email'),($1,'sms') ON CONFLICT DO NOTHING",
        [id],
      );
      await tx.query("UPDATE outbox SET status='delivered' WHERE id=$1", [id]);
    }
    return jobs.length;
  });
}
