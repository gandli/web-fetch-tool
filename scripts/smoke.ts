import { isAppError } from "../src/contracts/errors.ts";
import { loadConfig } from "../src/config.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { defaultResolveHost } from "../src/core/url-guard.ts";

const GUARD_CASES = [
  "http://localhost/",
  "http://127.0.0.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://10.0.0.1/",
  "http://[::1]/",
  "file:///etc/passwd",
  "http://user:pass@example.com/",
  "http://example.com:8080/",
];

const args = process.argv.slice(2);
const urls = args.filter((arg) => !arg.startsWith("--"));
const targets = urls.length ? urls : ["https://example.com"];

const config = loadConfig();
const guarded = args.includes("--guard");

if (guarded) {
  console.log("== SSRF guard cases");
  for (const candidate of GUARD_CASES) {
    try {
      await runPipeline({ url: candidate, config, resolveHost: defaultResolveHost });
      console.log(`  FAIL (allowed) ${candidate}`);
    } catch (error) {
      console.log(`  ok   ${candidate} -> ${isAppError(error) ? error.code : "error"}`);
    }
  }
}

for (const target of targets) {
  const startedAt = Date.now();
  try {
    const { outcome } = await runPipeline({ url: target, config, resolveHost: defaultResolveHost });
    const preview = outcome.extracted.markdown.replace(/\s+/g, " ").slice(0, 160);
    console.log(`\n== ${target}`);
    console.log(`   platform   : ${outcome.platform}`);
    console.log(`   provider   : ${outcome.provider}`);
    console.log(`   title      : ${outcome.extracted.title}`);
    console.log(`   author     : ${outcome.extracted.author ?? "-"}`);
    console.log(`   published  : ${outcome.extracted.publishedAt ?? "-"}`);
    console.log(`   language   : ${outcome.extracted.language ?? "-"}`);
    console.log(`   extractor  : ${outcome.extracted.debug.chosen}`);
    console.log(`   length     : ${outcome.extracted.markdown.length}`);
    console.log(`   og.image   : ${outcome.og.image ?? "-"}`);
    console.log(`   og.site    : ${outcome.og.site_name ?? "-"}`);
    console.log(`   attempts   : ${outcome.attempts.map((a) => `${a.engine}:${a.status}(${a.upstream_latency_ms}ms)`).join(", ")}`);
    console.log(`   total      : ${Date.now() - startedAt}ms`);
    console.log(`   preview    : ${preview}`);
  } catch (error) {
    console.log(`\n== ${target}`);
    console.log(`   FAILED ${isAppError(error) ? `${error.code} (${error.message})` : String(error)}`);
  }
}
