/**
 * Offline-safe `prisma generate`.
 *
 * The generated client uses engineType="client" (WASM query compiler) and a
 * driver adapter, so no native engine binaries are needed at runtime.
 * However the Prisma CLI still tries to download engine binaries during
 * `generate`, which fails in firewalled environments. We point the env vars
 * at stub files so the CLI skips the download.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stubBin = path.join(os.tmpdir(), "prisma-stub-engine");
const stubLib = path.join(os.tmpdir(), "prisma-stub-engine.so");
fs.writeFileSync(stubBin, "#!/bin/sh\nexit 0\n");
fs.chmodSync(stubBin, 0o755);
fs.writeFileSync(stubLib, "");

const result = spawnSync("npx", ["prisma", "generate"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PRISMA_SCHEMA_ENGINE_BINARY: stubBin,
    PRISMA_QUERY_ENGINE_LIBRARY: stubLib,
  },
});
process.exit(result.status ?? 1);
