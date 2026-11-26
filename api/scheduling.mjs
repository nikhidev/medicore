import { hashPassword } from "./db.mjs";
import { z } from "zod";
import {
  audit,
  dateTime,
  fail,
  id,
  identifier,
  label,
  one,
  read,
  roles,
} from "./security.mjs";

export const joins =
  "JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.provider_id JOIN consents c ON c.patient_id=p.id";
export function appointmentScope(user, clinical = false) {
  const own = {
    patient: "p.user_id=$1",
    doctor: "a.provider_id=$1",
    nurse: "u.department_id=(SELECT department_id FROM users WHERE id=$1)",
  }[user.role];
  const filter = own ?? "TRUE";
  return {
    sql:
      "(" +
      filter +
      ")" +
      (clinical && user.role !== "patient" ? " AND c.clinical" : ""),
    params: own ? [user.id] : [],
  };
}

export async function appointment(db, req, appointmentId, clinical = false) {
  const scope = appointmentScope(req.user, clinical);
  const row = await one(
    db,
    "SELECT a.* FROM appointments a " +
      joins +
      " WHERE " +
      scope.sql +
      " AND a.id=$" +
      (scope.params.length + 1),
    [...scope.params, appointmentId],
  );
  if (!row) throw fail(404, "Record not found or access is restricted.");
  return row;
}

const booking = z.object({
  patientId: identifier,
  providerId: identifier,
  start: dateTime,
  end: dateTime,
  reason: label,
});
const window = z.object({ start: dateTime, end: dateTime });
const page = z.coerce.number().int().min(1).max(100000).default(1);
export const offset = (req) => (page.parse(req.query.page) - 1) * 25;

