/**
 * Tag and category slugs that only have one post behind them.
 *
 * 13 published posts currently generate 34 tag and category listing pages, and 21 of the
 * 24 tags have exactly one post — so those listings are near-duplicates of the single
 * post they point at. Search Console agrees: the sampled tag and category URLs come back
 * "Crawled - currently not indexed", "Discovered - currently not indexed" or "URL is
 * unknown to Google", never indexed.
 *
 * They stay on the site and stay crawlable, because they are real navigation. They are
 * just kept out of the sitemap and marked noindex, so crawl budget and ranking signals go
 * to the posts and products instead of to 30-odd thin listings.
 *
 * Read straight from the Markdown rather than through Astro's content collections so the
 * sitemap filter in astro.config.mjs can use it at config time.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { slug } from "github-slugger";

/** A listing needs at least this many posts to be worth indexing on its own. */
export const MIN_POSTS_TO_INDEX = 2;

const POSTS_DIR = path.join(process.cwd(), "src", "content", "posts");

function countTaxonomies() {
  const counts = { tags: new Map(), categories: new Map() };

  let files = [];
  try {
    files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
  } catch {
    return counts; // no posts directory (unexpected) — treat nothing as thin
  }

  for (const file of files) {
    const { data } = matter(fs.readFileSync(path.join(POSTS_DIR, file), "utf-8"));
    if (data.draft) continue;
    for (const name of ["tags", "categories"]) {
      for (const value of data[name] ?? []) {
        const key = slug(String(value));
        counts[name].set(key, (counts[name].get(key) ?? 0) + 1);
      }
    }
  }

  return counts;
}

const counts = countTaxonomies();

const thin = (map) => new Set([...map].filter(([, n]) => n < MIN_POSTS_TO_INDEX).map(([k]) => k));

export const thinTags = thin(counts.tags);
export const thinCategories = thin(counts.categories);

/** True for a /tags/<slug>/ or /categories/<slug>/ URL backed by fewer than MIN_POSTS_TO_INDEX posts. */
export function isThinTaxonomyUrl(url) {
  const match = url.match(/\/(tags|categories)\/([^/]+)\/?$/);
  if (!match) return false;
  const [, kind, taxonomySlug] = match;
  return (kind === "tags" ? thinTags : thinCategories).has(taxonomySlug);
}
