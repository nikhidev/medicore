import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase } from "../api/db.mjs";
import { createApp, deliverNotifications } from "../api/app.mjs";

let db, app;
beforeAll(async () => {
  db = await openDatabase({ url: process.env.TEST_DATABASE_URL, seed: true });
  app = createApp(db);
}, 20000);
afterAll(async () => {
  await db?.close();
});
async function as(user) {
  const agent = request.agent(app);
  await agent
    .post("/v1/login")
    .send({ email: user + "@medicore.test", password: "MediCoreDemo!" })
    .expect(200);
  return agent;
}
describe("MediCore workflows", () => {
  it("checks readiness and rejects missing sessions, incorrect passwords and invalid origins", async () => {
    await request(app).get("/ready").expect(200);
    await request(app).get("/v1/appointments").expect(401);
    await request(app)
      .post("/v1/login")
      .send({ email: "admin@medicore.test", password: "incorrect" })
      .expect(401);
    await request(app)
      .post("/v1/login")
      .set("Origin", "https://untrusted.test")
      .send({})
      .expect(403);
  });
  it("paginates the schedule and restricts patient and clinical access", async () => {
    const admin = await as("admin");
    const schedule = await admin.get("/v1/appointments").expect(200);
    expect(schedule.body.data.rows).toHaveLength(8);
    expect(
      schedule.body.data.counts.find((x) => x.status === "completed").count,
    ).toBe(1);
    await admin.get("/v1/encounters/e1").expect(403);
    const patient = await as("patient");
    await patient.get("/v1/encounters/e1").expect(200);
    await patient.get("/v1/encounters/e2").expect(404);
    const filtered = await patient.get("/v1/appointments?q=Ethan").expect(200);
    expect(filtered.body.data.rows).toEqual([]);
  });
  it("uses transaction locks to prevent overlapping reservations and deduplicates delivery", async () => {
    const agent = await as("reception");
    const schedule = (
      await db.query("SELECT starts_at FROM schedules WHERE id='s-doctor-1'")
    ).rows[0];
    const start = new Date(+new Date(schedule.starts_at) + 3600000);
    const booking = {
      patientId: "p1",
      providerId: "doctor",
      start: start.toISOString(),
      end: new Date(+start + 1800000).toISOString(),
      reason: "Synthetic review",
    };
    const responses = await Promise.all([
      agent.post("/v1/appointments").send(booking),
      agent.post("/v1/appointments").send({ ...booking, patientId: "p2" }),
    ]);
    expect(responses.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await deliverNotifications(db)).toBe(1);
    expect(await deliverNotifications(db)).toBe(0);
    expect(
      (await db.query("SELECT * FROM notification_deliveries")).rows,
    ).toHaveLength(2);
    await agent
      .post("/v1/appointments")
      .send({ ...booking, start: "invalid" })
      .expect(422);
  });
  it("enforces lab transitions and attaches results to the selected order", async () => {
    const technician = await as("lab");
    const result = { value: 91, unit: "mg/dL", low: 80, high: 100 };
    await technician.post("/v1/labs/l2/result").send(result).expect(409);
    await technician
      .patch("/v1/labs/l2")
      .send({ status: "collected" })
      .expect(200);
    await technician
      .post("/v1/labs/l2/result")
      .send({ ...result, unit: "g/dL" })
      .expect(422);
    await technician.post("/v1/labs/l2/result").send(result).expect(201);
    await technician.post("/v1/labs/l2/result").send(result).expect(409);
    expect(
      (await db.query("SELECT lab_id FROM results WHERE lab_id='l2'")).rows,
    ).toHaveLength(1);
  });
  it("applies consent changes immediately and captures reads and denials", async () => {
    const patient = await as("patient");
    const doctor = await as("doctor");
    await doctor.get("/v1/fhir/Observation/l1").expect(200);
    await patient
      .put("/v1/patients/p2/consent")
      .send({ clinical: false, exchange: false })
      .expect(404);
    await patient
      .put("/v1/patients/p1/consent")
      .send({ clinical: false, exchange: false })
      .expect(200);
    await doctor.get("/v1/encounters/e1").expect(404);
    await doctor.get("/v1/fhir/Observation/l1").expect(404);
    await patient.get("/v1/encounters/e1").expect(200);
    const entries = (await (await as("admin")).get("/v1/audit").expect(200))
      .body.data;
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "consent.update" }),
        expect.objectContaining({ outcome: "denied" }),
      ]),
    );
  });
  it("lets authorized staff complete an encounter while protecting draft prescriptions", async () => {
    const reception = await as("reception");
    await reception
      .patch("/v1/appointments/a3")
      .send({ status: "checked_in" })
      .expect(200);
    const doctor = await as("doctor");
    const visit = (
      await doctor
        .post("/v1/encounters")
        .send({ appointmentId: "a3", notes: "Synthetic note" })
        .expect(201)
    ).body.data;
    await doctor
      .post("/v1/encounters/" + visit.id + "/prescriptions")
      .send({ medication: "", dose: "Demo dose", instructions: "Demo" })
      .expect(422);
    const draft = (
      await doctor
        .post("/v1/encounters/" + visit.id + "/prescriptions")
        .send({
          medication: "Training sample",
          dose: "Demo dose",
          instructions: "Demo",
        })
        .expect(201)
    ).body.data;
    const close = { status: "closed", notes: "Synthetic note" };
    await doctor
      .patch("/v1/encounters/" + visit.id)
      .send(close)
      .expect(409);
    await doctor
      .patch("/v1/prescriptions/" + draft.id)
      .send({ status: "issued" })
      .expect(200);
    await doctor
      .patch("/v1/encounters/" + visit.id)
      .send(close)
      .expect(200);
    expect(
      (await db.query("SELECT status FROM appointments WHERE id='a3'")).rows[0]
        .status,
    ).toBe("completed");
  });
  it("restricts staff provisioning and omits hashes in responses", async () => {
    const receptionist = await as("reception");
    await receptionist
      .post("/v1/departments")
      .send({ name: "Synthetic care" })
      .expect(403);
    const admin = await as("admin");
    const department = (
      await admin
        .post("/v1/departments")
        .send({ name: "Synthetic care" })
        .expect(201)
    ).body.data;
    const staff = {
      name: "Synthetic Nurse",
      email: "new-nurse@medicore.test",
      password: "synthetic-only-demo",
      role: "nurse",
      departmentId: department.id,
    };
    const created = await admin.post("/v1/staff").send(staff).expect(201);
    expect(created.body.data).not.toHaveProperty("password");
    await admin.post("/v1/staff").send(staff).expect(409);
    await request(app)
      .post("/v1/login")
      .send({ email: staff.email, password: staff.password })
      .expect(200);
  });
  it("reports a database outage through readiness", async () => {
    const broken = createApp({
      query: async () => {
        throw Object.assign(new Error("internal connection information"), {
          code: "ECONNREFUSED",
        });
      },
    });
    const result = await request(broken).get("/ready").expect(503);
    expect(result.body.error.message).toBe(
      "A required service is unavailable.",
    );
    expect(result.body.error.requestId).toBe(result.headers["x-request-id"]);
    await request(broken).get("/health").expect(200);
  });
  it("refreshes and revokes the session", async () => {
    const login = await request(app)
      .post("/v1/login")
      .send({ email: "patient@medicore.test", password: "MediCoreDemo!" });
    const old = login.headers["set-cookie"][0].split(";")[0];
    const refreshed = await request(app)
      .post("/v1/refresh")
      .set("Cookie", old)
      .expect(200);
    const next = refreshed.headers["set-cookie"][0].split(";")[0];
    await request(app).get("/v1/me").set("Cookie", old).expect(401);
    await request(app).post("/v1/logout").set("Cookie", next).expect(200);
    await request(app).get("/v1/me").set("Cookie", next).expect(401);
  });
});
