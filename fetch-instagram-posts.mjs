import axios from "axios";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { HttpsProxyAgent } from "https-proxy-agent";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Constants
const INSTAGRAM_USER_ID = process.env.INSTAGRAM_USER_ID || "8453018622";
const INSTAGRAM_QUERY_HASH =
  process.env.INSTAGRAM_QUERY_HASH || "58b6785bea111c67129decbe6a448951";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";
const IMAGE_WIDTH = 200;
const POSTS_TO_FETCH = 7;
const POSTS_TO_PROCESS = 4;

// Helper Functions
const getProxyAgent = () => {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : null;
};

const fetchInstagramPosts = async () => {
  try {
    const response = await axios.get(
      "https://www.instagram.com/graphql/query/",
      {
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
    );

    const edges = response.data.data.user.edge_owner_to_timeline_media.edges;
    return edges.slice(POSTS_TO_FETCH - POSTS_TO_PROCESS).map((edge, index) => {
      const { thumbnail_src: imageUrl, shortcode } = edge.node;
      const caption =
        edge.node.edge_media_to_caption.edges[0]?.node?.text || "";
      const postUrl = `https://www.instagram.com/p/${shortcode}/`;
      return { imageUrl, caption, postUrl, index };
    });
  } catch (error) {
    console.error(
      "An error occurred while fetching Instagram posts:",
      error.message,
    );
    throw error;
  }
};

const downloadImage = async (imageUrl, index) => {
  try {
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      httpsAgent: getProxyAgent(),
    });
    const imageName = `${index + 1}.jpg`;
    const imagePath = path.join("public", "images", "instagram", imageName);
    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    const resizedImageBuffer = await sharp(imageResponse.data)
      .resize({ width: IMAGE_WIDTH })
      .toBuffer();
    await fs.writeFile(imagePath, resizedImageBuffer);

    return `/images/instagram/${imageName}`;
  } catch (error) {
    console.error(
      `An error occurred while downloading image ${imageUrl}:`,
      error.message,
    );
    return null;
  }
};

const processPosts = async (posts) => {
  const results = await Promise.all(
    posts.map(async (post) => {
      const imageUrl = await downloadImage(post.imageUrl, post.index);
      return imageUrl ? { ...post, imageUrl } : null;
    }),
  );
  return results.filter(Boolean);
};

const savePostsToFile = async (posts) => {
  try {
    const jsonString = JSON.stringify(posts, null, 2);
    const filePath = path.join(
      "src",
      "lib",
      "fixtures",
      "instagram_posts.json",
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonString, "utf-8");
    console.log("Instagram posts data saved successfully.");
  } catch (error) {
    console.error(
      "An error occurred while saving the JSON file:",
      error.message,
    );
    throw error;
  }
};

// Main execution function
const main = async () => {
  try {
    console.log("Fetching Instagram posts...");
    const posts = await fetchInstagramPosts();
    console.log(`Fetched ${posts.length} posts. Processing...`);
    const processedPosts = await processPosts(posts);
    console.log(`Processed ${processedPosts.length} posts. Saving...`);
    await savePostsToFile(processedPosts);
    console.log("Process completed successfully.");
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
