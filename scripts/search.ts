import { loadConfig } from "../src/config.ts";
import { createDb } from "../src/db/index.ts";
import { searchHistory } from "../src/search/service.ts";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('usage: bun run search -- "关键词"');
  process.exit(1);
}

const config = loadConfig();
const db = await createDb(config);
const result = await searchHistory(db, { query, limit: 10 });

console.log(`query="${result.query}" mode=${result.mode}${result.fallback ? " (fallback)" : ""} total=${result.total} ${result.took_ms}ms`);
for (const [index, item] of result.items.entries()) {
  console.log(`\n${index + 1}. [${item.platform}/${item.provider}] ${item.title}`);
  console.log(`   ${item.url}`);
  console.log(`   score=${item.score.toFixed(3)} length=${item.content_length} ${item.created_at.slice(0, 10)}`);
  console.log(`   ${item.snippet}`);
}
if (!result.items.length) console.log("(no matches)");
if (result.next_offset !== null) console.log(`\nmore: --offset ${result.next_offset}`);

await db.close();
