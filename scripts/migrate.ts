import { loadConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/db/index.ts";

const config = loadConfig();
const db = await createDb(config);
const directory = `${import.meta.dir}/../migrations`;

const result = await migrate(db, directory);
console.log(`[migrate] driver=${db.kind}`);
console.log(`[migrate] applied: ${result.applied.length ? result.applied.join(", ") : "(none)"}`);
console.log(`[migrate] skipped: ${result.skipped.length ? result.skipped.join(", ") : "(none)"}`);
await db.close();
