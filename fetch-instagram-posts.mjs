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
const INSTAGRAM_USER_ID = process.env.INSTAGRAM_USER_ID || "8453018622";
const INSTAGRAM_QUERY_HASH = process.env.INSTAGRAM_QUERY_HASH || "58b6785bea111c67129decbe6a448951";
const IMAGE_WIDTH = 200;
const POSTS_TO_FETCH = 7;
const POSTS_TO_PROCESS = 4;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Fetches Instagram posts using the Instagram Graph API
 * @returns {Promise<Array>} Array of Instagram post objects
 */
async function fetchInstagramPosts() {
  try {
    const response = await fetchWithRetry(
      {
        url: `${INSTAGRAM_BASE_URL}/graphql/query/`,
        method: "get",
        params: {
          query_hash: INSTAGRAM_QUERY_HASH,
          variables: JSON.stringify({
            id: INSTAGRAM_USER_ID,
            first: POSTS_TO_FETCH,
          }),
        },
        httpsAgent: getProxyAgent(),
        headers: {
          "User-Agent": USER_AGENT,
        },
      },
      MAX_RETRIES,
      RETRY_DELAY,
    );

    const edges = response.data.data.user.edge_owner_to_timeline_media.edges;
    return edges.slice(POSTS_TO_FETCH - POSTS_TO_PROCESS).map((edge, index) => {
      const { thumbnail_src: imageUrl, shortcode } = edge.node;
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
