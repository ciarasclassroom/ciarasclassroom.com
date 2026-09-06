/**
 * Strips the promotional title banner from TpT product images.
 *
 * Every TpT cover image is laid out the same way: a solid black bar across the top
 * carrying the resource title in white, then the actual product photography below.
 * Google Shopping rejects that bar as `image_unwanted_overlays` ("Promotional text,
 * obstructing elements, or borders are not allowed on product images") — 1,640
 * disapprovals across the 13 country variants.
 *
 * The banner's height varies with the title (one line ≈ 80-110px, two lines ≈ 170-190px
 * of a 750px image), so it is detected per image rather than assumed. Cropped copies are
 * written to public/images/products/ and served from ciarasclassroom.com; the Merchant
 * feed points at those instead of TpT's CDN. The website keeps using TpT's originals.
 *
 * Output is a manifest at src/lib/fixtures/product_images.json mapping each original URL
 * to its local path. Anything that fails to process is simply absent, and the Merchant
 * feed falls back to the original URL.
 */
import { createHash } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { performance } from "perf_hooks";
import sharp from "sharp";
import {
  getProxyAgent,
  fetchWithRetry,
  loadJSONFromFile,
  saveJSONToFile,
  mapWithConcurrency,
  USER_AGENT,
} from "./shared-library.mjs";

const PRODUCTS_JSON_PATH = process.env.PRODUCTS_JSON_PATH || "tpt_products_MOST_RECENT.json";
const OUTPUT_DIR = "public/images/products";
const PUBLIC_PREFIX = "/images/products";
const MANIFEST_NAME = "product_images.json";
const DOWNLOAD_CONCURRENCY = 8;

// --- Banner detection -------------------------------------------------------------

const DARK = 60; // luminance below this is "black"
const LIGHT = 190; // and above this is "white"
const MAX_MEAN_SAT = 14; // the banner is pure black and white — no colour at all
const MAX_MID = 0.38; // and holds few mid-tones (only anti-aliased text edges)
const MIN_DARK_ROW = 0.25; // every banner row carries the black bar behind the lettering
const MIN_DARK_AVERAGE = 0.35; // and the banner overall must be mostly black
const CONFIRM_ROWS = 6; // consecutive content rows needed to call the banner finished
const LEAD_TOLERANCE = 8; // some covers open with a thin light edge above the black bar
const MAX_BANNER_FRACTION = 0.4; // never crop away more than this much of the image

/**
 * Per-row colour statistics for an image.
 */
async function rowStatistics(buffer) {
  const image = sharp(buffer);
  const { width, height } = await image.metadata();
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const rows = [];

  for (let y = 0; y < height; y++) {
    let saturationSum = 0;
    let mid = 0;
    let dark = 0;

    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      saturationSum += Math.max(r, g, b) - Math.min(r, g, b);
      if (luminance < DARK) dark++;
      else if (luminance <= LIGHT) mid++;
    }

    rows.push({ saturation: saturationSum / width, mid: mid / width, dark: dark / width });
  }

  return { width, height, rows };
}

/**
 * Height in pixels of the promotional banner at the top of the image, or 0 if there
 * isn't one.
 *
 * Rows of the banner are unsaturated (black text block, white lettering) and hold few
 * mid-tones. Photographic content below is colourful, so the transition is sharp. A run
 * of CONFIRM_ROWS content rows ends the banner, which keeps a line of anti-aliased text
 * from cutting the search short.
 */
