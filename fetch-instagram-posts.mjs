import axios from "axios";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { performance } from "perf_hooks";
import dotenv from "dotenv";
import { getProxyAgent, INSTAGRAM_BASE_URL, USER_AGENT, saveJSONToFile, fetchWithRetry } from "./shared-library.mjs";

// Load environment variables
dotenv.config();

// Constants
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME || "ciarasclassroom";
// Public web app id used by instagram.com's own frontend for the web_profile_info endpoint.
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || "936619743392459";
const INSTAGRAM_API_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IMAGE_WIDTH = 200;
const POSTS_TO_PROCESS = 4;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Fetches the latest Instagram posts via the public web_profile_info endpoint
 * (the same one instagram.com's web frontend uses; the old graphql/query_hash
 * API was retired by Meta and now returns HTTP 400).
 * @returns {Promise<Array>} Array of Instagram post objects
 */
async function fetchInstagramPosts() {
  try {
    const response = await fetchWithRetry(
      {
        url: "https://i.instagram.com/api/v1/users/web_profile_info/",
        method: "get",
        params: { username: INSTAGRAM_USERNAME },
        httpsAgent: getProxyAgent(),
        headers: {
          "User-Agent": INSTAGRAM_API_USER_AGENT,
          "x-ig-app-id": INSTAGRAM_APP_ID,
        },
      },
      // One request gets all posts. Keep the footprint tiny (a single retry) —
      // hammering with retries on a 429 only makes the rate limit worse; on
      // failure we just keep the previously fetched posts.
      1,
      3000,
    );

    const edges = response.data.data.user.edge_owner_to_timeline_media.edges;
    // The endpoint returns pinned posts first (which can be years old), so sort by
    // post date to get the genuinely latest posts rather than pinned ones.
    const latest = [...edges].sort(
      (a, b) => (b.node.taken_at_timestamp || 0) - (a.node.taken_at_timestamp || 0),
    );
    return latest.slice(0, POSTS_TO_PROCESS).map((edge, index) => {
      const { shortcode } = edge.node;
      const imageUrl = edge.node.display_url || edge.node.thumbnail_src;
      const caption = edge.node.edge_media_to_caption.edges[0]?.node?.text || "";
      const postUrl = `${INSTAGRAM_BASE_URL}/p/${shortcode}/`;
      return { imageUrl, caption, postUrl, index };
    });
  } catch (error) {
    console.error("An error occurred while fetching Instagram posts:", error.message);
    throw error;
  }
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
