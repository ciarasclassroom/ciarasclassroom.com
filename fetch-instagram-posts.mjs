import axios from "axios";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { HttpsProxyAgent } from "https-proxy-agent";

const INSTAGRAM_USER_ID = "8453018622";
const INSTAGRAM_QUERY_HASH = "58b6785bea111c67129decbe6a448951";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";

// Fetch proxy agent if available
const getProxyAgent = () => {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : null;
};

// Fetch Instagram posts
const fetchInstagramPosts = async () => {
  try {
    const response = await axios.get(
      "https://www.instagram.com/graphql/query/",
      {
        params: {
          query_hash: INSTAGRAM_QUERY_HASH,
          variables: JSON.stringify({
            id: INSTAGRAM_USER_ID,
            first: 7,
          }),
        },
        httpsAgent: getProxyAgent(),
        headers: {
          "User-Agent": USER_AGENT,
        },
      }
    );

    const edges = response.data.data.user.edge_owner_to_timeline_media.edges;

    return edges.slice(3, 7).map((edge, index) => {
      const { thumbnail_src: imageUrl, shortcode } = edge.node;
      const caption =
        edge.node.edge_media_to_caption.edges[0]?.node?.text || "";
      const postUrl = `https://www.instagram.com/p/${shortcode}/`;

      return { imageUrl, caption, postUrl, index };
    });
  } catch (error) {
    console.error("An error occurred while fetching Instagram posts:", error);
    return [];
  }
};

// Download image, resize it, and save to local filesystem
const downloadImage = async (imageUrl, index) => {
  try {
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
    });
    const imageName = `${index + 1}.jpg`;
    const imagePath = path.join("public", "images", "instagram", imageName);

    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    // Resize the image to a width of 200 pixels while maintaining aspect ratio
    const resizedImageBuffer = await sharp(imageResponse.data)
      .resize({ width: 200 })
      .toBuffer();

    await fs.writeFile(imagePath, resizedImageBuffer);

    return `/images/instagram/${imageName}`;
  } catch (error) {
    console.error(
      `An error occurred while downloading image ${imageUrl}:`,
      error
    );
    return null;
  }
};

// Process posts and download images
const processPosts = async (posts) => {
  const results = await Promise.all(
    posts.map(async (post) => {
      const imageUrl = await downloadImage(post.imageUrl, post.index);
      return imageUrl ? { ...post, imageUrl } : null;
    })
  );

  return results.filter(Boolean);
};

// Save posts data to JSON file
const savePostsToFile = async (posts) => {
  try {
    const jsonString = JSON.stringify(posts, null, 2);
    const filePath = path.join(
      "src",
      "lib",
      "fixtures",
      "instagram_posts.json"
    );

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonString, "utf-8");

    console.log("Instagram posts data saved successfully.");
  } catch (error) {
    console.error("An error occurred while saving the JSON file:", error);
  }
};

// Main execution function
const main = async () => {
  const posts = await fetchInstagramPosts();
  const processedPosts = await processPosts(posts);
  await savePostsToFile(processedPosts);
};

main().catch((error) => console.error("An unexpected error occurred:", error));
