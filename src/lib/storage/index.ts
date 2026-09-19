/**
 * Audio storage abstraction.
 *
 * Binary audio is NEVER stored in PostgreSQL: assets live in a file/object
 * store and the database keeps only metadata plus a URL (AudioAsset).
 *
 * Two visibilities exist on purpose:
 *  - published test audio (listening sections) is served statically;
 *  - user recordings (speaking) are private and only reachable through
 *    /api/audio/[id], which enforces ownership.
 *
 * Swapping the filesystem for S3/R2 later means implementing StorageProvider
 * once — no caller changes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type StorageVisibility = "public" | "private";

export interface StoredFile {
  key: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly name: string;
  readonly visibility: StorageVisibility;
  put(input: { key: string; data: Uint8Array; mimeType: string }): Promise<StoredFile>;
  get(key: string): Promise<{ data: Buffer; mimeType: string } | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** URL a client can use to fetch the asset. */
  urlFor(key: string): string;
}

const PUBLIC_ROOT = path.join(process.cwd(), "public", "audio");
const PRIVATE_ROOT = path.join(process.cwd(), "var", "uploads");

/** Reject path traversal in storage keys. */
function assertSafeKey(key: string): void {
  if (!key || key.includes("..") || path.isAbsolute(key) || key.includes("\0")) {
    throw new Error("Invalid storage key");
  }
}

function guessMimeType(key: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(key).toLowerCase();
  return (
    {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".webm": "audio/webm",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".mp4": "audio/mp4",
    }[ext] ?? fallback
  );
}

class FsStorage implements StorageProvider {
  constructor(
    readonly name: string,
    readonly visibility: StorageVisibility,
    private readonly root: string,
    private readonly urlPrefix: string
  ) {}

  urlFor(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }

  async put(input: { key: string; data: Uint8Array; mimeType: string }): Promise<StoredFile> {
    assertSafeKey(input.key);
    const target = path.join(this.root, input.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.data);
    return {
      key: input.key,
      url: this.urlFor(input.key),
      mimeType: input.mimeType || guessMimeType(input.key),
      sizeBytes: input.data.byteLength,
    };
  }

  async get(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
    assertSafeKey(key);
    try {
      const data = await fs.readFile(path.join(this.root, key));
      return { data, mimeType: guessMimeType(key) };
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      assertSafeKey(key);
      await fs.access(path.join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await fs.rm(path.join(this.root, key), { force: true });
  }
}

let publicStorage: StorageProvider = new FsStorage("fs-public", "public", PUBLIC_ROOT, "/audio");
let privateStorage: StorageProvider = new FsStorage(
  "fs-private",
  "private",
  PRIVATE_ROOT,
  "/api/audio"
);

/** Published test audio (listening sections). */
export function getPublicStorage(): StorageProvider {
  return publicStorage;
}

/** User recordings — private, ownership enforced by /api/audio/[id]. */
export function getPrivateStorage(): StorageProvider {
  return privateStorage;
}

/** Tests inject in-memory stores so no real files are written. */
export function setStorageForTesting(input: {
  public?: StorageProvider;
  private?: StorageProvider;
}): void {
  if (input.public) publicStorage = input.public;
  if (input.private) privateStorage = input.private;
}

export function resetStorage(): void {
  publicStorage = new FsStorage("fs-public", "public", PUBLIC_ROOT, "/audio");
  privateStorage = new FsStorage("fs-private", "private", PRIVATE_ROOT, "/api/audio");
}

/** Random, collision-resistant storage key that preserves the extension. */
export function newStorageKey(prefix: string, extension = "wav"): string {
  const ext = extension.replace(/^\./, "").toLowerCase();
  return `${prefix}/${crypto.randomUUID()}.${ext}`;
}

/** Extension for a recording mime type (browser MediaRecorder output). */
export function extensionForMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return map[base] ?? "webm";
}

/** In-memory storage used by tests so nothing touches the filesystem. */
export class MemoryStorage implements StorageProvider {
  private readonly files = new Map<string, { data: Buffer; mimeType: string }>();

  constructor(
    readonly name = "memory",
    readonly visibility: StorageVisibility = "private",
    private readonly urlPrefix = "/api/audio"
  ) {}

  urlFor(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }

  async put(input: { key: string; data: Uint8Array; mimeType: string }): Promise<StoredFile> {
    const buffer = Buffer.from(input.data);
    this.files.set(input.key, { data: buffer, mimeType: input.mimeType });
    return {
      key: input.key,
      url: this.urlFor(input.key),
      mimeType: input.mimeType,
      sizeBytes: buffer.byteLength,
    };
  }

  async get(key: string) {
    return this.files.get(key) ?? null;
  }

  async exists(key: string) {
    return this.files.has(key);
  }

  async delete(key: string) {
    this.files.delete(key);
  }

  get size() {
    return this.files.size;
  }
}
