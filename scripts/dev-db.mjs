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

const dataDir = path.join(os.homedir(), ".cache", "axi-pgdata");
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
