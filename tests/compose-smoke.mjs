import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.COMPOSE_TEST_URL ?? "http://127.0.0.1:3080";
async function login(email) {
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "MediCoreDemo!" }),
  });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie()[0].split(";")[0];
}

const staffCookie = await login("reception@medicore.test");
const headers = { Cookie: staffCookie, "Content-Type": "application/json" };
const day = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Kolkata",
});
const booking = {
  patientId: "p1",
  providerId: "doctor",
  reason: "Container smoke test",
  start: day + "T15:00:00+05:30",
  end: day + "T15:30:00+05:30",
};
const reserve = () =>
  fetch(base + "/api/appointments", {
    method: "POST",
    headers,
    body: JSON.stringify(booking),
  });
const concurrent = await Promise.all([reserve(), reserve()]);
assert.deepEqual(
  concurrent.map((response) => response.status).sort(),
  [201, 409],
);
const id = (await concurrent.find((response) => response.status === 201).json())
  .data.id;

const adminCookie = await login("admin@medicore.test");
const adminHeaders = { Cookie: adminCookie };
let notification;
for (let attempt = 0; attempt < 15; attempt++) {
  const response = await fetch(base + "/api/notifications", {
    headers: adminHeaders,
  });
  assert.equal(response.status, 200);
  notification = (await response.json()).data.find(
    (row) => row.appointment_id === id && row.event === "booked",
  );
  if (notification?.status === "delivered") break;
  await delay(1500);
}
assert.equal(notification?.status, "delivered");
const report = await fetch(base + "/api/reports", { headers: adminHeaders });
assert.equal(report.status, 200);
assert.ok((await report.json()).data.appointmentCount >= 9);
console.log(
  "Compose smoke passed: REST, PostgreSQL booking, Redis/BullMQ delivery and FastAPI.",
);
