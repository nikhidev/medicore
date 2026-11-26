import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("receptionist sees the schedule and receives a conflict for a duplicate slot", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page, "reception@medicore.test");
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  await expect(page.getByText("Olivia Bennett")).toBeVisible();
  if (process.env.CAPTURE_DEMO) {
    await mkdir("docs/evidence", { recursive: true });
    await page.screenshot({
      path: "docs/evidence/dashboard.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "New appointment" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Patient").selectOption("p1");
  await editor.getByLabel("Provider").selectOption("doctor");
  const currentDate = await page.getByLabel("Appointment date").inputValue();
  await editor.getByLabel("Start time (IST)").fill(currentDate + "T09:00");
  await editor.getByLabel("End time (IST)").fill(currentDate + "T09:30");
  await editor.getByLabel("Visit reason").fill("Duplicate booking demo");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByRole("alert")).toHaveText(
    "This time overlaps an existing appointment.",
  );
});

test("patient workspace shows own appointment and hides staff routes", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page, "patient@medicore.test");
  await expect(page.getByText("Olivia Bennett").last()).toBeVisible();
  await expect(page.getByText("Ethan Morgan")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Audit log" })).toHaveCount(0);
  const forbidden = await page.request.get("/api/audit");
  expect(forbidden.status()).toBe(403);
});

async function signIn(page, email, password = "MediCoreDemo!") {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("keeps synthetic records behind sign-in and clears them on sign-out", async ({
  page,
}) => {
  const recordRequests = [];
  page.on("request", (request) => {
    if (/\/api\/(appointments|patients|directory)(\?|$)/.test(request.url())) {
      recordRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to MediCore" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Receptionist", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Olivia Bennett")).toHaveCount(0);
  await signIn(page, "reception@medicore.test", "incorrect-password");
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Invalid email or password.",
  );
  expect(recordRequests).toEqual([]);
  expect((await page.request.get("/api/appointments")).status()).toBe(401);

  await signIn(page, "reception@medicore.test");
  await expect(page.getByText("Olivia Bennett")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Olivia Bennett")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to MediCore" }),
  ).toBeVisible();
  await expect(page.getByText("Olivia Bennett")).toHaveCount(0);
  expect((await page.request.get("/api/appointments")).status()).toBe(401);
});
