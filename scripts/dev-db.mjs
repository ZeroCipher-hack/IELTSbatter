/**
 * Local development PostgreSQL bootstrap.
 *
 * Uses embedded-postgres binaries so contributors don't need a system-wide
 * PostgreSQL install. Data lives outside the repo in ~/.cache/axi-pgdata.
 *
 * Usage: node scripts/dev-db.mjs
 */
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const runningAsRoot = process.getuid?.() === 0;
const defaultDataDir = runningAsRoot
  ? path.join(os.tmpdir(), "axi-pgdata")
  : path.join(os.homedir(), ".cache", "axi-pgdata");
const dataDir = process.env.AXI_PG_DATA_DIR ?? defaultDataDir;

// PostgreSQL intentionally refuses to run as root. embedded-postgres can
// safely spawn as an existing `postgres` account; it must never invent or
// silently mutate system users in a development helper.
if (runningAsRoot) {
  let postgresUid;
  let postgresGid;
  try {
    const quiet = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    postgresUid = Number(execFileSync("id", ["-u", "postgres"], quiet).trim());
    postgresGid = Number(execFileSync("id", ["-g", "postgres"], quiet).trim());
  } catch {
    console.error(
      "PostgreSQL cannot run in this root-only environment: no `postgres` system user is available. " +
      "Run `npm run db:dev` as a non-root user, or configure an external DATABASE_URL and skip this helper."
    );
    process.exit(1);
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chownSync(dataDir, postgresUid, postgresGid);
}
const isFresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "axi",
  password: "axi",
  port: 5432,
  persistent: true,
});

if (isFresh) {
  await pg.initialise();
}
await pg.start();
if (isFresh) {
  await pg.createDatabase("axi");
}
console.log("PostgreSQL running on port 5432 (db=axi user=axi)");

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// keep process alive
setInterval(() => {}, 1 << 30);
