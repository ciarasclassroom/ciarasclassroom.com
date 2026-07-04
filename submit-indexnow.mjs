// Submits the site's URLs to IndexNow (https://www.indexnow.org).
//
// IndexNow is a shared protocol: one ping notifies Bing, Yandex, Seznam,
// Naver and others that URLs have changed, so they crawl/refresh them within
// minutes instead of waiting for their own crawl schedule. It's the static-
// hosting-friendly equivalent of "submit a sitemap" for the Bing ecosystem.
//
// It reads the built sitemap in ./dist, so run it AFTER `npm run build`.
// Verification is via a key file already committed at public/<KEY>.txt.

import { readFile } from "node:fs/promises";

const HOST = "ciarasclassroom.com";
const KEY = "c4d190673e4a89773fa49d9ace5fca54";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP_DIR = "./dist";
const ENDPOINT = "https://api.indexnow.org/IndexNow";
const BATCH_SIZE = 10000; // IndexNow accepts up to 10k URLs per request

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

// Walk the sitemap index and collect every page URL from its child sitemaps.
async function readSitemap(path) {
  const xml = await readFile(path, "utf8");
  const entries = locs(xml);
  // A sitemap index lists child sitemap files; a urlset lists page URLs.
  if (/<sitemapindex/.test(xml)) {
    const urls = [];
    for (const loc of entries) {
      urls.push(...(await readSitemap(loc.replace(`https://${HOST}`, SITEMAP_DIR))));
    }
    return urls;
  }
  return entries;
}

async function main() {
  const urls = await readSitemap(`${SITEMAP_DIR}/sitemap-index.xml`);
  console.log(`IndexNow: ${urls.length} URLs from sitemap`);

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const urlList = urls.slice(i, i + BATCH_SIZE);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    });
    // 200 = accepted, 202 = accepted (validation pending). Both are success.
    console.log(`  batch ${i / BATCH_SIZE + 1}: ${urlList.length} URLs -> HTTP ${res.status}`);
    if (res.status !== 200 && res.status !== 202) {
      console.error(`  body: ${await res.text()}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
