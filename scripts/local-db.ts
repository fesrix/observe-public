import EmbeddedPostgres from "embedded-postgres";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
const directory = resolve(".local/postgres");
mkdirSync(directory, { recursive: true });
const { readFileSync } = await import("node:fs");
const passwordFile = resolve(".local/pg-password");
const password = existsSync(passwordFile)
  ? readFileSync(passwordFile, "utf8")
  : randomBytes(24).toString("hex");
if (!existsSync(passwordFile))
  writeFileSync(passwordFile, password, { mode: 0o600 });
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: "postgres",
  password,
  port: 55439,
  persistent: true,
  authMethod: "scram-sha-256",
  autoRehydrateSymlinks: true,
  postgresFlags: ["-h", "127.0.0.1", "-c", "timezone=Asia/Tehran"],
  onLog: () => {},
  onError: (message) => {
    if (String(message).includes("FATAL"))
      console.error("PostgreSQL startup failed.");
  },
});
if (!existsSync(resolve(directory, "PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient("postgres", "127.0.0.1");
await client.connect();
for (const name of ["lingua_dev", "lingua_test"]) {
  const r = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [
    name,
  ]);
  if (!r.rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
writeFileSync(
  ".local/development.env",
  `DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:55439/lingua_dev\nDIRECT_URL=postgresql://postgres:${password}@127.0.0.1:55439/lingua_dev\nTEST_DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:55439/lingua_test\nAPP_ORIGIN=http://127.0.0.1:3100\nTZ=Asia/Tehran\n`,
  { mode: 0o600 },
);
console.log(
  "Local PostgreSQL ready on 127.0.0.1:55439. Configuration: .local/development.env. Stop with Ctrl+C.",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 60000);
