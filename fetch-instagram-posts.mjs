import axios from "axios";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { performance } from "perf_hooks";
import dotenv from "dotenv";
import { getProxyAgent, INSTAGRAM_BASE_URL, MAIN_SITE_URL, saveJSONToFile, fetchWithRetry } from "./shared-library.mjs";

// Load environment variables
dotenv.config();

// Constants
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME || "ciarasclassroom";
const INSTAGRAM_API_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// The embed iframe is served to third-party pages, so it must be requested the way a
// browser embeds it: iframe fetch metadata, a referring site, and the `rd` (referring
// domain) parameter instagram's own embed.js sends. Without these the endpoint returns
// the bare JS shell with no post data.
const EMBED_REFERER = MAIN_SITE_URL;
const EMBED_HEADERS = {
  "User-Agent": INSTAGRAM_API_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-IE,en;q=0.9",
  Referer: `${EMBED_REFERER}/`,
  "Sec-Fetch-Dest": "iframe",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "cross-site",
  "Upgrade-Insecure-Requests": "1",
};
const IMAGE_WIDTH = 200;
const POSTS_TO_PROCESS = 4;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Pulls the `contextJSON` blob out of an Instagram embed page.
 *
 * The embed ships its data as a JSON string nested inside another JSON string, so it
 * needs unescaping twice. Hand-rolled rather than regex'd because the value contains
 * escaped quotes.
 *
 * @param {string} html
 * @returns {Object} the decoded `context` object
 */
function extractEmbedContext(html) {
  const key = '"contextJSON":';
  const keyAt = html.indexOf(key);
  if (keyAt === -1) {
    throw new Error("No contextJSON in the embed response — Instagram served the empty JS shell.");
  }

  const start = html.indexOf('"', keyAt + key.length);
  let end = start + 1;

  for (;;) {
    end = html.indexOf('"', end);
    if (end === -1) throw new Error("Unterminated contextJSON string in the embed response.");
    let backslashes = 0;
    for (let i = end - 1; html[i] === "\\"; i--) backslashes++;
    if (backslashes % 2 === 0) break;
    end++;
  }

  const { context } = JSON.parse(JSON.parse(html.slice(start, end + 1)));
  if (!context) throw new Error("Embed contextJSON had no `context` key.");
  return context;
}

/**
 * Fetches the latest Instagram posts from the public profile embed.
 *
 * Meta closed every anonymous JSON route in 2026 — `web_profile_info`, `?__a=1` and
 * `graphql/query` all answer 401 `require_login`, and the profile HTML is a login wall.
 * The *embed* iframe stayed open, because that is what renders Instagram posts on
 * third-party sites, and the profile-level embed (`/{username}/embed/`) server-renders
 * the recent posts into `contextJSON`. One request, no credentials, no headless browser.
 *
 * @returns {Promise<Array>} Array of Instagram post objects
 */
async function fetchInstagramPosts() {
  const url = `${INSTAGRAM_BASE_URL}/${INSTAGRAM_USERNAME}/embed/`;

  const response = await fetchWithRetry(
    {
      url,
      method: "get",
      params: { cr: 1, v: 14, wp: 540, rd: EMBED_REFERER },
      httpsAgent: getProxyAgent(),
      headers: EMBED_HEADERS,
      responseType: "text",
    },
    // Keep the footprint small: on failure we simply keep the previous posts.
    1,
    3000,
  );

  const context = extractEmbedContext(response.data);
  const media = (context.graphql_media || []).map((entry) => entry.shortcode_media || entry);

  if (media.length === 0) {
    throw new Error(`The embed for @${INSTAGRAM_USERNAME} returned no posts.`);
  }

  // Pinned posts come first and can be years old, so rank them below everything else
  // and sort the rest newest-first.
  const isPinned = (node) => (node.pinned_for_users || []).length > 0;
  const latest = [...media].sort((a, b) => {
    if (isPinned(a) !== isPinned(b)) return isPinned(a) ? 1 : -1;
    return (b.taken_at_timestamp || 0) - (a.taken_at_timestamp || 0);
  });

  return latest.slice(0, POSTS_TO_PROCESS).map((node, index) => ({
    imageUrl: node.display_url || node.display_resources?.at(-1)?.src,
    caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || "",
    postUrl: `${INSTAGRAM_BASE_URL}/p/${node.shortcode}/`,
    index,
  }));
}

/**
 * Downloads and resizes an image from a given URL
 * @param {string} imageUrl - URL of the image to download
 * @param {number} index - Index of the image (used for naming)
 * @returns {Promise<string|null>} Path to the downloaded image or null if failed
 */
async function downloadImage(imageUrl, index) {
  try {
    const imageResponse = await fetchWithRetry(
      {
        url: imageUrl,
        method: "get",
        responseType: "arraybuffer",
        httpsAgent: getProxyAgent(),
      },
      MAX_RETRIES,
      RETRY_DELAY,
    );

    const imageName = `${index + 1}.jpg`;
    const imagePath = path.join("public", "images", "instagram", imageName);
    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    const resizedImageBuffer = await sharp(imageResponse.data).resize({ width: IMAGE_WIDTH }).toBuffer();
    await fs.writeFile(imagePath, resizedImageBuffer);

    return `/images/instagram/${imageName}`;
  } catch (error) {
    console.error(`An error occurred while downloading image ${imageUrl}:`, error.message);
    return null;
  }
}

/**
 * Processes fetched posts by downloading and resizing images
 * @param {Array} posts - Array of Instagram post objects
 * @returns {Promise<Array>} Array of processed post objects
 */
async function processPosts(posts) {
  const results = await Promise.all(
    posts.map(async (post) => {
      const imageUrl = await downloadImage(post.imageUrl, post.index);
      return imageUrl ? { ...post, imageUrl } : null;
    }),
  );
  return results.filter(Boolean);
}

/**
 * Main execution function
 */
async function main() {
  const startTime = performance.now();
  try {
    console.log("Fetching Instagram posts...");
    const posts = await fetchInstagramPosts();
    console.log(`Fetched ${posts.length} posts. Processing...`);
    const processedPosts = await processPosts(posts);
    console.log(`Processed ${processedPosts.length} posts. Saving...`);
    await saveJSONToFile(processedPosts, "instagram_posts.json");
    const endTime = performance.now();
    console.log(`Process completed successfully in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
