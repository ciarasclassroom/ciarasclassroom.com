/**
 * Fails if any fetched fixture is missing or empty.
 *
 * Run in CI after the fetch job so an empty catalogue is loud instead of silent.
 * Between 2026-08-09 and 2026-09-05 the TpT scrape wrote `[]` over the product
 * fixture every night and every workflow run still reported success, so
 * /product/ served an empty listing and every /product/<slug> page 404'd.
 */
import { readFile } from "fs/promises";
import path from "path";

const FIXTURES = ["tpt_products_RELEVANCE", "tpt_products_MOST_RECENT", "instagram_posts"];
const DIRECTORY = "src/lib/fixtures";

let failed = false;

for (const name of FIXTURES) {
  const filePath = path.join(DIRECTORY, `${name}.json`);
  let records;

  try {
    records = JSON.parse(await readFile(filePath, "utf-8"));
  } catch (error) {
    console.error(`::error file=${filePath}::${name}.json is missing or unparseable (${error.message})`);
    failed = true;
    continue;
  }

  if (!Array.isArray(records) || records.length === 0) {
    console.error(`::error file=${filePath}::${name}.json is empty — the site would build with no content`);
    failed = true;
    continue;
  }

  console.log(`  ${name}: ${records.length} records`);
}

process.exit(failed ? 1 : 0);
