import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== "/lingua_test" ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  throw new Error("Use an isolated localhost test database.");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3102",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: url,
      APP_ORIGIN: "http://127.0.0.1:3102",
    },
  },
);
let diagnostic = "";
child.stderr.on("data", (chunk) => (diagnostic += chunk.toString()));
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null)
      throw new Error("Production server exited: " + diagnostic);
    try {
      const response = await fetch("http://127.0.0.1:3102/api/health/ready");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Production readiness timed out.");
  const page = await fetch("http://127.0.0.1:3102/");
  assert.equal(page.status, 200);
  assert.match(
    await page.text(),
    /<title>Observe \| TTC Observation Portal<\/title>/,
    "Expected the Observe page title.",
  );
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.ok(
    !page.headers.get("content-security-policy")?.includes("unsafe-eval"),
  );
  const workspace = await fetch("http://127.0.0.1:3102/api/workspace");
  assert.equal(workspace.status, 401);
  assert.equal(workspace.headers.get("cache-control"), "no-store");
  console.log(
    "Production smoke passed: page, database readiness, security headers, private-route protection.",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}
