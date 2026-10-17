// Where the server keeps its records, safe ids, atomic writes and hashes (V2 extension).
// AUTOROBO_DATA_DIR moves every record folder (shifts, reviews, gates, trials, comparisons) at once; tests use it to
// stay off the real data. It is read when a path is needed, not at import time, so .env and test setup both apply.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { httpError } from "./brain.ts";

const DEFAULT_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");

export function dataDir(...parts: string[]): string {
  const root = process.env.AUTOROBO_DATA_DIR ? path.resolve(process.env.AUTOROBO_DATA_DIR) : DEFAULT_DATA;
  return path.join(root, ...parts);
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

/** A record id that is safe to put in a file name (no separators, no dots); anything else is a 400. */
export function safeId(id: unknown, what = "id"): string {
  const s = String(id ?? "");
  if (!ID.test(s)) throw httpError(400, `${what} must match ${ID.source}`, { code: "bad_id" });
  return s;
}

let tmpCounter = 0;
/** Write JSON so readers see either the old or the new file, never half of one. */
export function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${++tmpCounter}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** Every saved record in a folder: *.json files only (temp files from atomic writes are skipped). */
export function readJsonDir<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  const out: T[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    } catch {
      // a file being replaced right now or a damaged record: skip it rather than fail the whole listing
    }
  }
  return out;
}

export const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");

/** JSON with object keys sorted, so equal values hash equally regardless of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
}
