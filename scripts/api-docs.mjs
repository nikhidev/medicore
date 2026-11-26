import { writeFileSync } from "node:fs";
const entries = [
  ["GET", "/health", "Liveness", null, 200, false],
  ["GET", "/ready", "Database readiness", null, 200, false],
  [
    "POST",
    "/v1/login",
    "Create a session",
    { email: "reception@medicore.test", password: "MediCoreDemo!" },
    200,
    false,
  ],
  ["GET", "/v1/me", "Read current profile"],
  ["POST", "/v1/refresh", "Rotate the session"],
  ["POST", "/v1/logout", "Revoke the session"],
  ["GET", "/v1/directory", "List departments and providers"],
  ["GET", "/v1/staff", "List staff"],
  ["GET", "/v1/departments", "List departments"],
  [
    "POST",
    "/v1/departments",
    "Register a department",
    { name: "Training department" },
    201,
  ],
  [
    "POST",
    "/v1/staff",
    "Create a staff account",
    {
      name: "Synthetic Staff",
      email: "synthetic@medicore.test",
      password: "LocalDemoOnly-Example",
      role: "nurse",
      departmentId: "cardiology",
    },
    201,
  ],
  ["GET", "/v1/schedules", "List upcoming provider availability"],
  [
    "POST",
    "/v1/schedules/{id}",
    "Add provider availability",
    { start: "2026-12-01T08:00:00+05:30", end: "2026-12-01T18:00:00+05:30" },
    201,
    true,
    { id: "doctor" },
  ],
  ["GET", "/v1/patients", "List authorized patient records"],
  [
    "POST",
    "/v1/patients",
    "Register a synthetic patient",
    { name: "Sample Patient", birthDate: "1994-11-05" },
    201,
  ],
  [
    "PUT",
    "/v1/patients/{id}/consent",
    "Update patient permissions",
    { clinical: true, exchange: true },
    200,
    true,
    { id: "p1" },
  ],
  ["GET", "/v1/appointments", "List, search, and filter the schedule"],
  [
    "POST",
    "/v1/appointments",
    "Book a provider and patient",
    {
      patientId: "p1",
      providerId: "doctor",
      start: "2026-12-01T15:00:00+05:30",
      end: "2026-12-01T15:30:00+05:30",
      reason: "Synthetic follow-up",
    },
    201,
  ],
  [
    "PATCH",
    "/v1/appointments/{id}",
    "Check in or cancel",
    { status: "checked_in" },
    200,
    true,
    { id: "a3" },
  ],
  ["GET", "/v1/waitlist", "List authorized waitlist entries"],
  [
    "POST",
    "/v1/waitlist",
    "Join the waitlist",
    { patientId: "p1", providerId: "doctor", reason: "Earlier time requested" },
    201,
  ],
  ["GET", "/v1/encounters", "List authorized encounters"],
  [
    "POST",
    "/v1/encounters",
    "Open an encounter",
    { appointmentId: "a3", notes: "Synthetic visit notes" },
    201,
  ],
  [
    "GET",
    "/v1/encounters/{id}",
    "Read an encounter and related records",
    null,
    200,
    true,
    { id: "e1" },
  ],
  [
    "PATCH",
    "/v1/encounters/{id}",
    "Update or close an encounter",
    { notes: "Synthetic visit complete", status: "closed" },
    200,
    true,
    { id: "e2" },
  ],
  [
    "POST",
    "/v1/encounters/{id}/diagnoses",
    "Record a supplied diagnosis",
    { code: "DEMO-1", description: "Synthetic training entry" },
    201,
    true,
    { id: "e2" },
  ],
  [
    "POST",
    "/v1/encounters/{id}/prescriptions",
    "Create a prescription draft",
    {
      medication: "Training example",
      dose: "Demo dose",
      instructions: "Synthetic record",
    },
    201,
    true,
    { id: "e2" },
  ],
  [
    "PATCH",
    "/v1/prescriptions/{id}",
    "Issue or cancel a draft",
    { status: "issued" },
    200,
    true,
    { id: "replace-with-draft-id" },
  ],
  [
    "POST",
    "/v1/encounters/{id}/labs",
    "Order a lab test",
    { test: "Glucose" },
    201,
    true,
    { id: "e2" },
  ],
  ["GET", "/v1/labs", "List authorized lab orders and results"],
  [
    "PATCH",
    "/v1/labs/{id}",
    "Collect a sample",
    { status: "collected" },
    200,
    true,
    { id: "l2" },
  ],
  [
    "POST",
    "/v1/labs/{id}/result",
    "Enter a result",
    { value: 92, unit: "mg/dL", low: 80, high: 110 },
    201,
    true,
    { id: "l2" },
  ],
  ["GET", "/v1/invoices", "List authorized invoices"],
  [
    "POST",
    "/v1/invoices",
    "Create an invoice",
    {
      appointmentId: "a3",
      description: "Synthetic consultation",
      cents: 12000,
    },
    201,
  ],
  [
    "PATCH",
    "/v1/invoices/{id}",
    "Mark paid or void",
    { status: "paid" },
    200,
    true,
    { id: "i2" },
  ],
  ["GET", "/v1/audit", "List audit history"],
  ["GET", "/v1/notifications", "Inspect notification sandbox deliveries"],
  ["GET", "/v1/reports", "Generate an analytics report"],
  [
    "GET",
    "/v1/fhir/{kind}/{id}",
    "Export a consent-gated FHIR resource",
    null,
    200,
    true,
    { kind: "Observation", id: "l1" },
  ],
];
const errorCodes = {
  400: "Malformed JSON",
  401: "Missing or invalid session",
  403: "Role or origin forbidden",
  404: "Resource unavailable",
  409: "Workflow or scheduling conflict",
  422: "Validation failure",
  429: "Rate limit",
  500: "Unexpected error",
  503: "Dependency unavailable",
};
const paths = {};
const collection = {
  info: {
    name: "MediCore local API",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [{ key: "baseUrl", value: "http://127.0.0.1:4080" }],
  item: [],
};
const schemaFor = (x) => ({
  type:
    typeof x === "number"
      ? Number.isInteger(x)
        ? "integer"
        : "number"
      : typeof x,
});
for (const [
  method,
  path,
  summary,
  example,
  status = 200,
  auth = true,
  parameters = {},
] of entries) {
  const operation = {
    summary,
    security: auth ? [{ session: [] }] : [],
    parameters: Object.entries(parameters).map(([name, example]) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
      example,
    })),
    responses: {
      [status]: { description: "Success" },
      ...Object.fromEntries(
        Object.entries(errorCodes).map(([status, description]) => [
          status,
          {
            description,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        ]),
      ),
    },
  };
  if (example)
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          example,
          schema: {
            type: "object",
            required: Object.keys(example),
            properties: Object.fromEntries(
              Object.entries(example).map(([k, v]) => [k, schemaFor(v)]),
            ),
          },
        },
      },
    };
  if (path === "/v1/appointments" && method === "GET") {
    operation.parameters.push(
      ...Object.entries({
        page: { type: "integer", minimum: 1 },
        day: { type: "string", format: "date" },
        q: { type: "string" },
        status: {
          type: "string",
          enum: ["scheduled", "checked_in", "completed", "cancelled"],
        },
      }).map(([name, schema]) => ({ name, in: "query", schema })),
    );
  }
  (paths[path] ??= {})[method.toLowerCase()] = operation;
  const target = path.replaceAll(/\{(\w+)\}/g, (_, key) => parameters[key]);
  collection.item.push({
    name: summary,
    request: {
      method,
      url: "{{baseUrl}}" + target,
      ...(example
        ? {
            header: [{ key: "Content-Type", value: "application/json" }],
            body: { mode: "raw", raw: JSON.stringify(example, null, 2) },
          }
        : {}),
    },
  });
}
const openapi = {
  openapi: "3.1.0",
  info: { title: "MediCore API", version: "1.0.0" },
  servers: [{ url: "http://127.0.0.1:4080" }],
  paths,
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "medicore" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["message", "requestId"],
            properties: {
              message: { type: "string" },
              requestId: { type: "string" },
            },
          },
        },
      },
    },
  },
};
writeFileSync("docs/openapi.json", JSON.stringify(openapi, null, 2) + "\n");
writeFileSync(
  "docs/MediCore.postman_collection.json",
  JSON.stringify(collection, null, 2) + "\n",
);
