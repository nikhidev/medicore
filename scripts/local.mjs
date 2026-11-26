import { spawn } from "node:child_process";
const port = process.env.WEB_PORT ?? "3080";
const api = process.env.API_PORT ?? "4080";
const env = {
  ...process.env,
  DEMO_SEED: "true",
  MEDICORE_API_URL: "http://127.0.0.1:" + api,
  API_PORT: api,
  APP_ORIGINS: "http://localhost:" + port + ",http://127.0.0.1:" + port,
  NEXT_TELEMETRY_DISABLED: "1",
};
const children = [
  spawn(process.execPath, ["api/server.mjs"], { stdio: "inherit", env }),
  spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      port,
    ],
    { stdio: "inherit", env },
  ),
];
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => children.forEach((child) => child.kill()));
for (const child of children)
  child.on("exit", (code) => {
    children.filter((item) => item !== child).forEach((item) => item.kill());
    process.exitCode = code ?? 1;
  });
