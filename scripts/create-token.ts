import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createDb } from "../src/db/index.ts";
import { tokenRepo } from "../src/db/repositories.ts";
import { issueToken } from "../src/auth/tokens.ts";

function arg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const config = loadConfig();
const db = await createDb(config);

if (process.argv.includes("--list")) {
  const rows = await tokenRepo.list(db);
  if (!rows.length) console.log("no tokens");
  for (const row of rows) {
    console.log(`${row.token_prefix}…  ${row.name.padEnd(20)} scopes=${row.scopes.join(",")} enabled=${row.enabled} last_used=${row.last_used_at ?? "never"}`);
  }
  await db.close();
  process.exit(0);
}

const name = arg("name", "default");
const scopes = arg("scopes", "fetch,ai")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!scopes.every((scope) => ["fetch", "ai", "read", "*"].includes(scope))) {
  console.error("scopes must be a subset of: fetch, ai, read, *");
  process.exit(1);
}

const issued = issueToken();
const row = await tokenRepo.create(db, {
  id: randomUUID(),
  name,
  prefix: issued.prefix,
  hash: issued.hash,
  scopes,
});

console.log("token created (shown once):");
console.log(issued.token);
console.log(`name=${row.name} scopes=${row.scopes.join(",")} prefix=${row.token_prefix}`);
await db.close();