export function registerScheduling(router, db) {
  router.get("/directory", async (req, res) => {
    const [providers, departments] = await Promise.all([
      read(
        db,
        "SELECT u.id,u.name,d.name AS department FROM users u JOIN departments d ON d.id=u.department_id WHERE role='doctor' ORDER BY u.name",
      ),
      read(db, "SELECT * FROM departments ORDER BY name"),
    ]);
    res.json({ data: { providers, departments } });
  });
  router.get("/departments", async (req, res) => {
    roles(req, "admin");
    res.json({
      data: await read(
        db,
        "SELECT id,name FROM departments ORDER BY name LIMIT 25 OFFSET $1",
        [offset(req)],
      ),
    });
  });
  router.post("/departments", async (req, res) => {
    roles(req, "admin");
    const { name } = z.object({ name: label }).parse(req.body);
    const data = await db.transaction(async (tx) => {
      const row = await one(
        tx,
        "INSERT INTO departments(id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *",
        [id(), name],
      );
      if (!row) throw fail(409, "A department with that name already exists.");
      await audit(tx, req, "department.create", row.id);
      return row;
    });
    res.status(201).json({ data });
  });
  router.post("/staff", async (req, res) => {
    roles(req, "admin");
    const input = z
      .object({
        name: label,
        email: z.email().max(160),
        password: z.string().min(14).max(128),
        role: z.enum(["receptionist", "doctor", "nurse", "lab", "billing"]),
        departmentId: identifier,
      })
      .parse(req.body);
    const password = hashPassword(input.password);
    const data = await db.transaction(async (tx) => {
      if (
        !(await one(tx, "SELECT id FROM departments WHERE id=$1", [
          input.departmentId,
        ]))
      )
        throw fail(404, "Department unavailable.");
      const row = await one(
        tx,
        "INSERT INTO users(id,email,name,password,role,department_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id,email,name,role,department_id",
        [
          id(),
          input.email.toLowerCase(),
          input.name,
          password,
          input.role,
          input.departmentId,
        ],
      );
      if (!row) throw fail(409, "A user with that email already exists.");
      await audit(tx, req, "staff.create", row.id);
      return row;
    });
    res.status(201).json({ data });
  });
  router.get("/staff", async (req, res) => {
    roles(req, "admin");
    res.json({
      data: await read(
        db,
        "SELECT id,name,email,role,department_id FROM users ORDER BY name LIMIT 25 OFFSET $1",
        [offset(req)],
      ),
    });
  });
  router.get("/schedules", async (req, res) => {
    res.json({
      data: await read(
        db,
        "SELECT s.*,u.name AS provider FROM schedules s JOIN users u ON u.id=s.provider_id WHERE ends_at>now() ORDER BY starts_at,provider_id LIMIT 25 OFFSET $1",
        [offset(req)],
      ),
    });
  });
  router.post("/schedules/:id", async (req, res) => {
    roles(req, "admin", "doctor");
    const provider = identifier.parse(req.params.id);
    if (req.user.role === "doctor" && req.user.id !== provider)
      throw fail(404, "Provider not found.");
    const { start, end } = window.parse(req.body);
    if (+new Date(end) <= +new Date(start))
      throw fail(422, "End must be after start.");
    const row = await db.transaction(async (tx) => {
      if (
        !(await one(
          tx,
          "SELECT id FROM users WHERE id=$1 AND role='doctor' FOR UPDATE",
          [provider],
        ))
      )
        throw fail(404, "Provider not found.");
      if (
        await one(
          tx,
          "SELECT id FROM schedules WHERE provider_id=$1 AND starts_at<$3 AND ends_at>$2",
          [provider, start, end],
        )
      )
        throw fail(409, "Availability already overlaps this window.");
      const record = await one(
        tx,
        "INSERT INTO schedules VALUES ($1,$2,$3,$4) RETURNING *",
        [id(), provider, start, end],
      );
      await audit(tx, req, "schedule.create", record.id);
      return record;
    });
    res.status(201).json({ data: row });
  });
  router.get("/patients", async (req, res) => {
    roles(req, "patient", "receptionist", "admin", "doctor", "nurse");
    const scope = appointmentScope(req.user, true);
    const where =
      {
        patient: "WHERE p.user_id=$1",
        doctor:
          "WHERE EXISTS (SELECT 1 FROM appointments a JOIN users u ON u.id=a.provider_id WHERE a.patient_id=p.id AND " +
          scope.sql +
          ")",
        nurse:
          "WHERE EXISTS (SELECT 1 FROM appointments a JOIN users u ON u.id=a.provider_id WHERE a.patient_id=p.id AND " +
          scope.sql +
          ")",
      }[req.user.role] ?? "";
    const params = where ? [req.user.id] : [];
    const rows = await db.transaction(async (tx) => {
      const items = await read(
        tx,
        "SELECT p.id,p.name,p.birth_date,c.clinical,c.exchange FROM patients p JOIN consents c ON c.patient_id=p.id " +
          where +
          " ORDER BY p.name,p.id LIMIT 25 OFFSET $" +
          (params.length + 1),
        [...params, offset(req)],
      );
      for (const item of items) await audit(tx, req, "patient.read", item.id);
      return items;
    });
    res.json({ data: rows });
  });
  router.post("/patients", async (req, res) => {
    roles(req, "receptionist", "admin");
    const input = z
      .object({ name: label, birthDate: z.iso.date() })
      .parse(req.body);
    if (input.birthDate > new Date().toISOString().slice(0, 10))
      throw fail(422, "Birth date cannot be in the future.");
    const row = await db.transaction(async (tx) => {
      const patient = await one(
        tx,
        "INSERT INTO patients(id,name,birth_date) VALUES ($1,$2,$3) RETURNING id,name,birth_date",
        [id(), input.name, input.birthDate],
      );
      await tx.query("INSERT INTO consents(patient_id) VALUES ($1)", [
        patient.id,
      ]);
      await audit(tx, req, "patient.register", patient.id);
      return patient;
    });
    res.status(201).json({ data: row });
  });
  router.put("/patients/:id/consent", async (req, res) => {
    roles(req, "patient", "receptionist");
    const patientId = identifier.parse(req.params.id);
    const { clinical, exchange } = z
      .object({ clinical: z.boolean(), exchange: z.boolean() })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const patient = await one(
        tx,
        "SELECT user_id FROM patients WHERE id=$1",
        [patientId],
      );
      if (
        !patient ||
        (req.user.role === "patient" && patient.user_id !== req.user.id)
      )
        throw fail(404, "Patient not found.");
      const updated = await one(
        tx,
        "UPDATE consents SET clinical=$2,exchange=$3,updated_at=now() WHERE patient_id=$1 RETURNING *",
        [patientId, clinical, exchange],
      );
      await audit(tx, req, "consent.update", patientId);
      return updated;
    });
    res.json({ data: row });
  });
  router.get("/appointments", async (req, res) => {
    roles(
      req,
      "patient",
      "receptionist",
      "doctor",
      "nurse",
      "billing",
      "admin",
    );
    const scope = appointmentScope(req.user);
    const status = z
      .enum(["scheduled", "checked_in", "completed", "cancelled"])
      .optional()
      .parse(req.query.status);
    const search = z.string().trim().max(80).default("").parse(req.query.q);
    const day = z.iso.date().optional().parse(req.query.day);
    const data = await db.transaction(async (tx) => {
      const query =
        " FROM appointments a " +
        joins +
        " LEFT JOIN departments d ON d.id=u.department_id WHERE " +
        scope.sql;
      const n = scope.params.length;
      const counts = await read(
        tx,
        "SELECT status,count(*)::int AS count" +
          query +
          " AND ($" +
          (n + 1) +
          "::date IS NULL OR (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date=$" +
          (n + 1) +
          ") GROUP BY status",
        [...scope.params, day ?? null],
      );
      const filters =
        " AND ($" +
        (n + 1) +
        "::date IS NULL OR (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date=$" +
        (n + 1) +
        ")" +
        " AND ($" +
        (n + 2) +
        "::text IS NULL OR a.status=$" +
        (n + 2) +
        ")" +
        " AND (strpos(lower(p.name),lower($" +
        (n + 3) +
        "))>0 OR strpos(lower(u.name),lower($" +
        (n + 3) +
        "))>0)";
      const rows = await read(
        tx,
        "SELECT a.id,a.patient_id,a.provider_id,a.starts_at,a.ends_at,a.status,p.name AS patient,u.name AS provider," +
          "CASE WHEN c.clinical AND $" +
          (n + 4) +
          "::boolean THEN a.reason ELSE NULL END AS reason,d.name AS department" +
          query +
          filters +
          " ORDER BY a.starts_at,a.id LIMIT 26 OFFSET $" +
          (n + 5),
        [
          ...scope.params,
          day ?? null,
          status ?? null,
          search,
          ["patient", "doctor", "nurse"].includes(req.user.role),
          offset(req),
        ],
      );
      for (const item of rows.slice(0, 25))
        await audit(tx, req, "appointment.read", item.id);
      return { rows: rows.slice(0, 25), counts, hasMore: rows.length > 25 };
    });
    res.json({ data });
  });
  router.post("/appointments", async (req, res) => {
    roles(req, "patient", "receptionist", "admin");
    const { patientId, providerId, start, end, reason } = booking.parse(
      req.body,
    );
    const duration = +new Date(end) - +new Date(start);
    if (duration < 900000 || duration > 7200000)
      throw fail(
        422,
        "Appointment duration must be between 15 minutes and 2 hours.",
      );
    const row = await db.transaction(async (tx) => {
      if (
        !(await one(
          tx,
          "SELECT id FROM users WHERE id=$1 AND role='doctor' FOR UPDATE",
          [providerId],
        ))
      )
        throw fail(404, "Provider not found.");
      const patient = await one(
        tx,
        "SELECT user_id FROM patients WHERE id=$1 FOR UPDATE",
        [patientId],
      );
      if (
        !patient ||
        (req.user.role === "patient" && patient.user_id !== req.user.id)
      )
        throw fail(404, "Patient not found.");
      if (
        !(await one(
          tx,
          "SELECT id FROM schedules WHERE provider_id=$1 AND starts_at<=$2 AND ends_at>=$3",
          [providerId, start, end],
        ))
      )
        throw fail(409, "The provider is unavailable during that time.");
      if (
        await one(
          tx,
          "SELECT id FROM appointments WHERE (provider_id=$1 OR patient_id=$2) AND status<>'cancelled' AND starts_at<$4 AND ends_at>$3",
          [providerId, patientId, start, end],
        )
      )
        throw fail(409, "This time overlaps an existing appointment.");
      const item = await one(
        tx,
        "INSERT INTO appointments(id,patient_id,provider_id,starts_at,ends_at,reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [id(), patientId, providerId, start, end, reason],
      );
      await tx.query(
        "INSERT INTO outbox(id,appointment_id,event) VALUES ($1,$2,'booked')",
        [id(), item.id],
      );
      await audit(tx, req, "appointment.book", item.id);
      return item;
    });
    res.status(201).json({ data: row });
  });
  router.patch("/appointments/:id", async (req, res) => {
    const appointmentId = identifier.parse(req.params.id);
    const { status } = z
      .object({ status: z.enum(["cancelled", "checked_in"]) })
      .parse(req.body);
    if (status === "cancelled") roles(req, "patient", "receptionist", "admin");
    else roles(req, "receptionist", "nurse");
    const row = await db.transaction(async (tx) => {
      await appointment(tx, req, appointmentId);
      const updated = await one(
        tx,
        "UPDATE appointments SET status=$2,checked_in_at=CASE WHEN $2='checked_in' THEN now() ELSE NULL END WHERE id=$1 AND status='scheduled' RETURNING id,status",
        [appointmentId, status],
      );
      if (!updated)
        throw fail(
          409,
          "Only scheduled appointments can make this transition.",
        );
      if (status === "cancelled")
        await tx.query(
          "INSERT INTO outbox(id,appointment_id,event) VALUES ($1,$2,'cancelled')",
          [id(), appointmentId],
        );
      await audit(tx, req, "appointment." + status, appointmentId);
      return updated;
    });
    res.json({ data: row });
  });
  router.get("/waitlist", async (req, res) => {
    roles(req, "patient", "receptionist", "admin");
    const patient = req.user.role === "patient";
    const args = patient ? [req.user.id, offset(req)] : [offset(req)];
    res.json({
      data: await read(
        db,
        "SELECT w.id,p.name AS patient,u.name AS provider,w.created_at FROM waitlist w JOIN patients p ON p.id=w.patient_id JOIN users u ON u.id=w.provider_id " +
          (patient ? "WHERE p.user_id=$1 " : "") +
          "ORDER BY w.created_at LIMIT 25 OFFSET $" +
          args.length,
        args,
      ),
    });
  });
  router.post("/waitlist", async (req, res) => {
    roles(req, "patient", "receptionist", "admin");
    const { patientId, providerId, reason } = booking
      .pick({ patientId: true, providerId: true, reason: true })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const patient = await one(
        tx,
        "SELECT user_id FROM patients WHERE id=$1",
        [patientId],
      );
      if (
        !patient ||
        (req.user.role === "patient" && patient.user_id !== req.user.id)
      )
        throw fail(404, "Patient not found.");
      if (
        !(await one(tx, "SELECT id FROM users WHERE id=$1 AND role='doctor'", [
          providerId,
        ]))
      )
        throw fail(404, "Provider not found.");
      const item = await one(
        tx,
        "INSERT INTO waitlist VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING RETURNING id",
        [id(), patientId, providerId, reason],
      );
      if (!item)
        throw fail(409, "Patient is already on this provider’s waitlist.");
      await audit(tx, req, "waitlist.join", item.id);
      return item;
    });
    res.status(201).json({ data: row });
  });
}