function detectBannerHeight({ height, rows }) {
  // The dark test matters as much as the colour one: a pale, unsaturated product
  // background (white paper, soft pink) also has low saturation and few mid-tones, so
  // without it the run walks straight past the banner into the content.
  const isBannerRow = (row) => row.saturation < MAX_MEAN_SAT && row.mid < MAX_MID && row.dark > MIN_DARK_ROW;

  // Some covers start with a one or two pixel light edge above the black bar, so the
  // banner is looked for just below the top rather than demanded at row 0.
  let start = 0;
  while (start < LEAD_TOLERANCE && !isBannerRow(rows[start])) start++;
  if (start >= LEAD_TOLERANCE) return 0;

  const limit = Math.floor(height * MAX_BANNER_FRACTION);
  let lastBannerRow = start;
  let contentRun = 0;

  for (let y = start; y < limit; y++) {
    if (isBannerRow(rows[y])) {
      lastBannerRow = y;
      contentRun = 0;
    } else if (++contentRun >= CONFIRM_ROWS) {
      break;
    }
  }

  const bannerRows = rows.slice(start, lastBannerRow + 1);
  const darkAverage = bannerRows.reduce((total, row) => total + row.dark, 0) / bannerRows.length;
  return darkAverage > MIN_DARK_AVERAGE ? lastBannerRow + 1 : 0;
}

// --- Processing -------------------------------------------------------------------

/**
 * A stable filename for one product image. The hash covers the source URL, which TpT
 * stamps with the upload time, so re-uploading a cover changes the filename and Google
 * re-crawls it instead of serving a cached copy.
 */
function localFileName(product, sourceUrl, index) {
  const tptId = product.slug.split("-").pop();
  const hash = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 8);
  return `${tptId}-${index + 1}-${hash}.jpg`;
}

async function processImage(job) {
  const { sourceUrl, fileName } = job;

  const response = await fetchWithRetry(
    {
      url: sourceUrl,
      method: "get",
      responseType: "arraybuffer",
      httpsAgent: getProxyAgent(),
      headers: { "User-Agent": USER_AGENT },
    },
    2,
    1500,
  );

  const buffer = Buffer.from(response.data);
  const stats = await rowStatistics(buffer);
  const banner = detectBannerHeight(stats);

  await sharp(buffer)
    .extract({ left: 0, top: banner, width: stats.width, height: stats.height - banner })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(OUTPUT_DIR, fileName));

  return { ...job, banner };
}

async function main() {
  const startTime = performance.now();

  const products = await loadJSONFromFile(PRODUCTS_JSON_PATH);
  if (!Array.isArray(products) || products.length === 0) {
    console.error(`No products in ${PRODUCTS_JSON_PATH} — nothing to process.`);
    process.exit(1);
  }

  // Rebuilt from scratch each run: the directory is generated output, not committed,
  // so old crops would otherwise pile up under their content-hashed names.
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const jobs = products.flatMap((product) =>
    (product.images || []).map((sourceUrl, index) => ({
      sourceUrl,
      fileName: localFileName(product, sourceUrl, index),
    })),
  );

  console.log(`Processing ${jobs.length} product images from ${products.length} products...`);

  const results = await mapWithConcurrency(jobs, processImage, DOWNLOAD_CONCURRENCY);

  const manifest = {};
  let cropped = 0;
  const failures = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push({ url: jobs[index].sourceUrl, reason: result.reason?.message || String(result.reason) });
      return;
    }
    manifest[result.value.sourceUrl] = `${PUBLIC_PREFIX}/${result.value.fileName}`;
    if (result.value.banner > 0) cropped++;
  });

  await saveJSONToFile(manifest, MANIFEST_NAME);

  const done = Object.keys(manifest).length;
  console.log(`Processed ${done}/${jobs.length} images; ${cropped} had a banner cropped.`);

  if (failures.length) {
    console.warn(`${failures.length} image(s) failed and will fall back to the TpT URL:`);
    for (const failure of failures.slice(0, 5)) console.warn(`  ${failure.url}: ${failure.reason}`);
  }

  // A near-total failure means the proxy or TpT's CDN is down; say so loudly rather than
  // silently shipping a feed that still points at every original overlay image.
  if (done < jobs.length / 2) {
    console.error(`Only ${done} of ${jobs.length} images processed — treating this as a failure.`);
    process.exit(1);
  }

  console.log(`Completed in ${((performance.now() - startTime) / 1000).toFixed(2)} seconds.`);
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
