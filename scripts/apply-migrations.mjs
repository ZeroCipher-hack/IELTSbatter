/**
 * Fallback migration runner for environments where the Prisma schema engine
 * binary cannot be downloaded (offline/firewalled sandboxes).
 *
 * In normal environments prefer:  npx prisma migrate deploy
 *
 * Applies prisma/migrations/<dir>/migration.sql in order and records them
 * in the same `_prisma_migrations` table Prisma uses, so switching back to
 * `prisma migrate` later is seamless.
 */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const url = process.env.DATABASE_URL ?? readEnvFile("DATABASE_URL");
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

function readEnvFile(key) {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  VARCHAR(36)  PRIMARY KEY,
    checksum            VARCHAR(64)  NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    applied_steps_count INTEGER      NOT NULL DEFAULT 0
  )
`);

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const dirs = fs
  .readdirSync(migrationsDir)
  .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
  .sort();

const { rows } = await client.query(
  `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
);
const applied = new Set(rows.map((r) => r.migration_name));

for (const dir of dirs) {
  if (applied.has(dir)) {
    console.log(`skip  ${dir} (already applied)`);
    continue;
  }
  const sql = fs.readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  console.log(`apply ${dir}`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
       VALUES ($1, $2, now(), $3, 1)`,
      [crypto.randomUUID(), checksum, dir]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`failed: ${dir}\n`, e.message);
    process.exit(1);
  }
}

console.log("migrations up to date");
await client.end();
